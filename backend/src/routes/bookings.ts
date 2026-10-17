import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  BookingType,
  BookingStatus,
  PaymentMethod,
  PaymentStatus,
  PricingType,
} from "@prisma/client";
import { MapsService } from "../services/maps.service";
import { PricingService } from "../services/pricing.service";
import { DispatchService, tripSurchargeAmount } from "../services/dispatch.service";
import { ScheduledBookingService } from "../services/scheduledBooking.service";
import { SocketEvent } from "../types";
import { normalizePhone } from "../lib/phone";
import { withTripVehicle } from "../utils/bookingRecord";

const createBookingSchema = z.object({
  type: z.nativeEnum(BookingType),
  pickupAddress: z.string().min(5),
  pickupLatitude: z.number(),
  pickupLongitude: z.number(),
  dropoffAddress: z.string().min(5),
  dropoffLatitude: z.number(),
  dropoffLongitude: z.number(),
  stops: z
    .array(
      z.object({
        address: z.string(),
        latitude: z.number(),
        longitude: z.number(),
      })
    )
    .optional()
    .default([]),
  scheduledAt: z.string().datetime().optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.CARD),
  pricingType: z.nativeEnum(PricingType).default(PricingType.FIXED),
  passengerCount: z.number().int().min(1).max(16).default(1),
  flightNumber: z.string().optional(),
  flightArrivalTime: z.string().datetime().optional(),
  terminal: z.string().optional(),
  notes: z.string().max(500).optional(),
  vehicleClass: z.string().optional(),
});

export const BOOKED_VIA = ["APP", "WHATSAPP", "PHONE", "EMAIL", "IN_PERSON"] as const;

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Admin "Record completed trip": saves a trip that already happened, straight as COMPLETED with
 * its real times. Skips dispatch, SMS/push, Stripe, wallet settlement and welcome bonus — the
 * trip is over and was paid outside the app. Creates the driver earnings record (commission on
 * fare minus airport surcharges, or none if the operator drove) so driver reports stay complete.
 */
