import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  BookingStatus,
  BookingType,
  PaymentMethod,
  PricingType,
} from "@prisma/client";
import { MapsService } from "../services/maps.service";
import { PricingService } from "../services/pricing.service";
import { DispatchService } from "../services/dispatch.service";

const generateRef = () =>
  `DS${Date.now().toString(36).toUpperCase()}${Math.random()
    .toString(36)
    .slice(2, 5)
    .toUpperCase()}`;

const createBookingSchema = z.object({
  pickupAddress: z.string().min(3),
  pickupLatitude: z.number(),
  pickupLongitude: z.number(),
  dropoffAddress: z.string().min(3),
  dropoffLatitude: z.number(),
  dropoffLongitude: z.number(),
  passengerCount: z.number().int().min(1).max(8).default(1),
  notes: z.string().max(500).optional(),
  scheduledAt: z.string().datetime().optional(),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CARD"]).default("CASH"),
  stripePaymentIntentId: z.string().optional(),
});

const rateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(300).optional(),
});

export async function passengerRoutes(fastify: FastifyInstance) {
  const maps = new MapsService();
  const pricing = new PricingService(fastify.prisma);

  // ── Auth guard helper ──────────────────────────────────────────────────────
  const getPassenger = async (userId: string) => {
    const p = await fastify.prisma.passenger.findUnique({ where: { userId } });
    return p;
  };

  // ─── GET /bookings/estimate ─────────────────────────────────────────────────
  // Fare + route estimate — called from HomeScreen before booking
  fastify.get(
    "/bookings/estimate",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { pickupLat, pickupLng, dropoffLat, dropoffLng } =
        request.query as Record<string, string>;

      if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
        return reply
          .status(400)
          .send({ success: false, error: "Missing coordinates" });
      }

      const directions = await maps.getDirections(
        { lat: parseFloat(pickupLat), lng: parseFloat(pickupLng) },
        { lat: parseFloat(dropoffLat), lng: parseFloat(dropoffLng) }
      );

      const estimate = await pricing.estimateFare({
        distanceKm: directions.distanceKm,
        durationMinutes: directions.durationMinutes,
        scheduledAt: new Date(),
      });

      return reply.send({
        success: true,
        data: {
          estimatedFare: estimate.total,
          distanceKm: directions.distanceKm,
          durationMins: directions.durationMinutes,
          polyline: directions.polyline,
          breakdown: estimate.breakdown,
        },
      });
    }
  );

  // ─── POST /passengers/bookings ──────────────────────────────────────────────
  // Passenger creates a booking from the app
  fastify.post(
    "/passengers/bookings",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { userId } = request.user;
      const body = createBookingSchema.parse(request.body);

      const passenger = await getPassenger(userId);
      if (!passenger) {
        return reply
          .status(403)
          .send({ success: false, error: "Passenger account not found" });
      }

      // Calculate route + fare
      const directions = await maps.getDirections(
        { lat: body.pickupLatitude, lng: body.pickupLongitude },
        { lat: body.dropoffLatitude, lng: body.dropoffLongitude }
      );

      const estimate = await pricing.estimateFare({
        distanceKm: directions.distanceKm,
        durationMinutes: directions.durationMinutes,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : new Date(),
      });

      const booking = await fastify.prisma.booking.create({
        data: {
          reference: generateRef(),
          passengerId: passenger.id,
          type: body.scheduledAt ? BookingType.PREBOOKED : BookingType.ASAP,
          status: BookingStatus.PENDING,
          pickupAddress: body.pickupAddress,
          pickupLatitude: body.pickupLatitude,
          pickupLongitude: body.pickupLongitude,
          dropoffAddress: body.dropoffAddress,
          dropoffLatitude: body.dropoffLatitude,
          dropoffLongitude: body.dropoffLongitude,
          scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
          paymentMethod: body.paymentMethod as PaymentMethod,
          stripePaymentIntentId: body.stripePaymentIntentId ?? null,
          pricingType: PricingType.FIXED,
          estimatedFare: estimate.total,
          passengerCount: body.passengerCount,
          notes: body.notes,
          stops: [],
        },
      });

      // Notify admin
      fastify.io.to("admin").emit("admin:booking_created", booking);

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
          .catch((err) =>
            fastify.log.error("Passenger booking dispatch error:", err)
          );
      }

      return reply.status(201).send({ success: true, data: booking });
    }
  );

  // ─── GET /passengers/bookings ───────────────────────────────────────────────
  // Paginated ride history
  fastify.get(
    "/passengers/bookings",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { userId } = request.user;
      const {
        page = "1",
        limit = "20",
        status,
      } = request.query as Record<string, string>;

      const passenger = await getPassenger(userId);
      if (!passenger)
        return reply.status(403).send({ success: false, error: "Not found" });

      const where: any = {
        passengerId: passenger.id,
        ...(status ? { status: status as BookingStatus } : {}),
      };

      const [items, total] = await Promise.all([
        fastify.prisma.booking.findMany({
          where,
          include: {
            driver: {
              include: {
                user: true,
                vehicle: true,
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

  // ─── GET /passengers/bookings/:id ───────────────────────────────────────────
  // Full booking detail — used by TrackingScreen
  // Includes driver's last known location so the app can show them on the map
  fastify.get(
    "/passengers/bookings/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { userId } = request.user;
      const { id } = request.params as { id: string };

      const passenger = await getPassenger(userId);
      if (!passenger)
        return reply.status(403).send({ success: false, error: "Not found" });

      const booking = await fastify.prisma.booking.findUnique({
        where: { id },
        include: {
          driver: {
            include: {
              user: {
                select: { firstName: true, lastName: true, phone: true },
              },
              vehicle: true,
            },
          },
          passenger: { include: { user: true } },
          statusHistory: { orderBy: { createdAt: "asc" } },
        },
      });

      if (!booking)
        return reply
          .status(404)
          .send({ success: false, error: "Booking not found" });
      if (booking.passengerId !== passenger.id) {
        return reply
          .status(403)
          .send({ success: false, error: "Access denied" });
      }

      // Attach driver's current location directly on the response so the
      // passenger app can immediately show the driver pin without a separate call
      const enriched: any = { ...booking };
      if (booking.driver) {
        enriched.driver = {
          ...booking.driver,
          lastLatitude: booking.driver.currentLatitude,
          lastLongitude: booking.driver.currentLongitude,
        };
      }

      return reply.send({ success: true, data: enriched });
    }
  );

  // ─── PATCH /passengers/bookings/:id/cancel ──────────────────────────────────
  fastify.patch(
    "/passengers/bookings/:id/cancel",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { userId } = request.user;
      const { id } = request.params as { id: string };

      const passenger = await getPassenger(userId);
      if (!passenger)
        return reply.status(403).send({ success: false, error: "Not found" });

      const booking = await fastify.prisma.booking.findUnique({
        where: { id },
      });
      if (!booking)
        return reply
          .status(404)
          .send({ success: false, error: "Booking not found" });
      if (booking.passengerId !== passenger.id)
        return reply
          .status(403)
          .send({ success: false, error: "Access denied" });

      // Cannot cancel once trip has started
      const cancellable: BookingStatus[] = [
        BookingStatus.PENDING,
        BookingStatus.CONFIRMED,
        BookingStatus.DRIVER_ASSIGNED,
        BookingStatus.DRIVER_EN_ROUTE,
        BookingStatus.DRIVER_ARRIVED,
      ];
      if (!cancellable.includes(booking.status as BookingStatus)) {
        return reply.status(400).send({
          success: false,
          error: "Cannot cancel — trip is already in progress",
        });
      }

      await fastify.prisma.$transaction([
        fastify.prisma.booking.update({
          where: { id },
          data: {
            status: BookingStatus.CANCELLED,
            cancellationReason: "Cancelled by passenger",
          },
        }),
        fastify.prisma.bookingStatusHistory.create({
          data: {
            bookingId: id,
            status: BookingStatus.CANCELLED,
            note: "Cancelled by passenger",
          },
        }),
      ]);

      const { RedisKeys } = await import("../plugins/redis");

      if (booking.driverId) {
        // ── Driver already assigned — free them and notify ─────────────────
        const driver = await fastify.prisma.driver.findUnique({
          where: { id: booking.driverId },
          select: { userId: true },
        });

        await fastify.prisma.driver.update({
          where: { id: booking.driverId },
          data: { status: "AVAILABLE" },
        });

        await fastify.redis.del(RedisKeys.activeBooking(booking.driverId));
        await fastify.redis.sadd(RedisKeys.onlineDrivers(), booking.driverId);

        if (driver) {
          console.log(
            "[Cancel] Emitting to assigned driver room:",
            `driver:${driver.userId}`
          );
          fastify.io.to(`driver:${driver.userId}`).emit("booking:cancelled", {
            bookingId: id,
            message: "Passenger cancelled the booking",
          });
        }
      } else {
        // ── Booking still PENDING — find driver with active offer via Redis lock ──
        const lockedDriverId = await fastify.redis.get(
          RedisKeys.bookingLock(id)
        );
        if (lockedDriverId) {
          const driver = await fastify.prisma.driver.findUnique({
            where: { id: lockedDriverId },
            select: { userId: true },
          });

          // Clear lock so dispatch doesn't try next driver after cancel
          await fastify.redis.del(RedisKeys.bookingLock(id));

          if (driver) {
            console.log(
              "[Cancel] Emitting to offer driver room:",
              `driver:${driver.userId}`
            );
            fastify.io.to(`driver:${driver.userId}`).emit("booking:cancelled", {
              bookingId: id,
              message: "Passenger cancelled the booking",
            });
          }
        }
      }

      // Notify admin
      fastify.io.to("admin").emit("admin:booking_updated", {
        bookingId: id,
        status: "CANCELLED",
      });

      // Notify passenger's own room
      fastify.io
        .to(`passenger:${passenger.userId}`)
        .emit("passenger:status_update", {
          bookingId: id,
          status: "CANCELLED",
        });

      return reply.send({ success: true, message: "Booking cancelled" });
    }
  );

  // ─── POST /passengers/bookings/:id/rate ─────────────────────────────────────
  // 1–5 star driver rating after trip completes
  fastify.post(
    "/passengers/bookings/:id/rate",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { userId } = request.user;
      const { id } = request.params as { id: string };
      const body = rateSchema.parse(request.body);

      const passenger = await getPassenger(userId);
      if (!passenger)
        return reply.status(403).send({ success: false, error: "Not found" });

      const booking = await fastify.prisma.booking.findUnique({
        where: { id },
        include: { driver: true },
      });

      if (!booking)
        return reply.status(404).send({ success: false, error: "Not found" });
      if (booking.passengerId !== passenger.id) {
        return reply
          .status(403)
          .send({ success: false, error: "Access denied" });
      }
      if (booking.status !== BookingStatus.COMPLETED) {
        return reply
          .status(400)
          .send({ success: false, error: "Can only rate completed trips" });
      }

      // Store rating on booking
      await fastify.prisma.booking.update({
        where: { id },
        data: { rating: body.rating },
      });

      // Recalculate driver's average rating
      if (booking.driverId) {
        const ratings = await fastify.prisma.booking.findMany({
          where: {
            driverId: booking.driverId,
            rating: { not: null },
            status: BookingStatus.COMPLETED,
          },
          select: { rating: true },
        });

        const avg =
          ratings.reduce((sum, r) => sum + (r.rating ?? 0), 0) / ratings.length;

        await fastify.prisma.driver.update({
          where: { id: booking.driverId },
          data: { rating: Math.round(avg * 10) / 10 },
        });
      }

      return reply.send({ success: true, data: { ok: true } });
    }
  );

  // ─── PATCH /passengers/profile ─────────────────────────────────────────────
  // First-time name capture + future profile updates
  fastify.patch(
    "/passengers/profile",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { userId } = request.user;

      const body = z
        .object({
          firstName: z.string().min(1).max(50).optional(),
          lastName: z.string().min(1).max(50).optional(),
          email: z.string().email().optional(),
        })
        .parse(request.body);

      // Must have at least one field to update
      if (!body.firstName && !body.lastName && !body.email) {
        return reply
          .status(400)
          .send({ success: false, error: "Nothing to update" });
      }

      const updated = await fastify.prisma.user.update({
        where: { id: userId },
        data: {
          ...(body.firstName !== undefined && { firstName: body.firstName }),
          ...(body.lastName !== undefined && { lastName: body.lastName }),
          ...(body.email !== undefined && { email: body.email }),
        },
      });

      return reply.send({
        success: true,
        data: {
          id: updated.id,
          firstName: updated.firstName,
          lastName: updated.lastName,
          email: updated.email,
          phone: updated.phone,
        },
      });
    }
  );

  // ─── POST /passengers/bookings/:id/payment-intent ──────────────────────────
  // Creates a Stripe PaymentIntent for card payments.
  // Called from BookingConfirmScreen after booking is created.
  fastify.post(
    "/passengers/bookings/:id/payment-intent",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { userId } = request.user;
      const { id } = request.params as { id: string };

      const passenger = await getPassenger(userId);
      if (!passenger)
        return reply.status(403).send({ success: false, error: "Not found" });

      const booking = await fastify.prisma.booking.findUnique({
        where: { id },
      });
      if (!booking)
        return reply
          .status(404)
          .send({ success: false, error: "Booking not found" });
      if (booking.passengerId !== passenger.id) {
        return reply
          .status(403)
          .send({ success: false, error: "Access denied" });
      }

      const { StripeService } = await import("../services/stripe.service");
      const passengerUser = await fastify.prisma.user.findUnique({
        where: { id: userId },
      });
      const stripe = new StripeService(passengerUser?.phone ?? "");

      // Add Stripe fee to amount (1.5% + 20p)
      const basePence = StripeService.toPence(booking.estimatedFare);
      const feePence = StripeService.calculateStripeFee(basePence);
      const totalPence = basePence + feePence;

      const { clientSecret, paymentIntentId } =
        await stripe.createPaymentIntent(totalPence, "gbp", {
          bookingId: id,
          reference: booking.reference,
          passengerId: passenger.id,
        });

      // Store paymentIntentId on booking for capture later
      await fastify.prisma.booking.update({
        where: { id },
        data: { stripePaymentIntentId: paymentIntentId },
      });

      return reply.send({
        success: true,
        data: {
          clientSecret,
          paymentIntentId,
          totalAmount: StripeService.toPounds(totalPence),
        },
      });
    }
  );

  // ─── POST /passengers/payment-intent ───────────────────────────────────────
  // Creates a Stripe PaymentIntent WITHOUT a booking.
  // Called BEFORE booking creation so payment is confirmed first.
  fastify.post(
    "/passengers/payment-intent",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { userId } = request.user;
      const { estimatedFare, currency = "gbp" } = request.body as {
        estimatedFare: number;
        currency?: string;
      };

      const { StripeService } = await import("../services/stripe.service");
      const passengerUser = await fastify.prisma.user.findUnique({
        where: { id: userId },
      });
      const stripe = new StripeService(passengerUser?.phone ?? "");

      const basePence = StripeService.toPence(estimatedFare);
      const feePence = StripeService.calculateStripeFee(basePence);
      const totalPence = basePence + feePence;

      const { clientSecret, paymentIntentId, stripeMode } =
        await stripe.createPaymentIntent(totalPence, currency, {
          estimatedFare: estimatedFare.toString(),
        });

      const stripePublishableKey =
        stripeMode === "test"
          ? process.env.STRIPE_TEST_PUBLIC_KEY!
          : process.env.STRIPE_LIVE_PUBLIC_KEY!;

      return reply.send({
        success: true,
        data: {
          clientSecret,
          paymentIntentId,
          totalAmount: StripeService.toPounds(totalPence),
          stripePublishableKey,
        },
      });
    }
  );

  // ─── DELETE /passengers/payment-intent/:id ─────────────────────────────────
  // Cancels a PaymentIntent when passenger dismisses the payment sheet.
  fastify.delete(
    "/passengers/payment-intent/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { userId } = request.user;
      const { id } = request.params as { id: string };

      try {
        const { StripeService, cancelPaymentIntentByMode } = await import(
          "../services/stripe.service"
        );
        await cancelPaymentIntentByMode(id);
        const passengerUser = await fastify.prisma.user.findUnique({
          where: { id: userId },
        });
        const stripe = new StripeService(passengerUser?.phone ?? "");

        await stripe.cancelPaymentIntent(id);
      } catch {
        // Silent fail — intent may have already expired
      }

      return reply.send({ success: true });
    }
  );

  // ─── DELETE /passengers/me ─────────────────────────────────────────────────
  // Hard-deletes the passenger account and all associated data.
  // Required by Apple App Store Guideline 5.1.1(v)
  fastify.delete(
    "/passengers/me",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { userId } = request.user;

      const passenger = await getPassenger(userId);
      if (!passenger) {
        return reply.status(403).send({ success: false, error: "Not found" });
      }

      // Cancel active bookings
      await fastify.prisma.booking.updateMany({
        where: {
          passengerId: passenger.id,
          status: {
            in: [
              "PENDING",
              "CONFIRMED",
              "DRIVER_ASSIGNED",
              "DRIVER_EN_ROUTE",
              "DRIVER_ARRIVED",
              "IN_PROGRESS",
            ],
          },
        },
        data: { status: "CANCELLED" },
      });

      // Delete in FK-safe order
      await fastify.prisma.bookingStatusHistory.deleteMany({
        where: { booking: { passengerId: passenger.id } },
      });
      await fastify.prisma.receipt.deleteMany({
        where: { booking: { passengerId: passenger.id } },
      });
      await fastify.prisma.booking.deleteMany({
        where: { passengerId: passenger.id },
      });
      await fastify.prisma.savedPaymentMethod.deleteMany({
        where: { passengerId: passenger.id },
      });
      await fastify.prisma.passenger.delete({
        where: { id: passenger.id },
      });
      // OTP codes and refresh tokens
      await fastify.prisma.otpCode.deleteMany({ where: { userId } });
      await fastify.prisma.refreshToken.deleteMany({ where: { userId } });
      await fastify.prisma.user.delete({ where: { id: userId } });

      return reply.send({ success: true, message: "Account deleted" });
    }
  );
}
