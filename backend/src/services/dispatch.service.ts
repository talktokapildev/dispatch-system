import { PrismaClient, BookingStatus, DriverStatus } from "@prisma/client";
import Redis from "ioredis";
import { Server as SocketServer } from "socket.io";
import { RedisKeys, RedisTTL } from "../plugins/redis";
import { MapsService } from "./maps.service";
import { NotificationService } from "./notification.service"; // ← NEW
import { SocketEvent, JobOfferPayload } from "../types";
import {
  DRIVER_ACCEPT_TIMEOUT_MS,
  MAX_DISPATCH_ATTEMPTS,
  MAX_DRIVER_SEARCH_RADIUS_KM,
} from "../config";

export class DispatchService {
  private notifications: NotificationService; // ← NEW

  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
    private io: SocketServer,
    private maps: MapsService
  ) {
    this.notifications = new NotificationService(prisma); // ← NEW
  }

  async dispatchBooking(bookingId: string): Promise<void> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { passenger: { include: { user: true } } },
    });

    if (!booking) throw new Error(`Booking ${bookingId} not found`);

    const drivers = await this.findNearestDrivers(
      booking.pickupLatitude,
      booking.pickupLongitude,
      MAX_DRIVER_SEARCH_RADIUS_KM
    );

    if (!drivers.length) {
      await this.escalateToManual(bookingId, "No available drivers in range");
      return;
    }

    await this.offerToDriver(bookingId, drivers, 0);
  }

  private async offerToDriver(
    bookingId: string,
    drivers: AvailableDriver[],
    attempt: number
  ): Promise<void> {
    if (attempt >= Math.min(drivers.length, MAX_DISPATCH_ATTEMPTS)) {
      await this.escalateToManual(
        bookingId,
        `No driver accepted after ${attempt} attempts`
      );
      return;
    }

    const driver = drivers[attempt];
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking || booking.status !== BookingStatus.PENDING) return;

    const driverRecord = await this.prisma.driver.findUnique({
      where: { id: driver.id },
      select: { userId: true, currentLatitude: true, currentLongitude: true },
    });

    // Calculate time from driver → pickup
    let timeToPickupMins: number | undefined;
    try {
      if (driverRecord?.currentLatitude && driverRecord?.currentLongitude) {
        const toPickup = await this.maps.getDirections(
          {
            lat: driverRecord.currentLatitude,
            lng: driverRecord.currentLongitude,
          },
          { lat: booking.pickupLatitude, lng: booking.pickupLongitude }
        );
        timeToPickupMins = toPickup.durationMinutes;
      }
    } catch {}

    // Calculate pickup → dropoff trip details
    let tripDistanceKm: number | undefined;
    let tripDurationMins: number | undefined;
    let routePolyline: string | undefined;
    try {
      const tripRoute = await this.maps.getDirections(
        { lat: booking.pickupLatitude, lng: booking.pickupLongitude },
        { lat: booking.dropoffLatitude, lng: booking.dropoffLongitude }
      );
      tripDistanceKm = tripRoute.distanceKm;
      tripDurationMins = tripRoute.durationMinutes;
      routePolyline = tripRoute.polyline;
      console.log("✅ Route polyline length:", routePolyline?.length);
    } catch (e) {
      console.log("❌ Route fetch failed:", e);
    }

    const offer: JobOfferPayload = {
      bookingId: booking.id,
      reference: booking.reference,
      type: booking.type as any,
      pickupAddress: booking.pickupAddress,
      pickupLatitude: booking.pickupLatitude,
      pickupLongitude: booking.pickupLongitude,
      dropoffAddress: booking.dropoffAddress,
      dropoffLatitude: booking.dropoffLatitude,
      dropoffLongitude: booking.dropoffLongitude,
      estimatedFare: booking.estimatedFare,
      scheduledAt: booking.scheduledAt?.toISOString(),
      passengerCount: booking.passengerCount,
      notes: booking.notes ?? undefined,
      flightNumber: booking.flightNumber ?? undefined,
      distanceToPickup: driver.distanceKm,
      timeToPickupMins,
      tripDistanceKm,
      tripDurationMins,
      routePolyline,
      timeoutMs: DRIVER_ACCEPT_TIMEOUT_MS,
    };

    // Socket offer (foreground)
    this.io
      .to(`driver:${driverRecord!.userId}`)
      .emit(SocketEvent.DRIVER_JOB_OFFER, offer);

    // Push notification (background) — fires silently if app is open
    this.notifications
      .notifyNewJobOffer(
        driverRecord!.userId,
        booking.pickupAddress,
        booking.estimatedFare
      )
      .catch(() => {});

    await this.redis.setex(
      RedisKeys.bookingLock(bookingId),
      Math.ceil(DRIVER_ACCEPT_TIMEOUT_MS / 1000),
      driver.id
    );

    setTimeout(async () => {
      const lock = await this.redis.get(RedisKeys.bookingLock(bookingId));
      if (lock === driver.id) {
        await this.offerToDriver(bookingId, drivers, attempt + 1);
      }
    }, DRIVER_ACCEPT_TIMEOUT_MS);
  }

  async acceptJob(bookingId: string, driverId: string): Promise<void> {
    const lock = await this.redis.get(RedisKeys.bookingLock(bookingId));
    if (lock !== driverId) {
      throw new Error(
        "Job offer has expired or was assigned to another driver"
      );
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking || booking.status !== BookingStatus.PENDING) {
      throw new Error("Booking no longer available");
    }

    await this.prisma.$transaction([
      this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          driverId,
          status: BookingStatus.DRIVER_ASSIGNED,
          driverAcceptedAt: new Date(),
          dispatchedAt: new Date(),
        },
      }),
      this.prisma.bookingStatusHistory.create({
        data: {
          bookingId,
          status: BookingStatus.DRIVER_ASSIGNED,
          note: "Driver accepted job",
        },
      }),
      this.prisma.driver.update({
        where: { id: driverId },
        data: { status: DriverStatus.ON_JOB },
      }),
    ]);

    await this.redis.del(RedisKeys.bookingLock(bookingId));
    await this.redis.set(RedisKeys.activeBooking(driverId), bookingId);

    // Socket notifications
    this.io.to(`booking:${bookingId}`).emit(SocketEvent.BOOKING_STATUS_UPDATE, {
      bookingId,
      status: BookingStatus.DRIVER_ASSIGNED,
      timestamp: Date.now(),
    });
    this.io.to("admin").emit(SocketEvent.ADMIN_BOOKING_UPDATED, {
      bookingId,
      status: BookingStatus.DRIVER_ASSIGNED,
      driverId,
    });

    const assignedDriver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { userId: true },
    });
    this.io
      .to(`driver:${assignedDriver!.userId}`)
      .emit("driver:job_assigned", { bookingId });

    // ── Push notification to passenger ────────────────────────────────────
    try {
      const acceptedBooking = await this.prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
          passenger: { include: { user: true } },
          driver: { include: { user: true, vehicle: true } },
        },
      });
      if (acceptedBooking) {
        const driverName =
          acceptedBooking.driver?.user.firstName ?? "Your driver";
        const plate = acceptedBooking.driver?.vehicle?.licensePlate ?? "";
        const passengerUserId = acceptedBooking.passenger.userId;
        this.notifications
          .notifyDriverAssigned(passengerUserId, driverName, plate)
          .catch(() => {});
      }
    } catch {}
  }

  async rejectJob(bookingId: string, driverId: string): Promise<void> {
    const lock = await this.redis.get(RedisKeys.bookingLock(bookingId));
    if (lock !== driverId) return;

    await this.redis.del(RedisKeys.bookingLock(bookingId));

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) return;

    const drivers = await this.findNearestDrivers(
      booking.pickupLatitude,
      booking.pickupLongitude,
      MAX_DRIVER_SEARCH_RADIUS_KM
    );

    const attempt = (booking.dispatchAttempts ?? 0) + 1;
    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { dispatchAttempts: attempt },
    });

    await this.offerToDriver(
      bookingId,
      drivers.filter((d) => d.id !== driverId),
      0
    );
  }

  async updateBookingStatus(
    bookingId: string,
    driverId: string,
    status: BookingStatus
  ): Promise<void> {
    const updates: Record<string, Date> = {};

    if (status === BookingStatus.DRIVER_EN_ROUTE)
      updates.dispatchedAt = new Date();
    if (status === BookingStatus.DRIVER_ARRIVED)
      updates.driverArrivedAt = new Date();
    if (status === BookingStatus.IN_PROGRESS)
      updates.tripStartedAt = new Date();
    if (status === BookingStatus.COMPLETED) {
      updates.completedAt = new Date();
      await this.prisma.driver.update({
        where: { id: driverId },
        data: { status: DriverStatus.AVAILABLE, totalJobs: { increment: 1 } },
      });
      await this.redis.del(RedisKeys.activeBooking(driverId));

      // ── Create earnings record ──────────────────────────────────────────
      const completedBooking = await this.prisma.booking.findUnique({
        where: { id: bookingId },
      });
      if (completedBooking) {
        const fare =
          completedBooking.actualFare ?? completedBooking.estimatedFare;
        const platformFee = Math.round(fare * 0.15 * 100) / 100;
        const net = Math.round((fare - platformFee) * 100) / 100;
        await this.prisma.driverEarning.upsert({
          where: { bookingId },
          update: {},
          create: {
            driverId,
            bookingId,
            grossAmount: fare,
            platformFee,
            netAmount: net,
          },
        });
        // Store on booking too
        await this.prisma.booking.update({
          where: { id: bookingId },
          data: { actualFare: fare, driverEarning: net, platformFee },
        });
      }

      if (
        completedBooking?.stripePaymentIntentId &&
        completedBooking?.paymentMethod === "CARD"
      ) {
        try {
          const { StripeService, capturePaymentIntentByMode } = await import(
            "../services/stripe.service"
          );
          const actualPence = StripeService.toPence(
            completedBooking.actualFare ?? completedBooking.estimatedFare
          );
          const feePence = StripeService.calculateStripeFee(actualPence);
          await capturePaymentIntentByMode(
            completedBooking.stripePaymentIntentId,
            actualPence + feePence
          );
        } catch (err) {
          console.error("[Stripe] Capture failed:", err);
        }
      }
    }

    await this.prisma.$transaction([
      this.prisma.booking.update({
        where: { id: bookingId },
        data: { status, ...updates },
      }),
      this.prisma.bookingStatusHistory.create({ data: { bookingId, status } }),
    ]);

    // Socket notifications
    this.io.to(`booking:${bookingId}`).emit(SocketEvent.BOOKING_STATUS_UPDATE, {
      bookingId,
      status,
      timestamp: Date.now(),
    });
    this.io
      .to("admin")
      .emit(SocketEvent.ADMIN_BOOKING_UPDATED, { bookingId, status });

    // ── Push notifications to passenger per status ─────────────────────────
    try {
      const notifBooking = await this.prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
          passenger: { include: { user: true } },
          driver: { include: { user: true } },
        },
      });
      if (notifBooking) {
        const passengerUserId = notifBooking.passenger.userId;
        const driverFirstName =
          notifBooking.driver?.user.firstName ?? "Your driver";

        if (status === BookingStatus.DRIVER_EN_ROUTE) {
          this.notifications
            .notifyDriverEnRoute(passengerUserId, driverFirstName)
            .catch(() => {});
        }
        if (status === BookingStatus.DRIVER_ARRIVED) {
          this.notifications
            .notifyDriverArrived(passengerUserId, driverFirstName)
            .catch(() => {});
        }
        if (status === BookingStatus.IN_PROGRESS) {
          this.notifications.notifyTripStarted(passengerUserId).catch(() => {});
        }
        if (status === BookingStatus.COMPLETED) {
          const fare = notifBooking.actualFare ?? notifBooking.estimatedFare;
          this.notifications
            .notifyTripComplete(passengerUserId, fare)
            .catch(() => {});
        }
      }
    } catch {}
  }

  async manualAssign(bookingId: string, driverId: string): Promise<void> {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
    });
    if (!driver || driver.status !== DriverStatus.AVAILABLE) {
      throw new Error("Driver not available");
    }
    await this.acceptJob(bookingId, driverId);
  }

  private async escalateToManual(
    bookingId: string,
    reason: string
  ): Promise<void> {
    await this.prisma.bookingStatusHistory.create({
      data: {
        bookingId,
        status: BookingStatus.PENDING,
        note: `Escalated to manual dispatch: ${reason}`,
      },
    });
    this.io.to("admin").emit(SocketEvent.ADMIN_BOOKING_UPDATED, {
      bookingId,
      status: "MANUAL_REQUIRED",
      reason,
    });
  }

  async findNearestDrivers(
    lat: number,
    lng: number,
    radiusKm: number
  ): Promise<AvailableDriver[]> {
    const onlineDriverIds = await this.redis.smembers(
      RedisKeys.onlineDrivers()
    );
    if (!onlineDriverIds.length) return [];

    const drivers = await this.prisma.driver.findMany({
      where: {
        id: { in: onlineDriverIds },
        status: DriverStatus.AVAILABLE,
        currentLatitude: { not: null },
        currentLongitude: { not: null },
      },
      include: { vehicle: true },
    });

    const withDistance: AvailableDriver[] = drivers
      .map((d) => ({
        id: d.id,
        distanceKm: this.maps.haversineDistance(
          lat,
          lng,
          d.currentLatitude!,
          d.currentLongitude!
        ),
        vehicleClass: d.vehicle?.class,
      }))
      .filter((d) => d.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    return withDistance;
  }
}

interface AvailableDriver {
  id: string;
  distanceKm: number;
  vehicleClass?: string | null;
}