async function recordCompletedTrip(
  fastify: FastifyInstance,
  args: {
    body: {
      type: BookingType;
      pickupAddress: string;
      pickupLatitude: number;
      pickupLongitude: number;
      dropoffAddress: string;
      dropoffLatitude: number;
      dropoffLongitude: number;
      stops: { address: string; latitude: number; longitude: number }[];
      scheduledAt?: string;
      paymentMethod: PaymentMethod;
      passengerCount: number;
      flightNumber?: string;
      terminal?: string;
      notes?: string;
      operatorNotes?: string;
      department?: string;
      pickupZone?: string;
      dropoffZone?: string;
      bookedVia?: (typeof BOOKED_VIA)[number];
      bookedAt?: string;
    };
    pastTrip: {
      driverId: string;
      vehicleId?: string;
      completedAt?: string;
      fare: number;
      noCommission: boolean;
    };
    passengerId: string | null;
    adminUserId: string;
  }
): Promise<{ booking: any } | { error: string }> {
  const { body, pastTrip, passengerId, adminUserId } = args;
  const now = Date.now();

  if (!body.scheduledAt) return { error: "Enter the pickup time of the trip." };
  const pickupAt = new Date(body.scheduledAt);
  if (pickupAt.getTime() > now) return { error: "The pickup time must be in the past." };
  const completedAt = pastTrip.completedAt ? new Date(pastTrip.completedAt) : pickupAt;
  if (completedAt.getTime() < pickupAt.getTime())
    return { error: "The drop-off time must be after the pickup time." };
  if (completedAt.getTime() > now) return { error: "The drop-off time must be in the past." };
  const bookedAt = body.bookedAt ? new Date(body.bookedAt) : null;
  if (bookedAt && bookedAt.getTime() > pickupAt.getTime())
    return { error: "'Booked at' must be before the pickup time." };

  const driver = await fastify.prisma.driver.findUnique({
    where: { id: pastTrip.driverId },
    include: { vehicle: true },
  });
  if (!driver) return { error: "Driver not found." };
  // The car used: the one chosen (it may be an older or retired car), else the driver's current one.
  const vehicle = pastTrip.vehicleId
    ? await fastify.prisma.vehicle.findUnique({ where: { id: pastTrip.vehicleId } })
    : driver.vehicle;
  if (pastTrip.vehicleId && !vehicle) return { error: "Vehicle not found." };

  const fare = r2(pastTrip.fare);
  let platformFee = 0;
  if (!pastTrip.noCommission) {
    const pricing = new PricingService(fastify.prisma);
    const commissionRate = (await pricing.getConfig()).platformCommission ?? 0.15;
    const surcharge = await tripSurchargeAmount(fastify.prisma, body);
    platformFee = r2(Math.max(0, fare - surcharge) * commissionRate);
  }
  const net = r2(fare - platformFee);
  const note = `Recorded after the trip by admin${
    body.bookedVia ? ` (booked via ${body.bookedVia.replace("_", " ").toLowerCase()})` : ""
  }`;

  const booking = await fastify.prisma.$transaction(async (tx) => {
    const created = await tx.booking.create({
      data: {
        reference: generateRef(),
        passengerId,
        driverId: driver.id,
        type: body.type,
        status: BookingStatus.COMPLETED,
        pickupAddress: body.pickupAddress,
        pickupLatitude: body.pickupLatitude,
        pickupLongitude: body.pickupLongitude,
        pickupZone: body.pickupZone,
        dropoffAddress: body.dropoffAddress,
        dropoffLatitude: body.dropoffLatitude,
        dropoffLongitude: body.dropoffLongitude,
        dropoffZone: body.dropoffZone,
        stops: body.stops,
        scheduledAt: pickupAt,
        tripStartedAt: pickupAt,
        completedAt,
        paymentMethod: body.paymentMethod,
        paymentStatus:
          body.paymentMethod === "CASH" ? PaymentStatus.CASH : PaymentStatus.PENDING,
        pricingType: PricingType.FIXED,
        estimatedFare: fare,
        fixedPriceOverride: fare,
        actualFare: fare,
        driverEarning: net,
        platformFee,
        passengerCount: body.passengerCount,
        flightNumber: body.flightNumber,
        terminal: body.terminal,
        notes: body.notes,
        operatorNotes: body.operatorNotes,
        department: body.department,
        driverPhvLicenceNumber: vehicle?.phvLicenceNumber ?? null,
        vehicleId: vehicle?.id ?? null,
        bookedVia: body.bookedVia,
        bookedAt,
        recordedAfterTrip: true,
        recordedBy: adminUserId,
        dispatchedBy: adminUserId,
      },
    });
    await tx.bookingStatusHistory.create({
      data: { bookingId: created.id, status: BookingStatus.COMPLETED, note },
    });
    await tx.driverEarning.create({
      data: {
        driverId: driver.id,
        bookingId: created.id,
        grossAmount: fare,
        platformFee,
        netAmount: net,
      },
    });
    return created;
  });

  return { booking };
}

const generateRef = () =>
  `DS${Date.now().toString(36).toUpperCase()}${Math.random()
    .toString(36)
    .slice(2, 5)
    .toUpperCase()}`;

