import { FastifyInstance } from "fastify";
import { z } from "zod";
import { BookingStatus, DriverStatus } from "@prisma/client";
import { subDays, startOfDay, endOfDay } from "date-fns";
import { DispatchService } from "../services/dispatch.service";
import { MapsService } from "../services/maps.service";
import bcrypt from "bcryptjs";
import { earliestPickupAt } from "../services/flightUpdate.service";
import { withTripVehicle } from "../utils/bookingRecord";
import { NOT_TEST_BOOKING, NOT_TEST_BOOKING_SQL } from "../utils/testBookings";

const corporateSchema = z.object({
  name: z.string().min(2),
  contactName: z.string().min(2),
  contactEmail: z.string().email(),
  contactPhone: z.string(),
  address: z.string(),
  invoicingEmail: z.string().email(),
  paymentTermsDays: z.coerce.number().int().default(30),
  creditLimit: z.coerce.number().default(0),
  portalEmail: z.string().email().optional(),
  portalPassword: z.string().min(8).optional(),
  portalFirstName: z.string().min(1).optional(),
  portalLastName: z.string().min(1).optional(),
});

// Reusable dispatcher include (TfL compliance)
const dispatcherInclude = {
  select: {
    id: true,
    phone: true,
    firstName: true,
    lastName: true,
    adminProfile: { select: { id: true } },
  },
};

