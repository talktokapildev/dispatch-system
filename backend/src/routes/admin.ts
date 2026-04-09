import { FastifyInstance } from "fastify";
import { z } from "zod";
import { BookingStatus, DriverStatus } from "@prisma/client";
import { subDays, startOfDay, endOfDay, format } from "date-fns";
import { DispatchService } from "../services/dispatch.service";
import { MapsService } from "../services/maps.service";

const corporateSchema = z.object({
  companyName: z.string().min(2),
  contactName: z.string().min(2),
  contactEmail: z.string().email(),
  contactPhone: z.string(),
  address: z.string(),
  invoicingEmail: z.string().email(),
  paymentTermsDays: z.number().int().default(30),
  creditLimit: z.number().default(0),
});

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
        // Daily totals for chart
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
          alerts: {
            pendingDocuments,
            expiringDocuments,
          },
        },
      });
    }
  );

  // ─── Revenue report ───
  fastify.get(
    "/admin/reports/revenue",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const {
        from,
        to,
        groupBy = "day",
      } = request.query as Record<string, string>;

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

  // ─── Corporate accounts ───
  fastify.get(
    "/admin/corporate",
    { preHandler: [fastify.authenticateAdmin] },
    async (_request, reply) => {
      const accounts = await fastify.prisma.corporateAccount.findMany({
        include: {
          _count: { select: { passengers: true, bookings: true } },
        },
        orderBy: { companyName: "asc" },
      });
      return reply.send({ success: true, data: accounts });
    }
  );

  fastify.post(
    "/admin/corporate",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const body = corporateSchema.parse(request.body);
      const account = await fastify.prisma.corporateAccount.create({
        data: body,
      });
      return reply.status(201).send({ success: true, data: account });
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

      const enriched = await Promise.all(
        drivers.map(async (d) => ({
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
        }))
      );

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

  // ─── Dispatch a booking to nearest driver ───
  fastify.post(
    "/admin/bookings/:id/dispatch",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const maps = new MapsService();
      const dispatch = new DispatchService(
        fastify.prisma,
        fastify.redis,
        fastify.io,
        maps
      );

      // Allow dispatching PENDING or CONFIRMED bookings
      const booking = await fastify.prisma.booking.findUnique({
        where: { id },
      });
      if (!booking)
        return reply
          .status(404)
          .send({ success: false, error: "Booking not found" });
      if (!["PENDING", "CONFIRMED"].includes(booking.status)) {
        return reply
          .status(400)
          .send({
            success: false,
            error: `Cannot dispatch a booking with status ${booking.status}`,
          });
      }

      // Normalise to PENDING so dispatch service accepts it
      await fastify.prisma.booking.update({
        where: { id },
        data: { status: "PENDING" },
      });

      await dispatch.dispatchBooking(id);
      return reply.send({
        success: true,
        message: "Dispatching to nearest available driver",
      });
    }
  );

  // ─── Manually assign a specific driver ───
  fastify.post(
    "/admin/bookings/:id/assign/:driverId",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id, driverId } = request.params as {
        id: string;
        driverId: string;
      };
      const maps = new MapsService();
      const dispatch = new DispatchService(
        fastify.prisma,
        fastify.redis,
        fastify.io,
        maps
      );

      await fastify.prisma.booking.update({
        where: { id },
        data: { status: "PENDING" },
      });

      await dispatch.manualAssign(id, driverId);
      return reply.send({ success: true, message: "Driver assigned" });
    }
  );

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
        },
        include: {
          passenger: { include: { user: true } },
          driver: { include: { user: true } },
        },
      });

      // Broadcast update to admin and relevant sockets
      fastify.io
        .to("admin")
        .emit("admin:booking:updated", {
          bookingId: id,
          status: updated.status,
        });

      return reply.send({ success: true, data: updated });
    }
  );

  // Also add GET single booking for admin
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
        },
      });
      if (!booking)
        return reply.status(404).send({ success: false, error: "Not found" });
      return reply.send({ success: true, data: booking });
    }
  );
}
