import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  BookingType,
  BookingStatus,
  PaymentMethod,
  PricingType,
} from "@prisma/client";
import { MapsService } from "../services/maps.service";
import { PricingService } from "../services/pricing.service";
import { DispatchService } from "../services/dispatch.service";
import { SocketEvent } from "../types";

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

      const booking = await fastify.prisma.booking.create({
        data: {
          reference: generateRef(),
          passengerId: passenger.id,
          type: body.type,
          status: BookingStatus.PENDING,
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
          passenger: { include: { user: true } },
          statusHistory: { orderBy: { createdAt: "asc" } },
          receipt: true,
        },
      });

      if (!booking)
        return reply
          .status(404)
          .send({ success: false, error: "Booking not found" });

      return reply.send({ success: true, data: booking });
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
          items,
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
          items,
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
        })
        .parse(request.body);

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
              role: "PASSENGER",
              isVerified: false,
              passenger: { create: {} },
            },
            include: { passenger: true },
          });
          passenger = newUser.passenger;
        }
      }

      if (!passenger)
        return reply
          .status(400)
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

      const booking = await fastify.prisma.booking.create({
        data: {
          reference: generateRef(),
          passengerId: passenger.id,
          type: body.type,
          status: BookingStatus.CONFIRMED,
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
