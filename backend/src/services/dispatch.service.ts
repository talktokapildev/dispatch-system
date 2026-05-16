import {
  PrismaClient,
  BookingStatus,
  DriverStatus,
  DocumentType,
  DocumentStatus,
} from "@prisma/client";
import Redis from "ioredis";
import { Server as SocketServer } from "socket.io";
import { RedisKeys, RedisTTL } from "../plugins/redis";
import { MapsService } from "./maps.service";
import { NotificationService } from "./notification.service";
import { SocketEvent, JobOfferPayload } from "../types";
import {
  DRIVER_ACCEPT_TIMEOUT_MS,
  MAX_DISPATCH_ATTEMPTS,
  MAX_DRIVER_SEARCH_RADIUS_KM,
} from "../config";

// All 8 document types a driver must have APPROVED (and not expired)
// before they can receive any dispatch offer — auto or manual.
const REQUIRED_DISPATCH_DOCS: DocumentType[] = [
  DocumentType.PCO_LICENSE,
  DocumentType.DRIVING_LICENSE,
  DocumentType.DRIVING_LICENSE_BACK,
  DocumentType.PHV_LICENCE,
  DocumentType.VEHICLE_INSURANCE,
  DocumentType.MOT_CERTIFICATE,
  DocumentType.V5C_LOGBOOK,
  DocumentType.DBS_CHECK,
];