export async function adminRoutes(fastify: FastifyInstance) {
  // ─── Dashboard stats ───
  fastify.get(
    "/admin/dashboard",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const today = new Date();
      const todayStart = startOfDay(today);
      const todayEnd = endOfDay(today);
      const weekAgo = subDays(today, 7);

      const [
        totalBookingsToday,
        completedToday,
        cancelledToday,
        activeJobs,
        onlineDrivers,
        totalRevToday,
        weeklyStats,
        pendingDocuments,
        expiringDocuments,
      ] = await Promise.all([
        fastify.prisma.booking.count({
          where: { createdAt: { gte: todayStart, lte: todayEnd }, ...NOT_TEST_BOOKING },
        }),
        fastify.prisma.booking.count({
          where: {
            status: BookingStatus.COMPLETED,
            completedAt: { gte: todayStart, lte: todayEnd },
            ...NOT_TEST_BOOKING,
          },
        }),
        fastify.prisma.booking.count({
          where: {
            status: BookingStatus.CANCELLED,
            updatedAt: { gte: todayStart, lte: todayEnd },
            ...NOT_TEST_BOOKING,
          },
        }),
        fastify.prisma.booking.count({
          where: {
            status: {
              in: [
                BookingStatus.DRIVER_ASSIGNED,
                BookingStatus.DRIVER_EN_ROUTE,
                BookingStatus.DRIVER_ARRIVED,
                BookingStatus.IN_PROGRESS,
              ],
            },
            ...NOT_TEST_BOOKING,
          },
        }),
        fastify.prisma.driver.count({
          where: {
            status: { in: [DriverStatus.AVAILABLE, DriverStatus.ON_JOB] },
          },
        }),
        fastify.prisma.booking.aggregate({
          where: {
            status: BookingStatus.COMPLETED,
            completedAt: { gte: todayStart, lte: todayEnd },
            ...NOT_TEST_BOOKING,
          },
          _sum: { actualFare: true },
        }),
        // Prisma columns are camelCase (no @@map). Days are UK days; counts cast
        // to int (COUNT is BigInt, which JSON can't serialise).
        fastify.prisma.$queryRaw`
          SELECT
            DATE(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London') as date,
            COUNT(*)::int as total,
            (COUNT(*) FILTER (WHERE status = 'COMPLETED'))::int as completed,
            (SUM(COALESCE("actualFare", "estimatedFare")) FILTER (WHERE status = 'COMPLETED'))::float8 as revenue
          FROM "Booking"
          WHERE "createdAt" >= ${weekAgo} AND ${NOT_TEST_BOOKING_SQL}
          GROUP BY 1
          ORDER BY 1 ASC
        `,
        fastify.prisma.driverDocument.count({
          where: { status: "PENDING", replacedAt: null, archivedAt: null },
        }),
        // approved versions in force that expire within 30 days (or already have)
        fastify.prisma.driverDocument.count({
          where: {
            expiryDate: {
              lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
            status: "APPROVED",
            replacedAt: null,
            archivedAt: null,
          },
        }),
      ]);

      return reply.send({
        success: true,
        data: {
          today: {
            totalBookings: totalBookingsToday,
            completed: completedToday,
            cancelled: cancelledToday,
            activeJobs,
            onlineDrivers,
            revenue: totalRevToday._sum.actualFare ?? 0,
          },
          weeklyChart: weeklyStats,
          alerts: { pendingDocuments, expiringDocuments },
        },
      });
    }
  );

  // ─── Revenue report ───
  fastify.get(
    "/admin/reports/revenue",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { from, to } = request.query as Record<string, string>;
      const fromDate = from ? new Date(from) : subDays(new Date(), 30);
      const toDate = to ? new Date(to) : new Date();

      const bookings = await fastify.prisma.booking.findMany({
        where: {
          status: BookingStatus.COMPLETED,
          completedAt: { gte: fromDate, lte: toDate },
          ...NOT_TEST_BOOKING,
        },
        select: {
          completedAt: true,
          actualFare: true,
          estimatedFare: true,
          paymentMethod: true,
          type: true,
          driverEarning: true,
          platformFee: true,
        },
      });

      const totalRevenue = bookings.reduce(
        (s, b) => s + (b.actualFare ?? b.estimatedFare),
        0
      );
      const totalPlatformFee = bookings.reduce(
        (s, b) => s + (b.platformFee ?? 0),
        0
      );
      const byPaymentMethod = bookings.reduce((acc, b) => {
        acc[b.paymentMethod] =
          (acc[b.paymentMethod] ?? 0) + (b.actualFare ?? b.estimatedFare);
        return acc;
      }, {} as Record<string, number>);
      const byType = bookings.reduce((acc, b) => {
        acc[b.type] = (acc[b.type] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return reply.send({
        success: true,
        data: {
          totalRevenue,
          totalPlatformFee,
          totalJobs: bookings.length,
          byPaymentMethod,
          byType,
          averageFare: totalRevenue / (bookings.length || 1),
        },
      });
    }
  );

  // ─── TfL weekly export ───
  fastify.get(
    "/admin/reports/tfl-export",
    { preHandler: [fastify.authenticateAdmin] },
    async (_request, reply) => {
      const [drivers, vehicles] = await Promise.all([
        fastify.prisma.driver.findMany({
          include: { user: { select: { firstName: true, lastName: true } } },
        }),
        // Every licensed vehicle on the fleet (not retired), assigned or not
        fastify.prisma.vehicle.findMany({
          where: { archivedAt: null },
          select: { licensePlate: true, make: true, phvLicenceNumber: true },
          orderBy: { licensePlate: "asc" },
        }),
      ]);

      return reply.send({
        success: true,
        data: {
          drivers: drivers.map((d) => ({
            pcoBadgeNumber: d.pcoBadgeNumber,
            firstName: d.user.firstName,
            lastName: d.user.lastName,
          })),
          vehicles: vehicles.map((v) => ({
            licensePlate: v.licensePlate,
            make: v.make,
            phvLicenceNumber: v.phvLicenceNumber ?? "",
          })),
          generatedAt: new Date().toISOString(),
          weekEnding: new Date().toISOString().split("T")[0],
        },
      });
    }
  );

  // ─── Corporate accounts ───
  fastify.get(
    "/admin/corporate",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { archived } = request.query as { archived?: string };
      const accounts = await fastify.prisma.corporateAccount.findMany({
        where: { isActive: archived !== "true" },
        include: { _count: { select: { passengers: true, bookings: true } } },
        orderBy: { name: "asc" },
      });
      return reply.send({ success: true, data: accounts });
    }
  );

  fastify.post(
    "/admin/corporate",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const body = corporateSchema.parse(request.body);
      const {
        portalEmail,
        portalPassword,
        portalFirstName,
        portalLastName,
        ...accountData
      } = body;

      const account = await fastify.prisma.corporateAccount.create({
        data: accountData,
      });

      let portalUser = null;
      if (portalEmail && portalPassword) {
        const existing = await fastify.prisma.user.findUnique({
          where: { email: portalEmail },
        });
        if (existing) {
          await fastify.prisma.corporateAccount.delete({
            where: { id: account.id },
          });
          return reply
            .status(400)
            .send({ success: false, error: "Email already in use" });
        }
        const hash = await bcrypt.hash(portalPassword, 12);
        portalUser = await fastify.prisma.user.create({
          data: {
            phone: body.contactPhone,
            email: portalEmail,
            firstName: portalFirstName ?? body.contactName.split(" ")[0],
            lastName:
              portalLastName ??
              (body.contactName.split(" ").slice(1).join(" ") || "User"),
            roles: ["CORPORATE_ADMIN"],
            isVerified: true,
            passwordHash: hash,
            passenger: { create: { corporateAccountId: account.id } },
          },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            roles: true,
          },
        });
      }

      return reply
        .status(201)
        .send({ success: true, data: { account, portalUser } });
    }
  );

  fastify.put(
    "/admin/corporate/:id",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = corporateSchema.partial().parse(request.body);
      const account = await fastify.prisma.corporateAccount.update({
        where: { id },
        data: body,
      });
      return reply.send({ success: true, data: account });
    }
  );

  fastify.post(
    "/admin/corporate/:id/login",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { portalEmail, portalPassword, portalFirstName, portalLastName } =
        request.body as {
          portalEmail: string;
          portalPassword: string;
          portalFirstName: string;
          portalLastName: string;
        };

      const account = await fastify.prisma.corporateAccount.findUnique({
        where: { id },
      });
      if (!account)
        return reply
          .status(404)
          .send({ success: false, error: "Account not found" });

      const existing = await fastify.prisma.user.findUnique({
        where: { email: portalEmail },
      });
      if (existing)
        return reply
          .status(400)
          .send({ success: false, error: "Email already in use" });

      const hash = await bcrypt.hash(portalPassword, 12);
      const user = await fastify.prisma.user.create({
        data: {
          phone: `+44${Date.now().toString().slice(-10)}`,
          email: portalEmail,
          firstName: portalFirstName,
          lastName: portalLastName,
          roles: ["CORPORATE_ADMIN"],
          isVerified: true,
          passwordHash: hash,
          passenger: { create: { corporateAccountId: id } },
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          roles: true,
        },
      });
      return reply.status(201).send({ success: true, data: user });
    }
  );

  fastify.patch(
    "/admin/corporate/:id/archive",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const account = await fastify.prisma.corporateAccount.update({
        where: { id },
        data: { isActive: false },
      });
      await fastify.prisma.user.updateMany({
        where: { passenger: { corporateAccountId: id } },
        data: { isActive: false },
      });
      return reply.send({ success: true, data: account });
    }
  );

  fastify.patch(
    "/admin/corporate/:id/reactivate",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const account = await fastify.prisma.corporateAccount.update({
        where: { id },
        data: { isActive: true },
      });
      await fastify.prisma.user.updateMany({
        where: { passenger: { corporateAccountId: id } },
        data: { isActive: true },
      });
      return reply.send({ success: true, data: account });
    }
  );

  fastify.delete(
    "/admin/corporate/:id",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const bookingCount = await fastify.prisma.booking.count({
        where: { corporateAccountId: id },
      });
      if (bookingCount > 0) {
        return reply.status(400).send({
          success: false,
          error: `Cannot delete — account has ${bookingCount} booking(s). Archive it instead.`,
        });
      }
      const passengers = await fastify.prisma.passenger.findMany({
        where: { corporateAccountId: id },
      });
      for (const p of passengers) {
        await fastify.prisma.refreshToken.deleteMany({
          where: { userId: p.userId },
        });
        await fastify.prisma.passenger.delete({ where: { id: p.id } });
        await fastify.prisma.user.delete({ where: { id: p.userId } });
      }
      await fastify.prisma.corporateAccount.delete({ where: { id } });
      return reply.send({ success: true });
    }
  );

  // ─── Maps: live driver positions ───
  fastify.get(
    "/admin/map/drivers",
    { preHandler: [fastify.authenticateAdmin] },
    async (_request, reply) => {
      const drivers = await fastify.prisma.driver.findMany({
        where: {
          status: { in: [DriverStatus.AVAILABLE, DriverStatus.ON_JOB] },
        },
        include: { user: true, vehicle: true },
      });
      const enriched = drivers.map((d) => ({
        id: d.id,
        name: `${d.user.firstName} ${d.user.lastName}`,
        status: d.status,
        vehicle: d.vehicle
          ? `${d.vehicle.make} ${d.vehicle.model} (${d.vehicle.licensePlate})`
          : null,
        vehicleClass: d.vehicle?.class,
        latitude: d.currentLatitude,
        longitude: d.currentLongitude,
        bearing: d.currentBearing,
        lastSeen: d.lastLocationAt,
      }));
      return reply.send({ success: true, data: enriched });
    }
  );

  // ─── Maps: autocomplete proxy ───
  fastify.get(
    "/places/autocomplete",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { input, sessionToken } = request.query as Record<string, string>;
      const { MapsService } = await import("../services/maps.service");
      const maps = new MapsService();
      const results = await maps.autocomplete(input, sessionToken ?? "default");
      return reply.send({ success: true, data: results });
    }
  );

  // ─── Maps: place details proxy ───
  fastify.get(
    "/places/details",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { placeId } = request.query as Record<string, string>;
      const { MapsService } = await import("../services/maps.service");
      const maps = new MapsService();
      const result = await maps.getPlaceDetails(placeId);
      return reply.send({ success: true, data: result });
    }
  );

  // ─── Dispatch booking ───
  fastify.post(
    "/admin/bookings/:id/dispatch",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const adminUserId = request.user.userId;
      const maps = new MapsService();
      const dispatch = new DispatchService(
        fastify.prisma,
        fastify.redis,
        fastify.io,
        maps
      );

      const booking = await fastify.prisma.booking.findUnique({
        where: { id },
      });
      if (!booking)
        return reply
          .status(404)
          .send({ success: false, error: "Booking not found" });
      if (!["PENDING", "CONFIRMED"].includes(booking.status))
        return reply.status(400).send({
          success: false,
          error: `Cannot dispatch a booking with status ${booking.status}`,
        });

      await fastify.prisma.booking.update({
        where: { id },
        data: {
          status: "PENDING",
          dispatchedBy: adminUserId,
          dispatchedAt: new Date(),
        },
      });
      await dispatch.dispatchBooking(id);
      return reply.send({
        success: true,
        message: "Dispatching to nearest available driver",
      });
    }
  );

  // ─── Manually assign driver ───
  fastify.post(
    "/admin/bookings/:id/assign/:driverId",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id, driverId } = request.params as {
        id: string;
        driverId: string;
      };
      const adminUserId = request.user.userId;
      const maps = new MapsService();
      const dispatch = new DispatchService(
        fastify.prisma,
        fastify.redis,
        fastify.io,
        maps
      );

      await fastify.prisma.booking.update({
        where: { id },
        data: {
          status: "PENDING",
          dispatchedBy: adminUserId,
          dispatchedAt: new Date(),
        },
      });
      await dispatch.manualAssign(id, driverId);
      return reply.send({ success: true, message: "Driver assigned" });
    }
  );

  // ─── Edit booking ───
  fastify.patch(
    "/admin/bookings/:id",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        status?: string;
        estimatedFare?: number;
        actualFare?: number | null;
        passengerCount?: number;
        paymentMethod?: string;
        notes?: string | null;
        operatorNotes?: string | null;
        flightNumber?: string | null;
        terminal?: string | null;
      };

      const booking = await fastify.prisma.booking.findUnique({
        where: { id },
      });
      if (!booking)
        return reply
          .status(404)
          .send({ success: false, error: "Booking not found" });

      const dispatcherUpdate =
        body.status === "DRIVER_ASSIGNED" && !booking.dispatchedBy
          ? { dispatchedBy: request.user.userId, dispatchedAt: new Date() }
          : {};

      const updated = await fastify.prisma.booking.update({
        where: { id },
        data: {
          ...(body.status && { status: body.status as any }),
          ...(body.estimatedFare !== undefined && {
            estimatedFare: body.estimatedFare,
          }),
          ...(body.actualFare !== undefined && { actualFare: body.actualFare }),
          ...(body.passengerCount !== undefined && {
            passengerCount: body.passengerCount,
          }),
          ...(body.paymentMethod && {
            paymentMethod: body.paymentMethod as any,
          }),
          ...(body.notes !== undefined && { notes: body.notes }),
          ...(body.operatorNotes !== undefined && {
            operatorNotes: body.operatorNotes,
          }),
          ...(body.flightNumber !== undefined && {
            flightNumber: body.flightNumber,
          }),
          ...(body.terminal !== undefined && { terminal: body.terminal }),
          ...dispatcherUpdate,
        },
        include: {
          passenger: { include: { user: true } },
          driver: { include: { user: true } },
          dispatchedByUser: dispatcherInclude,
        },
      });

      fastify.io.to("admin").emit("admin:booking:updated", {
        bookingId: id,
        status: updated.status,
      });
      return reply.send({ success: true, data: updated });
    }
  );

  // ─── Get single booking ───
  fastify.get(
    "/admin/bookings/:id",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const booking = await fastify.prisma.booking.findUnique({
        where: { id },
        include: {
          passenger: { include: { user: true } },
          driver: { include: { user: true, vehicle: true } },
          vehicle: true,
          dispatchedByUser: dispatcherInclude,
          recordedByUser: { select: { firstName: true, lastName: true } },
          receipt: { select: { billTo: true, issuedAt: true, receiptNumber: true } },
          meetingPoint: { select: { name: true, terminal: true } },
          flightWatch: {
            select: {
              flightNumber: true,
              arrivalDate: true,
              status: true,
              expectedGateArrivalAt: true,
              actualGateArrivalAt: true,
              lastCheckedAt: true,
              unverified: true,
              endedAt: true,
            },
          },
          flightEvents: { orderBy: { createdAt: "asc" } },
          // Booked by phone with Araa (AI receptionist): the call and its transcript
          voiceCall: {
            select: { id: true, outcome: true, startedAt: true, durationSeconds: true, fromNumber: true, transcript: true },
          },
        },
      });
      if (!booking)
        return reply.status(404).send({ success: false, error: "Not found" });
      // Step 6a: when the passenger could be picked up 5+ min earlier
      const earliestAt = earliestPickupAt(booking, booking.flightWatch);
      return reply.send({
        success: true,
        data: { ...withTripVehicle(booking), earlierPickup: earliestAt ? { earliestAt } : null },
      });
    }
  );

  // ═══════════════════════════════════════════════════════
  // TfL Condition 19: STAFF REGISTER
  // ═══════════════════════════════════════════════════════

  // ─── GET /admin/staff — list all admin/dispatcher users with DBS details ───
  fastify.get(
    "/admin/staff",
    { preHandler: [fastify.authenticateAdmin] },
    async (_request, reply) => {
      const staff = await fastify.prisma.user.findMany({
        where: {
          roles: { hasSome: ["ADMIN", "DISPATCHER"] },
          isActive: true,
        },
        include: {
          adminProfile: {
            select: {
              id: true,
              permissions: true,
              dateOfBirth: true,
              dbsCertificateNumber: true,
              dbsCheckDate: true,
            },
          },
        },
        orderBy: { firstName: "asc" },
      });

      return reply.send({ success: true, data: staff });
    }
  );

  // ─── PATCH /admin/staff/:userId — update DBS + DOB for a staff member ───
  fastify.patch(
    "/admin/staff/:userId",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const body = request.body as {
        firstName?: string;
        lastName?: string;
        phone?: string;
        email?: string;
        dateOfBirth?: string | null;
        dbsCertificateNumber?: string | null;
        dbsCheckDate?: string | null;
      };

      // Update user fields — fetch current user first to avoid phone unique constraint
      const currentUser = await fastify.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!currentUser)
        return reply
          .status(404)
          .send({ success: false, error: "User not found" });

      const userUpdate: any = {};
      if (body.firstName) userUpdate.firstName = body.firstName;
      if (body.lastName) userUpdate.lastName = body.lastName;
      if (body.email) userUpdate.email = body.email;
      if (body.phone && body.phone !== currentUser.phone)
        userUpdate.phone = body.phone;

      if (Object.keys(userUpdate).length > 0) {
        await fastify.prisma.user.update({
          where: { id: userId },
          data: userUpdate,
        });
      }

      // Update adminProfile DBS fields
      const profile = await fastify.prisma.adminProfile.upsert({
        where: { userId },
        update: {
          ...(body.dateOfBirth !== undefined && {
            dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
          }),
          ...(body.dbsCertificateNumber !== undefined && {
            dbsCertificateNumber: body.dbsCertificateNumber,
          }),
          ...(body.dbsCheckDate !== undefined && {
            dbsCheckDate: body.dbsCheckDate
              ? new Date(body.dbsCheckDate)
              : null,
          }),
        },
        create: {
          userId,
          permissions: [],
          dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
          dbsCertificateNumber: body.dbsCertificateNumber ?? null,
          dbsCheckDate: body.dbsCheckDate ? new Date(body.dbsCheckDate) : null,
        },
      });

      return reply.send({ success: true, data: profile });
    }
  );

  // ─── POST /admin/staff — create a new staff member ───
  fastify.post(
    "/admin/staff",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const body = request.body as {
        firstName: string;
        lastName: string;
        phone: string;
        email?: string;
        role: "ADMIN" | "DISPATCHER";
        password: string;
        dateOfBirth?: string;
        dbsCertificateNumber?: string;
        dbsCheckDate?: string;
      };

      const existing = await fastify.prisma.user.findUnique({
        where: { phone: body.phone },
        include: { adminProfile: true },
      });

      if (existing) {
        // User already exists — add admin/dispatcher role rather than creating a duplicate.
        // This is the multi-role flow: a passenger or driver can become a staff member.
        const alreadyStaff =
          existing.roles.includes("ADMIN") ||
          existing.roles.includes("DISPATCHER");
        if (alreadyStaff) {
          return reply.status(400).send({
            success: false,
            error: "This user already has admin or dispatcher access.",
          });
        }

        await fastify.prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: existing.id },
            data: { roles: { push: body.role } },
          });
          await tx.adminProfile.upsert({
            where: { userId: existing.id },
            update: {
              dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
              dbsCertificateNumber: body.dbsCertificateNumber ?? null,
              dbsCheckDate: body.dbsCheckDate
                ? new Date(body.dbsCheckDate)
                : null,
            },
            create: {
              userId: existing.id,
              permissions:
                body.role === "ADMIN"
                  ? ["ALL"]
                  : ["BOOKINGS", "DRIVERS", "MAP"],
              dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
              dbsCertificateNumber: body.dbsCertificateNumber ?? null,
              dbsCheckDate: body.dbsCheckDate
                ? new Date(body.dbsCheckDate)
                : null,
            },
          });
        });

        const updated = await fastify.prisma.user.findUnique({
          where: { id: existing.id },
          include: { adminProfile: true },
        });
        return reply.status(200).send({ success: true, data: updated });
      }

      // Brand new user — create with password
      if (!body.password || body.password.length < 8) {
        return reply.status(400).send({
          success: false,
          error: "Password is required (min 8 characters) for new users.",
        });
      }

      const passwordHash = await bcrypt.hash(body.password, 12);

      const user = await fastify.prisma.user.create({
        data: {
          phone: body.phone,
          email: body.email || undefined,
          firstName: body.firstName,
          lastName: body.lastName,
          roles: [body.role],
          isVerified: true,
          passwordHash,
          adminProfile: {
            create: {
              permissions:
                body.role === "ADMIN"
                  ? ["ALL"]
                  : ["BOOKINGS", "DRIVERS", "MAP"],
              dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
              dbsCertificateNumber: body.dbsCertificateNumber ?? null,
              dbsCheckDate: body.dbsCheckDate
                ? new Date(body.dbsCheckDate)
                : null,
            },
          },
        },
        include: { adminProfile: true },
      });

      return reply.status(201).send({ success: true, data: user });
    }
  );

  // ─── DELETE /admin/staff/:userId — remove staff access ───────────────────
  // Removes ADMIN/DISPATCHER role. Deletes adminProfile.
  // If the user has no other roles, marks them inactive (preserves booking history).
  // Never hard-deletes the User record — booking history must be preserved.
  fastify.delete(
    "/admin/staff/:userId",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const requestingUser = (request as any).user;

      if (requestingUser.userId === userId) {
        return reply.status(400).send({
          success: false,
          error: "You cannot remove your own admin access.",
        });
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        return reply
          .status(404)
          .send({ success: false, error: "User not found" });
      }

      const remainingRoles = user.roles.filter(
        (r) => r !== "ADMIN" && r !== "DISPATCHER"
      );

      await fastify.prisma.$transaction(async (tx) => {
        // Remove adminProfile
        await tx.adminProfile.deleteMany({ where: { userId } });

        if (remainingRoles.length === 0) {
          // No remaining roles — deactivate rather than delete
          await tx.user.update({
            where: { id: userId },
            data: { roles: [], isActive: false },
          });
        } else {
          // Has other roles (passenger/driver) — just strip admin roles
          await tx.user.update({
            where: { id: userId },
            data: { roles: remainingRoles as any },
          });
        }
      });

      return reply.send({ success: true, message: "Staff access removed." });
    }
  );

  // Complaints / compliments (TfL Condition 7): see routes/admin/complaints.ts

  // Lost property (TfL Condition 9): see routes/admin/lostProperty.ts

  // ─── Admin: cancel a booking (properly frees driver + clears Redis) ──────────
  fastify.post(
    "/admin/bookings/:id/cancel",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { reason } = (request.body as any) ?? {};

      const booking = await fastify.prisma.booking.findUnique({
        where: { id },
        include: { driver: { include: { user: true } } },
      });

      if (!booking)
        return reply
          .status(404)
          .send({ success: false, error: "Booking not found" });

      if (booking.status === "CANCELLED" || booking.status === "COMPLETED")
        return reply
          .status(400)
          .send({ success: false, error: "Booking already closed" });

      const { RedisKeys } = await import("../plugins/redis");

      // Cancel the booking
      await fastify.prisma.booking.update({
        where: { id },
        data: {
          status: "CANCELLED" as any,
          cancellationReason: reason ?? "Cancelled by admin",
        },
      });

      // Free the driver if one was assigned
      if (booking.driverId && booking.driver) {
        await fastify.prisma.driver.update({
          where: { id: booking.driverId },
          data: { status: "AVAILABLE" as any },
        });
        await fastify.redis.del(RedisKeys.activeBooking(booking.driverId));
        await fastify.redis.sadd(RedisKeys.onlineDrivers(), booking.driverId);

        // Notify driver via socket
        fastify.io
          .to(`driver:${booking.driver.user.id}`)
          .emit("booking:cancelled", {
            bookingId: id,
            message: "Booking cancelled by admin",
          });
      }

      // Notify passenger via socket
      fastify.io
        .to(`passenger:${booking.passengerId}`)
        .emit("booking:cancelled", {
          bookingId: id,
          message: reason ?? "Booking cancelled by admin",
        });

      return reply.send({ success: true, message: "Booking cancelled" });
    }
  );

  // ─── GET /admin/wallet/monthly-stats ─────────────────────────────────────
  fastify.get(
    "/admin/wallet/monthly-stats",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user;
      if (
        !user.roles.some((r: string) => ["ADMIN", "DISPATCHER"].includes(r))
      ) {
        return reply.status(403).send({ success: false, error: "Forbidden" });
      }

      try {
        const { WalletService } = await import("../services/wallet.service");
        const walletService = new WalletService(fastify.prisma);

        const config = await fastify.prisma.pricingConfig.findFirst({
          orderBy: { updatedAt: "desc" },
        });
        const cap = config?.walletMonthlyPromoCap ?? 1000;
        const capRemaining = await walletService.getMonthlyCapRemaining(cap);
        const issuedThisMonth = cap - capRemaining;

        return reply.send({
          success: true,
          data: {
            issuedThisMonth,
            capRemaining,
            cap,
            capPercent: cap > 0 ? (issuedThisMonth / cap) * 100 : 0,
          },
        });
      } catch (err) {
        fastify.log.error({ err }, "[Wallet] monthly-stats failed");
        return reply
          .status(500)
          .send({ success: false, error: "Failed to fetch stats" });
      }
    }
  );

  // ─── GET /admin/passengers/:id/wallet — current balance for admin view ────
  fastify.get(
    "/admin/passengers/:id/wallet",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user;
      if (
        !user.roles.some((r: string) => ["ADMIN", "DISPATCHER"].includes(r))
      ) {
        return reply.status(403).send({ success: false, error: "Forbidden" });
      }

      const { id: passengerId } = request.params as { id: string };

      try {
        const { WalletService } = await import("../services/wallet.service");
        const walletService = new WalletService(fastify.prisma);
        const balance = await walletService.getBalance(passengerId);
        return reply.send({ success: true, data: balance });
      } catch (err) {
        fastify.log.error(
          { err },
          "[Wallet] admin passenger wallet fetch failed"
        );
        return reply
          .status(500)
          .send({ success: false, error: "Failed to fetch wallet" });
      }
    }
  );

  // ─── PATCH /admin/passengers/:id/test-account — mark / unmark a test account ─
  // Bookings by test accounts are hidden from Bookings, Dashboard and Reports
  // by default (utils/testBookings). Nothing is deleted.
  fastify.patch(
    "/admin/passengers/:id/test-account",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z
        .object({ isTestAccount: z.boolean() })
        .safeParse(request.body);
      if (!body.success)
        return reply
          .status(400)
          .send({ success: false, error: "isTestAccount (true/false) is required" });

      const exists = await fastify.prisma.passenger.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!exists)
        return reply
          .status(404)
          .send({ success: false, error: "Passenger not found" });

      const passenger = await fastify.prisma.passenger.update({
        where: { id },
        data: { isTestAccount: body.data.isTestAccount },
        select: { id: true, isTestAccount: true },
      });
      fastify.log.warn(
        `[Admin] passenger ${id} test account ${passenger.isTestAccount ? "ON" : "OFF"} by ${request.user.userId}`
      );
      return reply.send({ success: true, data: passenger });
    }
  );

  // ─── POST /admin/wallet/adjust — manual balance correction ────────────────
  const adjustWalletSchema = z.object({
    passengerId: z.string(),
    amount: z.coerce.number().refine((n) => n !== 0, "Amount cannot be zero"),
    balanceType: z.enum(["promo", "real"]),
    note: z.string().min(3, "A note is required for manual adjustments"),
  });

  fastify.post(
    "/admin/wallet/adjust",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user;
      if (
        !user.roles.some((r: string) => ["ADMIN", "DISPATCHER"].includes(r))
      ) {
        return reply.status(403).send({ success: false, error: "Forbidden" });
      }

      let body;
      try {
        body = adjustWalletSchema.parse(request.body);
      } catch (err: any) {
        return reply.status(400).send({
          success: false,
          error: err.errors?.[0]?.message ?? "Invalid request",
        });
      }

      try {
        const { WalletService } = await import("../services/wallet.service");
        const walletService = new WalletService(fastify.prisma);
        await walletService.adminAdjustBalance(
          body.passengerId,
          body.amount,
          body.balanceType,
          body.note,
          user.userId
        );
        const balance = await walletService.getBalance(body.passengerId);
        return reply.send({ success: true, data: balance });
      } catch (err) {
        fastify.log.error({ err }, "[Wallet] admin adjustment failed");
        return reply
          .status(500)
          .send({ success: false, error: "Failed to adjust wallet" });
      }
    }
  );
  // ─── GET /admin/feedback — passenger star ratings + optional comments ─────
  fastify.get(
    "/admin/feedback",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { page = "1", limit = "30" } = request.query as {
        page?: string;
        limit?: string;
      };
      const take = parseInt(limit, 10);
      const skip = (parseInt(page, 10) - 1) * take;

      const where = { rating: { not: null } };

      const [items, total] = await Promise.all([
        fastify.prisma.booking.findMany({
          where,
          select: {
            id: true,
            reference: true,
            rating: true,
            feedback: true,
            completedAt: true,
            passenger: {
              include: {
                user: {
                  select: { firstName: true, lastName: true, phone: true },
                },
              },
            },
            driver: {
              include: {
                user: { select: { firstName: true, lastName: true } },
              },
            },
          },
          orderBy: { completedAt: "desc" },
          take,
          skip,
        }),
        fastify.prisma.booking.count({ where }),
      ]);

      return reply.send({ success: true, data: { items, total } });
    }
  );
}
