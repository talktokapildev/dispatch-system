import { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import {
  BookingStatus,
  BookingType,
  PaymentMethod,
  PricingType,
} from "@prisma/client";
import { MapsService } from "../services/maps.service";
import { PricingService } from "../services/pricing.service";
import { DispatchService } from "../services/dispatch.service";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const createBookingSchema = z.object({
  pickupAddress: z.string().min(3),
  pickupLatitude: z.number(),
  pickupLongitude: z.number(),
  dropoffAddress: z.string().min(3),
  dropoffLatitude: z.number(),
  dropoffLongitude: z.number(),
  passengerName: z.string().min(1),
  passengerPhone: z.string().optional(),
  poNumber: z.string().optional(),
  notes: z.string().max(500).optional(),
  scheduledAt: z.string().datetime().optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.ACCOUNT),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(6),
  newPassword: z.string().min(8),
});

const generateRef = () =>
  `CR${Date.now().toString(36).toUpperCase()}${Math.random()
    .toString(36)
    .slice(2, 5)
    .toUpperCase()}`;

export async function corporateRoutes(fastify: FastifyInstance) {
  const maps = new MapsService();
  const pricing = new PricingService(fastify.prisma);

  // ─── Helper: get corporate account for logged-in user ────────────────────
  const getCorpAccount = async (userId: string) => {
    const passenger = await fastify.prisma.passenger.findUnique({
      where: { userId },
      include: { corporateAccount: true },
    });
    return passenger?.corporateAccount ?? null;
  };

  // ─── POST /corporate/auth/login ──────────────────────────────────────────
  fastify.post("/corporate/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);

    const user = await fastify.prisma.user.findUnique({
      where: { email: body.email },
      include: {
        passenger: { include: { corporateAccount: true } },
      },
    });

    if (!user || !user.passwordHash) {
      return reply
        .status(401)
        .send({ success: false, error: "Invalid credentials" });
    }

    if (user.role !== "CORPORATE_ADMIN" && user.role !== "PASSENGER") {
      return reply
        .status(403)
        .send({ success: false, error: "Not a corporate account" });
    }

    if (!user.passenger?.corporateAccount) {
      return reply
        .status(403)
        .send({ success: false, error: "No corporate account linked" });
    }

    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) {
      return reply
        .status(401)
        .send({ success: false, error: "Invalid credentials" });
    }

    const token = fastify.jwt.sign({
      userId: user.id,
      role: user.role,
      phone: user.phone,
    });

    return reply.send({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          corporateAccount: user.passenger.corporateAccount,
        },
      },
    });
  });

  // ─── POST /corporate/auth/change-password ────────────────────────────────
  fastify.post(
    "/corporate/auth/change-password",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const body = changePasswordSchema.parse(request.body);
      const user = await fastify.prisma.user.findUnique({
        where: { id: request.user.userId },
      });
      if (!user || !user.passwordHash) {
        return reply
          .status(404)
          .send({ success: false, error: "User not found" });
      }
      const valid = await bcrypt.compare(
        body.currentPassword,
        user.passwordHash
      );
      if (!valid) {
        return reply
          .status(400)
          .send({ success: false, error: "Current password is incorrect" });
      }
      const hash = await bcrypt.hash(body.newPassword, 12);
      await fastify.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hash },
      });
      return reply.send({ success: true });
    }
  );

  // ─── GET /corporate/dashboard ────────────────────────────────────────────
  fastify.get(
    "/corporate/dashboard",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const corpAccount = await getCorpAccount(request.user.userId);
      if (!corpAccount) {
        return reply
          .status(403)
          .send({ success: false, error: "No corporate account" });
      }

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const [monthlyBookings, upcomingCount, recentBookings] =
        await Promise.all([
          fastify.prisma.booking.findMany({
            where: {
              corporateAccountId: corpAccount.id,
              createdAt: { gte: startOfMonth },
              status: { not: BookingStatus.CANCELLED },
            },
            select: { estimatedFare: true, actualFare: true },
          }),
          fastify.prisma.booking.count({
            where: {
              corporateAccountId: corpAccount.id,
              scheduledAt: { gte: now },
              status: {
                in: [BookingStatus.CONFIRMED, BookingStatus.DRIVER_ASSIGNED],
              },
            },
          }),
          fastify.prisma.booking.findMany({
            where: { corporateAccountId: corpAccount.id },
            orderBy: { createdAt: "desc" },
            take: 5,
          }),
        ]);

      const monthlySpend = monthlyBookings.reduce(
        (sum, b) => sum + (b.actualFare ?? b.estimatedFare),
        0
      );

      return reply.send({
        success: true,
        data: {
          monthlySpend: Math.round(monthlySpend * 100) / 100,
          bookingsThisMonth: monthlyBookings.length,
          upcomingCount,
          recentBookings,
        },
      });
    }
  );

  // ─── POST /corporate/bookings ────────────────────────────────────────────
  fastify.post(
    "/corporate/bookings",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const body = createBookingSchema.parse(request.body);
      const { userId } = request.user;

      const passenger = await fastify.prisma.passenger.findUnique({
        where: { userId },
        include: { corporateAccount: true },
      });

      if (!passenger?.corporateAccount) {
        return reply
          .status(403)
          .send({ success: false, error: "No corporate account linked" });
      }

      const corpAccount = passenger.corporateAccount;

      // Calculate fare
      const directions = await maps.getDirections(
        { lat: body.pickupLatitude, lng: body.pickupLongitude },
        { lat: body.dropoffLatitude, lng: body.dropoffLongitude }
      );

      // Surcharge zones (Gatwick, Heathrow etc) are detected automatically
      // via polygon/radius in estimateFare when coordinates are provided
      const estimate = await pricing.estimateFare({
        distanceMiles: directions.distanceKm * 0.621371,
        durationMinutes: directions.durationMinutes,
        pickupLatitude: body.pickupLatitude,
        pickupLongitude: body.pickupLongitude,
        dropoffLatitude: body.dropoffLatitude,
        dropoffLongitude: body.dropoffLongitude,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : new Date(),
      });

      // Build notes with passenger info
      const notesWithPassenger = [
        `Passenger: ${body.passengerName}`,
        body.passengerPhone ? `Phone: ${body.passengerPhone}` : null,
        body.poNumber ? `PO: ${body.poNumber}` : null,
        body.notes ?? null,
      ]
        .filter(Boolean)
        .join("\n");

      const booking = await fastify.prisma.booking.create({
        data: {
          reference: generateRef(),
          passengerId: passenger.id,
          corporateAccountId: corpAccount.id,
          type: body.scheduledAt ? BookingType.PREBOOKED : BookingType.ASAP,
          status: BookingStatus.CONFIRMED,
          pickupAddress: body.pickupAddress,
          pickupLatitude: body.pickupLatitude,
          pickupLongitude: body.pickupLongitude,
          dropoffAddress: body.dropoffAddress,
          dropoffLatitude: body.dropoffLatitude,
          dropoffLongitude: body.dropoffLongitude,
          scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
          paymentMethod: PaymentMethod.ACCOUNT,
          pricingType: PricingType.FIXED,
          estimatedFare: estimate.total,
          passengerCount: 1,
          notes: notesWithPassenger,
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
          .catch((err) => fastify.log.error(err));
      }

      return reply.status(201).send({ success: true, data: booking });
    }
  );

  // ─── GET /corporate/bookings ─────────────────────────────────────────────
  fastify.get(
    "/corporate/bookings",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const corpAccount = await getCorpAccount(request.user.userId);
      if (!corpAccount) {
        return reply
          .status(403)
          .send({ success: false, error: "No corporate account" });
      }

      const {
        page = "1",
        limit = "20",
        status,
      } = request.query as Record<string, string>;

      const where: any = { corporateAccountId: corpAccount.id };
      if (status) where.status = status;

      const [items, total] = await Promise.all([
        fastify.prisma.booking.findMany({
          where,
          include: { driver: { include: { user: true, vehicle: true } } },
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
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      });
    }
  );

  // ─── GET /corporate/bookings/:id ─────────────────────────────────────────
  fastify.get(
    "/corporate/bookings/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const corpAccount = await getCorpAccount(request.user.userId);
      if (!corpAccount)
        return reply
          .status(403)
          .send({ success: false, error: "No corporate account" });

      const { id } = request.params as { id: string };
      const booking = await fastify.prisma.booking.findUnique({
        where: { id },
        include: {
          driver: { include: { user: true, vehicle: true } },
          statusHistory: { orderBy: { createdAt: "asc" } },
        },
      });

      if (!booking)
        return reply.status(404).send({ success: false, error: "Not found" });
      if (booking.corporateAccountId !== corpAccount.id) {
        return reply
          .status(403)
          .send({ success: false, error: "Access denied" });
      }

      return reply.send({ success: true, data: booking });
    }
  );

  // ─── PATCH /corporate/bookings/:id/cancel ────────────────────────────────
  fastify.patch(
    "/corporate/bookings/:id/cancel",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const corpAccount = await getCorpAccount(request.user.userId);
      if (!corpAccount)
        return reply
          .status(403)
          .send({ success: false, error: "No corporate account" });

      const { id } = request.params as { id: string };
      const booking = await fastify.prisma.booking.findUnique({
        where: { id },
      });

      if (!booking)
        return reply.status(404).send({ success: false, error: "Not found" });
      if (booking.corporateAccountId !== corpAccount.id) {
        return reply
          .status(403)
          .send({ success: false, error: "Access denied" });
      }

      const cancellable: string[] = [
        BookingStatus.PENDING,
        BookingStatus.CONFIRMED,
        BookingStatus.DRIVER_ASSIGNED,
      ];
      if (!cancellable.includes(booking.status)) {
        return reply.status(400).send({
          success: false,
          error: "Booking cannot be cancelled at this stage",
        });
      }

      await fastify.prisma.$transaction([
        fastify.prisma.booking.update({
          where: { id },
          data: {
            status: BookingStatus.CANCELLED,
            cancellationReason: "Cancelled by corporate account",
          },
        }),
        fastify.prisma.bookingStatusHistory.create({
          data: {
            bookingId: id,
            status: BookingStatus.CANCELLED,
            note: "Cancelled by corporate account",
          },
        }),
      ]);

      fastify.io
        .to("admin")
        .emit("admin:booking_updated", { bookingId: id, status: "CANCELLED" });

      return reply.send({ success: true });
    }
  );

  // ─── GET /corporate/invoices ─────────────────────────────────────────────
  fastify.get(
    "/corporate/invoices",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const corpAccount = await getCorpAccount(request.user.userId);
      if (!corpAccount)
        return reply
          .status(403)
          .send({ success: false, error: "No corporate account" });

      const invoices = await fastify.prisma.corporateInvoice.findMany({
        where: { corporateAccountId: corpAccount.id },
        include: { _count: { select: { bookings: true } } },
        orderBy: { periodFrom: "desc" },
      });

      return reply.send({ success: true, data: invoices });
    }
  );

  // ─── GET /corporate/account ──────────────────────────────────────────────
  fastify.get(
    "/corporate/account",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const corpAccount = await getCorpAccount(request.user.userId);
      if (!corpAccount)
        return reply
          .status(403)
          .send({ success: false, error: "No corporate account" });
      return reply.send({ success: true, data: corpAccount });
    }
  );
}
