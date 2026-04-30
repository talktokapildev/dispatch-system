import { FastifyInstance } from "fastify";
import { z } from "zod";
import { BookingStatus, DriverStatus } from "@prisma/client";
import { subDays, startOfDay, endOfDay } from "date-fns";
import { DispatchService } from "../services/dispatch.service";
import { MapsService } from "../services/maps.service";
import bcrypt from "bcryptjs";

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
          where: { createdAt: { gte: todayStart, lte: todayEnd } },
        }),
        fastify.prisma.booking.count({
          where: {
            status: BookingStatus.COMPLETED,
            completedAt: { gte: todayStart, lte: todayEnd },
          },
        }),
        fastify.prisma.booking.count({
          where: {
            status: BookingStatus.CANCELLED,
            updatedAt: { gte: todayStart, lte: todayEnd },
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
          },
          _sum: { actualFare: true },
        }),
        fastify.prisma.$queryRaw`
          SELECT
            DATE(created_at) as date,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
            SUM(COALESCE(actual_fare, estimated_fare)) FILTER (WHERE status = 'COMPLETED') as revenue
          FROM "Booking"
          WHERE created_at >= ${weekAgo}
          GROUP BY DATE(created_at)
          ORDER BY date ASC
        `,
        fastify.prisma.driverDocument.count({ where: { status: "PENDING" } }),
        fastify.prisma.driverDocument.count({
          where: {
            expiryDate: {
              lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
            status: "APPROVED",
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
      const drivers = await fastify.prisma.driver.findMany({
        include: {
          user: { select: { firstName: true, lastName: true } },
          vehicle: {
            select: { licensePlate: true, make: true, phvLicenceNumber: true },
          },
        },
      });

      return reply.send({
        success: true,
        data: {
          drivers: drivers.map((d) => ({
            pcoBadgeNumber: d.pcoBadgeNumber,
            firstName: d.user.firstName,
            lastName: d.user.lastName,
          })),
          vehicles: drivers
            .filter((d) => d.vehicle)
            .map((d) => ({
              licensePlate: d.vehicle!.licensePlate,
              make: d.vehicle!.make,
              phvLicenceNumber: d.vehicle!.phvLicenceNumber ?? "",
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
            role: "CORPORATE_ADMIN",
            isVerified: true,
            passwordHash: hash,
            passenger: { create: { corporateAccountId: account.id } },
          },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
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
          role: "CORPORATE_ADMIN",
          isVerified: true,
          passwordHash: hash,
          passenger: { create: { corporateAccountId: id } },
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
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
          dispatchedByUser: dispatcherInclude,
        },
      });
      if (!booking)
        return reply.status(404).send({ success: false, error: "Not found" });
      return reply.send({ success: true, data: booking });
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
          role: { in: ["ADMIN", "DISPATCHER"] },
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
      });
      if (existing)
        return reply
          .status(400)
          .send({ success: false, error: "Phone number already in use" });

      const passwordHash = await bcrypt.hash(body.password, 12);

      const user = await fastify.prisma.user.create({
        data: {
          phone: body.phone,
          email: body.email || undefined,
          firstName: body.firstName,
          lastName: body.lastName,
          role: body.role,
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
        include: {
          adminProfile: true,
        },
      });

      return reply.status(201).send({ success: true, data: user });
    }
  );
}