export class DispatchService {
  private notifications: NotificationService;

  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
    private io: SocketServer,
    private maps: MapsService
  ) {
    this.notifications = new NotificationService(prisma);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Document compliance check
  // Returns true only if the driver has every required document with status
  // APPROVED and either no expiry date or an expiry date in the future.
  // ─────────────────────────────────────────────────────────────────────────
  private isDocumentCompliant(
    documents: {
      type: DocumentType;
      status: DocumentStatus;
      expiryDate: Date | null;
    }[]
  ): boolean {
    const now = new Date();
    const validTypes = new Set(
      documents
        .filter(
          (doc) =>
            doc.status === DocumentStatus.APPROVED &&
            (doc.expiryDate === null || doc.expiryDate > now)
        )
        .map((doc) => doc.type)
    );
    return REQUIRED_DISPATCH_DOCS.every((type) => validTypes.has(type));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // dispatchBooking
  // ─────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────
  // offerToDriver
  // ─────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────
  // acceptJob
  // ─────────────────────────────────────────────────────────────────────────
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

    // TfL booking record requirement (from 1 July 2024):
    // Store PHV licence number directly on the booking at assignment time,
    // so it is preserved even if the vehicle is later re-licensed or replaced.
    const driverWithVehicle = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: { vehicle: true },
    });
    const driverPhvLicenceNumber =
      driverWithVehicle?.vehicle?.phvLicenceNumber ?? null;

    // TfL Condition 23: the booking respondent must be recorded.
    // For auto-dispatched bookings (no human dispatcher), stamp the primary
    // operator admin account — the system dispatches on behalf of the operator.
    let dispatchedBy = booking.dispatchedBy ?? null;
    if (!dispatchedBy) {
      const primaryAdmin = await this.prisma.user.findFirst({
        where: { roles: { has: "ADMIN" }, isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      dispatchedBy = primaryAdmin?.id ?? null;
    }

    await this.prisma.$transaction([
      this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          driverId,
          status: BookingStatus.DRIVER_ASSIGNED,
          driverAcceptedAt: new Date(),
          dispatchedAt: new Date(),
          driverPhvLicenceNumber,
          ...(dispatchedBy && { dispatchedBy }),
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
        if (acceptedBooking.passenger) {
          const passengerUserId = acceptedBooking.passenger.userId;
          this.notifications
            .notifyDriverAssigned(passengerUserId, driverName, plate)
            .catch(() => {});
        }
      }
    } catch {}
  }

  // ─────────────────────────────────────────────────────────────────────────
  // rejectJob
  // ─────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────
  // updateBookingStatus
  // ─────────────────────────────────────────────────────────────────────────
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

        // ── Surcharge-aware commission ──────────────────────────────────
        // Airport/zone supplements pass through 100% to the driver (auto-debited).
        // Platform 15% commission applies to base fare only, not surcharge.
        //
        // Example — Crawley → Gatwick (£21.53, £8 surcharge):
        //   platformFee = (21.53 - 8) × 0.15 = £2.03
        //   driverNet   = 21.53 - 2.03        = £19.50  ✓
        let surchargeAmount = 0;
        try {
          const zones = await (this.prisma as any).surchargeZone.findMany({
            where: { active: true },
          });
          const dLat = completedBooking.dropoffLatitude;
          const dLng = completedBooking.dropoffLongitude;
          const pLat = completedBooking.pickupLatitude;
          const pLng = completedBooking.pickupLongitude;
          for (const zone of zones) {
            const poly =
              Array.isArray(zone.polygon) && zone.polygon.length >= 3
                ? (zone.polygon as { lat: number; lng: number }[])
                : null;
            if (poly) {
              if (dispatchPointInPolygon(dLat, dLng, poly))
                surchargeAmount += zone.dropoffFee ?? 0;
              if (dispatchPointInPolygon(pLat, pLng, poly))
                surchargeAmount += zone.pickupFee ?? 0;
            } else if (zone.latitude && zone.longitude && zone.radiusMeters) {
              if (
                dispatchHaversine(dLat, dLng, zone.latitude, zone.longitude) <=
                zone.radiusMeters
              )
                surchargeAmount += zone.dropoffFee ?? 0;
              if (
                dispatchHaversine(pLat, pLng, zone.latitude, zone.longitude) <=
                zone.radiusMeters
              )
                surchargeAmount += zone.pickupFee ?? 0;
            }
          }
        } catch {
          // Zone detection failed — fall back to 0 surcharge (full fare commissionable)
        }

        const baseFare = Math.max(0, r2(fare - surchargeAmount));
        const platformFee = r2(baseFare * 0.15);
        const net = r2(fare - platformFee);
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
        if (!notifBooking.passenger) return;
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

  // ─────────────────────────────────────────────────────────────────────────
  // manualAssign — also enforces document compliance
  // ─────────────────────────────────────────────────────────────────────────
  async manualAssign(bookingId: string, driverId: string): Promise<void> {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: { documents: true },
    });

    if (!driver || driver.status !== DriverStatus.AVAILABLE) {
      throw new Error("Driver not available");
    }

    if (!this.isDocumentCompliant(driver.documents)) {
      throw new Error(
        "Driver does not have all required documents approved. " +
          "Check the Documents page before manually assigning this driver."
      );
    }

    await this.acceptJob(bookingId, driverId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // escalateToManual
  // ─────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────
  // findNearestDrivers
  // Only returns drivers who are online, AVAILABLE, have a location,
  // AND have all 8 required documents APPROVED and not expired.
  // ─────────────────────────────────────────────────────────────────────────
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
      include: {
        vehicle: true,
        documents: {
          select: { type: true, status: true, expiryDate: true },
        },
      },
    });

    const now = new Date();
    const withDistance: AvailableDriver[] = drivers
      // ── Document compliance filter ──────────────────────────────────────
      .filter((d) => {
        const compliant = this.isDocumentCompliant(d.documents);
        if (!compliant) {
          console.log(
            `[Dispatch] Driver ${d.id} excluded — missing or unapproved documents`
          );
        }
        return compliant;
      })
      // ── Distance filter ─────────────────────────────────────────────────
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

// ─── Local geo helpers (mirrors pricing.service.ts) ────────────────────────
// Used for surcharge zone detection at earnings time — avoids importing the
// full PricingService just for polygon/radius lookups.

function dispatchPointInPolygon(
  lat: number,
  lng: number,
  polygon: { lat: number; lng: number }[]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat,
      yi = polygon[i].lng;
    const xj = polygon[j].lat,
      yj = polygon[j].lng;
    const intersect =
      yi > lng !== yj > lng && lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function dispatchHaversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Round to 2 decimal places */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