export async function bookingRoutes(fastify: FastifyInstance) {
  const maps = new MapsService();
  const pricing = new PricingService(fastify.prisma);

  // ─── Quote (no auth required) ───
  fastify.post("/bookings/quote", async (request, reply) => {
    const body = createBookingSchema.parse(request.body);

    const directions = await maps.getDirections(
      { lat: body.pickupLatitude, lng: body.pickupLongitude },
      { lat: body.dropoffLatitude, lng: body.dropoffLongitude }
    );

    const estimate = await pricing.estimateFare({
      distanceMiles: directions.distanceKm * 0.621371,
      durationMinutes: directions.durationMinutes,
      pickupLatitude: body.pickupLatitude,
      pickupLongitude: body.pickupLongitude,
      dropoffLatitude: body.dropoffLatitude,
      dropoffLongitude: body.dropoffLongitude,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : new Date(),
    });

    return reply.send({
      success: true,
      data: {
        ...estimate,
        distanceKm: directions.distanceKm,
        durationMinutes: directions.durationMinutes,
        polyline: directions.polyline,
      },
    });
  });

  // ─── Create booking (passenger) ───
  fastify.post(
    "/bookings",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const body = createBookingSchema.parse(request.body);
      const { userId } = request.user;

      const passenger = await fastify.prisma.passenger.findUnique({
        where: { userId },
      });
      if (!passenger)
        return reply
          .status(404)
          .send({ success: false, error: "Passenger not found" });

      const directions = await maps.getDirections(
        { lat: body.pickupLatitude, lng: body.pickupLongitude },
        { lat: body.dropoffLatitude, lng: body.dropoffLongitude }
      );

      const estimate = await pricing.estimateFare({
        distanceMiles: directions.distanceKm * 0.621371,
        durationMinutes: directions.durationMinutes,
        pickupLatitude: body.pickupLatitude,
        pickupLongitude: body.pickupLongitude,
        dropoffLatitude: body.dropoffLatitude,
        dropoffLongitude: body.dropoffLongitude,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : new Date(),
      });

      // Scheduled bookings (≥2hr lead time) go into SCHEDULED_OPEN and are
      // claimed via the job board, instead of being auto-dispatched.
      let initialStatus: BookingStatus = BookingStatus.PENDING;
      if (body.scheduledAt) {
        const scheduledDate = new Date(body.scheduledAt);
        if (!ScheduledBookingService.hasMinimumLeadTime(scheduledDate)) {
          return reply.status(400).send({
            success: false,
            error: "Scheduled bookings require at least 2 hours' notice",
          });
        }
        initialStatus = BookingStatus.SCHEDULED_OPEN;
      }

      const booking = await fastify.prisma.booking.create({
        data: {
          reference: generateRef(),
          passengerId: passenger.id,
          type: body.type,
          status: initialStatus,
          pickupAddress: body.pickupAddress,
          pickupLatitude: body.pickupLatitude,
          pickupLongitude: body.pickupLongitude,
          dropoffAddress: body.dropoffAddress,
          dropoffLatitude: body.dropoffLatitude,
          dropoffLongitude: body.dropoffLongitude,
          stops: body.stops,
          scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
          paymentMethod: body.paymentMethod,
          pricingType: body.pricingType,
          estimatedFare: estimate.total,
          passengerCount: body.passengerCount,
          flightNumber: body.flightNumber,
          flightArrivalTime: body.flightArrivalTime
            ? new Date(body.flightArrivalTime)
            : null,
          terminal: body.terminal,
          notes: body.notes,
        },
      });

      fastify.io.to("admin").emit(SocketEvent.ADMIN_BOOKING_CREATED, booking);

      // Auto-dispatch if ASAP
      if (!body.scheduledAt) {
        const dispatch = new DispatchService(
          fastify.prisma,
          fastify.redis,
          fastify.io,
          maps
        );
        dispatch
          .dispatchBooking(booking.id)
          .catch((err) => fastify.log.error("Dispatch error:", err));
      }

      return reply.status(201).send({ success: true, data: booking });
    }
  );

  // ─── Get booking by ID (passenger) ───
  fastify.get(
    "/bookings/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const booking = await fastify.prisma.booking.findUnique({
        where: { id },
        include: {
          driver: { include: { user: true, vehicle: true } },
          vehicle: true,
          passenger: { include: { user: true } },
          statusHistory: { orderBy: { createdAt: "asc" } },
          receipt: true,
        },
      });

      if (!booking)
        return reply
          .status(404)
          .send({ success: false, error: "Booking not found" });

      return reply.send({ success: true, data: withTripVehicle(booking) });
    }
  );

  // ─── Get my bookings (passenger) ───
  fastify.get(
    "/bookings/my",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { userId } = request.user;
      const {
        page = "1",
        limit = "20",
        status,
      } = request.query as Record<string, string>;

      const passenger = await fastify.prisma.passenger.findUnique({
        where: { userId },
      });
      if (!passenger)
        return reply.status(404).send({ success: false, error: "Not found" });

      const where = {
        passengerId: passenger.id,
        ...(status ? { status: status as BookingStatus } : {}),
      };

      const [items, total] = await Promise.all([
        fastify.prisma.booking.findMany({
          where,
          include: {
            driver: { include: { user: true, vehicle: true } },
            vehicle: true,
            receipt: true,
          },
          orderBy: { createdAt: "desc" },
          skip: (parseInt(page) - 1) * parseInt(limit),
          take: parseInt(limit),
        }),
        fastify.prisma.booking.count({ where }),
      ]);

      return reply.send({
        success: true,
        data: {
          items: items.map(withTripVehicle),
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      });
    }
  );

  // ─── Cancel booking ───
  fastify.patch(
    "/bookings/:id/cancel",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { reason } = (request.body as any) ?? {};

      const booking = await fastify.prisma.booking.findUnique({
        where: { id },
      });
      if (!booking)
        return reply
          .status(404)
          .send({ success: false, error: "Booking not found" });

      const cancellable: BookingStatus[] = [
        BookingStatus.SCHEDULED_OPEN,
        BookingStatus.PENDING,
        BookingStatus.CONFIRMED,
        BookingStatus.DRIVER_ASSIGNED,
      ];
      if (!cancellable.includes(booking.status))
        return reply.status(400).send({
          success: false,
          error: "Booking cannot be cancelled in its current status",
        });

      await Promise.all([
        fastify.prisma.booking.update({
          where: { id },
          data: {
            status: BookingStatus.CANCELLED,
            cancellationReason: reason ?? "Cancelled by passenger",
          },
        }),
        fastify.prisma.bookingStatusHistory.create({
          data: {
            bookingId: id,
            status: BookingStatus.CANCELLED,
            note: reason,
          },
        }),
      ]);

      fastify.io
        .to(`booking:${id}`)
        .emit(SocketEvent.BOOKING_CANCELLED, { bookingId: id });
      fastify.io.to("admin").emit(SocketEvent.ADMIN_BOOKING_UPDATED, {
        bookingId: id,
        status: BookingStatus.CANCELLED,
      });

      return reply.send({ success: true, message: "Booking cancelled" });
    }
  );

  // ─── Admin: all bookings ───
  fastify.get(
    "/admin/bookings",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const {
        page = "1",
        limit = "50",
        status,
        driverId,
        from,
        to,
      } = request.query as Record<string, string>;

      const where: any = {};
      if (status) {
        const statuses = status.split(",").map((s: string) => s.trim());
        where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
      }
      if (driverId) where.driverId = driverId;
      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = new Date(from);
        if (to) where.createdAt.lte = new Date(to);
      }

      const [items, total] = await Promise.all([
        fastify.prisma.booking.findMany({
          where,
          include: {
            passenger: { include: { user: true } },
            driver: { include: { user: true, vehicle: true } },
            vehicle: true,
            dispatchedByUser: {
              // TfL: dispatcher record
              select: {
                id: true,
                phone: true,
                firstName: true,
                lastName: true,
                adminProfile: { select: { id: true } },
              },
            },
            meetingPoint: { select: { name: true, terminal: true } },
            flightWatch: { select: { unverified: true, status: true } },
          },
          orderBy: { createdAt: "desc" },
          skip: (parseInt(page) - 1) * parseInt(limit),
          take: parseInt(limit),
        }),
        fastify.prisma.booking.count({ where }),
      ]);

      return reply.send({
        success: true,
        data: {
          items: items.map(withTripVehicle),
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      });
    }
  );

  // ─── Admin: create booking on behalf of passenger ───
  fastify.post(
    "/admin/bookings",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const body = createBookingSchema
        .extend({
          passengerPhone: z.string().optional(),
          passengerId: z.string().optional(),
          passengerName: z.string().optional(),
          passengerEmail: z.string().optional(),
          pickupZone: z.string().optional(),
          dropoffZone: z.string().optional(),
          fixedPriceOverride: z.number().optional(),
          isOnHold: z.boolean().optional().default(false),
          allocationTime: z.string().datetime().optional(),
          requiredCarFeatures: z.array(z.string()).optional().default([]),
          requiredDriverFeatures: z.array(z.string()).optional().default([]),
          department: z.string().optional(),
          operatorNotes: z.string().optional(),
          // How/when the passenger booked (shown on the TfL booking record)
          bookedVia: z.enum(BOOKED_VIA).optional(),
          bookedAt: z.string().datetime().optional(),
          // "This trip has already happened": saved straight as COMPLETED, no dispatch/messages
          pastTrip: z
            .object({
              driverId: z.string().min(1),
              vehicleId: z.string().min(1).optional(),
              completedAt: z.string().datetime().optional(),
              fare: z.number().positive(),
              noCommission: z.boolean().optional().default(false),
            })
            .optional(),
        })
        .parse(request.body);

      // Store passenger numbers in E.164 ("+966 56 598 8098" → "+966565988098", "07…" → "+447…"),
      // the same format the passenger app signs in with, so admin and app bookings share one account.
      if (body.passengerPhone) {
        const parsedPhone = normalizePhone(body.passengerPhone);
        if (!parsedPhone)
          return reply.status(400).send({
            success: false,
            error: "Passenger phone number isn't valid. Include the country code, e.g. +966…",
          });
        body.passengerPhone = parsedPhone.e164;
      }

      const adminUserId = request.user.userId; // TfL: record who created

      let passenger = body.passengerId
        ? await fastify.prisma.passenger.findUnique({
            where: { id: body.passengerId },
          })
        : body.passengerPhone
        ? await fastify.prisma.passenger.findFirst({
            where: { user: { phone: body.passengerPhone } },
          })
        : null;

      if (!passenger && body.passengerPhone) {
        const nameParts = (body.passengerName ?? "Unknown").split(" ");

        const existingUser = await fastify.prisma.user.findUnique({
          where: { phone: body.passengerPhone },
          include: { passenger: true },
        });

        if (existingUser) {
          if (!existingUser.passenger) {
            const newPassenger = await fastify.prisma.passenger.create({
              data: { userId: existingUser.id },
            });
            passenger = newPassenger;
          } else {
            passenger = existingUser.passenger;
          }
        } else {
          const newUser = await fastify.prisma.user.create({
            data: {
              phone: body.passengerPhone,
              email: body.passengerEmail || undefined,
              firstName: nameParts[0] ?? "Unknown",
              lastName: nameParts.slice(1).join(" ") || "Customer",
              roles: ["PASSENGER"],
              isVerified: false,
              passenger: { create: {} },
            },
            include: { passenger: true },
          });
          passenger = newUser.passenger;
        }
      }

      if (!passenger && body.type !== "CAREHOME")
        return reply
          .status(400)
          .send({ success: false, error: "Passenger not found" });

      // ── Record a trip that has already happened ─────────────────────────
      if (body.pastTrip) {
        const result = await recordCompletedTrip(fastify, {
          body,
          pastTrip: body.pastTrip,
          passengerId: passenger?.id ?? null,
          adminUserId,
        });
        if ("error" in result)
          return reply.status(400).send({ success: false, error: result.error });
        fastify.io
          .to("admin")
          .emit(SocketEvent.ADMIN_BOOKING_CREATED, result.booking);
        return reply.status(201).send({ success: true, data: result.booking });
      }

      // A pickup time in the past only makes sense for a recorded trip.
      if (body.scheduledAt && new Date(body.scheduledAt).getTime() < Date.now() - 5 * 60_000)
        return reply.status(400).send({
          success: false,
          error:
            "That pickup time has passed. To log a trip that already happened, switch on 'This trip has already happened'.",
        });

      const directions = await maps.getDirections(
        { lat: body.pickupLatitude, lng: body.pickupLongitude },
        { lat: body.dropoffLatitude, lng: body.dropoffLongitude }
      );

      const estimate = await pricing.estimateFare({
        distanceMiles: directions.distanceKm * 0.621371,
        durationMinutes: directions.durationMinutes,
        pickupLatitude: body.pickupLatitude,
        pickupLongitude: body.pickupLongitude,
        dropoffLatitude: body.dropoffLatitude,
        dropoffLongitude: body.dropoffLongitude,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : new Date(),
      });

      // Scheduled bookings with 2+ hours' notice go to the drivers' job board (SCHEDULED_OPEN),
      // as in the passenger app. Admin may also book at shorter notice: those stay CONFIRMED
      // (not auto-dispatched) for the operator to dispatch or assign from the booking.
      let initialStatus: BookingStatus = BookingStatus.CONFIRMED;
      if (body.scheduledAt) {
        const scheduledDate = new Date(body.scheduledAt);
        if (ScheduledBookingService.hasMinimumLeadTime(scheduledDate)) {
          initialStatus = BookingStatus.SCHEDULED_OPEN;
        }
      }

      const booking = await fastify.prisma.booking.create({
        data: {
          reference: generateRef(),
          passengerId: passenger?.id,
          type: body.type,
          status: initialStatus,
          pickupAddress: body.pickupAddress,
          pickupLatitude: body.pickupLatitude,
          pickupLongitude: body.pickupLongitude,
          pickupZone: body.pickupZone,
          dropoffAddress: body.dropoffAddress,
          dropoffLatitude: body.dropoffLatitude,
          dropoffLongitude: body.dropoffLongitude,
          dropoffZone: body.dropoffZone,
          stops: body.stops,
          scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
          allocationTime: body.allocationTime
            ? new Date(body.allocationTime)
            : null,
          paymentMethod: body.paymentMethod,
          pricingType: body.pricingType,
          estimatedFare: body.fixedPriceOverride ?? estimate.total,
          fixedPriceOverride: body.fixedPriceOverride,
          isOnHold: body.isOnHold ?? false,
          passengerCount: body.passengerCount,
          flightNumber: body.flightNumber,
          flightArrivalTime: body.flightArrivalTime
            ? new Date(body.flightArrivalTime)
            : null,
          terminal: body.terminal,
          notes: body.notes,
          operatorNotes: body.operatorNotes,
          requiredCarFeatures: body.requiredCarFeatures ?? [],
          requiredDriverFeatures: body.requiredDriverFeatures ?? [],
          department: body.department,
          bookedVia: body.bookedVia,
          bookedAt: body.bookedAt ? new Date(body.bookedAt) : undefined,
          // TfL: record admin who created this booking
          dispatchedBy: adminUserId,
          dispatchedAt: new Date(),
        },
      });

      fastify.io.to("admin").emit(SocketEvent.ADMIN_BOOKING_CREATED, booking);

      if (!body.scheduledAt) {
        const dispatch = new DispatchService(
          fastify.prisma,
          fastify.redis,
          fastify.io,
          maps
        );
        dispatch
          .dispatchBooking(booking.id)
          .catch((err) => fastify.log.error(err));
      }

      return reply.status(201).send({ success: true, data: booking });
    }
  );
}
