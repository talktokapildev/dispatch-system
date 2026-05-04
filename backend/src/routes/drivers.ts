import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  DriverStatus,
  BookingStatus,
  VehicleClass,
  DocumentType,
} from "@prisma/client";
import { RedisKeys } from "../plugins/redis";
import { DispatchService } from "../services/dispatch.service";
import { MapsService } from "../services/maps.service";
import { NotificationService } from "../services/notification.service"; // ← NEW
import { SocketEvent } from "../types";

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  bearing: z.number().min(0).max(360).optional().default(0),
  speed: z.number().optional(),
});

const statusSchema = z.object({
  status: z.nativeEnum(DriverStatus),
});

// ── UK timezone helper ─────────────────────────────────────────────────────
// Converts a YYYY-MM-DD date string to a UTC Date representing the start or
// end of that day in Europe/London time (handles both GMT and BST automatically)
function toUKDate(dateStr: string, endOfDay = false): Date {
  const time = endOfDay ? "T23:59:59" : "T00:00:00";
  const d = new Date(`${dateStr}${time}`);
  const ukOffset =
    new Date(
      d.toLocaleString("en-US", { timeZone: "Europe/London" })
    ).getTime() - d.getTime();
  return new Date(d.getTime() - ukOffset);
}

export async function driverRoutes(fastify: FastifyInstance) {
  const maps = new MapsService();
  const notifications = new NotificationService(fastify.prisma); // ← NEW

  // ─── Update driver location ───
  fastify.post(
    "/drivers/location",
    { preHandler: [fastify.authenticateDriver] },
    async (request, reply) => {
      const { userId } = request.user;
      const body = locationSchema.parse(request.body);

      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver)
        return reply
          .status(404)
          .send({ success: false, error: "Driver not found" });

      await fastify.prisma.driver.update({
        where: { id: driver.id },
        data: {
          currentLatitude: body.latitude,
          currentLongitude: body.longitude,
          currentBearing: body.bearing,
          lastLocationAt: new Date(),
        },
      });

      const locationData = {
        lat: body.latitude,
        lng: body.longitude,
        bearing: body.bearing,
      };
      await fastify.redis.setex(
        RedisKeys.driverLocation(driver.id),
        300,
        JSON.stringify(locationData)
      );

      // Broadcast to admin
      fastify.io.to("admin").emit(SocketEvent.ADMIN_DRIVER_UPDATE, {
        driverId: driver.id,
        ...locationData,
      });

      // Broadcast to active booking room — passenger TrackingScreen listens
      const activeBookingId = await fastify.redis.get(
        RedisKeys.activeBooking(driver.id)
      );
      if (activeBookingId) {
        fastify.io
          .to(`booking:${activeBookingId}`)
          .emit("booking:driver_location", {
            bookingId: activeBookingId,
            driverId: driver.id,
            latitude: body.latitude,
            longitude: body.longitude,
            bearing: body.bearing,
          });
      }

      return reply.send({ success: true });
    }
  );

  // ─── Update driver status (go online/offline/break) ───
  fastify.patch(
    "/drivers/status",
    { preHandler: [fastify.authenticateDriver] },
    async (request, reply) => {
      const { userId } = request.user;
      const body = statusSchema.parse(request.body);

      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver)
        return reply
          .status(404)
          .send({ success: false, error: "Driver not found" });

      await fastify.prisma.driver.update({
        where: { id: driver.id },
        data: { status: body.status },
      });

      if (body.status === DriverStatus.AVAILABLE) {
        await fastify.redis.sadd(RedisKeys.onlineDrivers(), driver.id);

        // ── Check for pending bookings that need a driver ──────────────────
        // If bookings are waiting (no driver found when they were created),
        // try to dispatch them now that a new driver is online
        const pendingBookings = await fastify.prisma.booking.findMany({
          where: {
            status: BookingStatus.PENDING,
            driverId: null,
            scheduledAt: null, // ASAP only
          },
          orderBy: { createdAt: "asc" },
          take: 5,
        });

        if (pendingBookings.length > 0) {
          const { MapsService } = await import("../services/maps.service");
          const maps = new MapsService();
          const dispatch = new DispatchService(
            fastify.prisma,
            fastify.redis,
            fastify.io,
            maps
          );
          for (const booking of pendingBookings) {
            dispatch
              .dispatchBooking(booking.id)
              .catch((err) =>
                fastify.log.error("Re-dispatch on driver online failed:", err)
              );
          }
        }
      } else if (body.status === DriverStatus.OFFLINE) {
        await fastify.redis.srem(RedisKeys.onlineDrivers(), driver.id);
      }

      fastify.io.to("admin").emit(SocketEvent.ADMIN_DRIVER_UPDATE, {
        driverId: driver.id,
        status: body.status,
      });

      return reply.send({ success: true, data: { status: body.status } });
    }
  );

  // ─── Heartbeat — re-registers driver in Redis while online ───────────────
  // Called every 2 minutes by the driver app while AVAILABLE.
  // Ensures driver stays in drivers:online set even if Redis restarted.
  fastify.patch(
    "/drivers/heartbeat",
    { preHandler: [fastify.authenticateDriver] },
    async (request, reply) => {
      const { userId } = request.user;
      const body = locationSchema.safeParse(request.body);

      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver)
        return reply
          .status(404)
          .send({ success: false, error: "Driver not found" });

      // Only heartbeat if driver is actually AVAILABLE or ON_JOB
      if (
        driver.status !== DriverStatus.AVAILABLE &&
        driver.status !== DriverStatus.ON_JOB
      ) {
        return reply.send({ success: true });
      }

      // Re-add to online set (idempotent — safe to call repeatedly)
      await fastify.redis.sadd(RedisKeys.onlineDrivers(), driver.id);

      // Refresh location if provided
      if (body.success) {
        await fastify.prisma.driver.update({
          where: { id: driver.id },
          data: {
            currentLatitude: body.data.latitude,
            currentLongitude: body.data.longitude,
            currentBearing: body.data.bearing,
            lastLocationAt: new Date(),
          },
        });
        await fastify.redis.setex(
          RedisKeys.driverLocation(driver.id),
          300,
          JSON.stringify({
            lat: body.data.latitude,
            lng: body.data.longitude,
            bearing: body.data.bearing,
          })
        );
      }

      return reply.send({ success: true });
    }
  );

  // ─── Accept job ───
  fastify.post(
    "/drivers/jobs/:bookingId/accept",
    { preHandler: [fastify.authenticateDriver] },
    async (request, reply) => {
      const { bookingId } = request.params as { bookingId: string };
      const { userId } = request.user;

      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver)
        return reply
          .status(404)
          .send({ success: false, error: "Driver not found" });

      const dispatch = new DispatchService(
        fastify.prisma,
        fastify.redis,
        fastify.io,
        maps
      );
      await dispatch.acceptJob(bookingId, driver.id);

      const booking = await fastify.prisma.booking.findUnique({
        where: { id: bookingId },
        include: { passenger: { include: { user: true } } },
      });

      return reply.send({ success: true, data: booking });
    }
  );

  // ─── Reject job ───
  fastify.post(
    "/drivers/jobs/:bookingId/reject",
    { preHandler: [fastify.authenticateDriver] },
    async (request, reply) => {
      const { bookingId } = request.params as { bookingId: string };
      const { userId } = request.user;

      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver)
        return reply
          .status(404)
          .send({ success: false, error: "Driver not found" });

      const dispatch = new DispatchService(
        fastify.prisma,
        fastify.redis,
        fastify.io,
        maps
      );
      await dispatch.rejectJob(bookingId, driver.id);

      return reply.send({ success: true });
    }
  );

  // ─── Driver: cancel an accepted job ───
  fastify.post(
    "/drivers/jobs/:bookingId/cancel",
    { preHandler: [fastify.authenticateDriver] },
    async (request, reply) => {
      const { bookingId } = request.params as { bookingId: string };
      const { reason } = request.body as { reason?: string };
      const { userId } = request.user;

      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver)
        return reply
          .status(404)
          .send({ success: false, error: "Driver not found" });

      const booking = await fastify.prisma.booking.findUnique({
        where: { id: bookingId },
        include: { passenger: true },
      });
      if (!booking)
        return reply
          .status(404)
          .send({ success: false, error: "Booking not found" });

      if (booking.driverId !== driver.id)
        return reply
          .status(403)
          .send({ success: false, error: "Not your booking" });

      const cancellable = [
        "DRIVER_ASSIGNED",
        "DRIVER_EN_ROUTE",
        "DRIVER_ARRIVED",
      ];
      if (!cancellable.includes(booking.status)) {
        return reply.status(400).send({
          success: false,
          error:
            booking.status === "IN_PROGRESS"
              ? "Cannot cancel — trip is already in progress"
              : "Booking cannot be cancelled at this stage",
        });
      }

      await fastify.prisma.$transaction([
        fastify.prisma.booking.update({
          where: { id: bookingId },
          data: {
            status: BookingStatus.PENDING,
            driverId: null,
            driverAcceptedAt: null,
            dispatchedAt: null,
          },
        }),
        fastify.prisma.bookingStatusHistory.create({
          data: {
            bookingId,
            status: BookingStatus.PENDING,
            note: `Driver cancelled: ${reason ?? "No reason given"}`,
          },
        }),
        fastify.prisma.driver.update({
          where: { id: driver.id },
          data: { status: DriverStatus.AVAILABLE },
        }),
      ]);

      await fastify.redis.del(RedisKeys.activeBooking(driver.id));
      await fastify.redis.sadd(RedisKeys.onlineDrivers(), driver.id);

      // Socket notifications
      fastify.io.to(`booking:${bookingId}`).emit("booking:status_update", {
        bookingId,
        status: "PENDING",
        message: "Your driver had to cancel. Finding you a new driver…",
        timestamp: Date.now(),
      });
      fastify.io
        .to(`passenger:${booking.passenger?.userId}`)
        .emit("passenger:status_update", {
          bookingId,
          status: "DRIVER_CANCELLED",
          message: "Your driver had to cancel. Finding you a new driver…",
        });
      fastify.io.to("admin").emit("admin:booking_updated", {
        bookingId,
        status: "PENDING",
        note: `Driver ${driver.id} cancelled`,
      });

      // Push notification to passenger
      // To:
      if (booking.passenger) {
        notifications
          .notifyDriverCancelled(booking.passenger.userId)
          .catch(() => {});
      }

      // Re-dispatch
      const dispatch = new DispatchService(
        fastify.prisma,
        fastify.redis,
        fastify.io,
        maps
      );
      dispatch
        .dispatchBooking(bookingId)
        .catch((err) =>
          fastify.log.error("Re-dispatch after driver cancel failed:", err)
        );

      return reply.send({
        success: true,
        message: "Job cancelled, re-dispatching",
      });
    }
  );

  // ─── Update job status (en route, arrived, start, complete) ───
  fastify.patch(
    "/drivers/jobs/:bookingId/status",
    { preHandler: [fastify.authenticateDriver] },
    async (request, reply) => {
      const { bookingId } = request.params as { bookingId: string };
      const { status } = request.body as { status: BookingStatus };
      const { userId } = request.user;

      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver)
        return reply
          .status(404)
          .send({ success: false, error: "Driver not found" });

      const allowed = [
        "DRIVER_EN_ROUTE",
        "DRIVER_ARRIVED",
        "IN_PROGRESS",
        "COMPLETED",
        "NO_SHOW",
      ];
      if (!allowed.includes(status)) {
        return reply
          .status(400)
          .send({ success: false, error: "Invalid status transition" });
      }

      const dispatch = new DispatchService(
        fastify.prisma,
        fastify.redis,
        fastify.io,
        maps
      );
      await dispatch.updateBookingStatus(bookingId, driver.id, status);

      // Also emit directly to passenger room for instant update
      if (
        [
          "COMPLETED",
          "IN_PROGRESS",
          "DRIVER_EN_ROUTE",
          "DRIVER_ARRIVED",
        ].includes(status)
      ) {
        const booking = await fastify.prisma.booking.findUnique({
          where: { id: bookingId },
          include: { passenger: true },
        });
        if (booking) {
          if (booking.passenger) {
            fastify.io
              .to(`passenger:${booking.passenger.userId}`)
              .emit("passenger:status_update", {
                bookingId,
                status,
              });
          }
        }
      }

      return reply.send({ success: true });
    }
  );

  // ─── Driver earnings ───
  fastify.get(
    "/drivers/earnings",
    { preHandler: [fastify.authenticateDriver] },
    async (request, reply) => {
      const { userId } = request.user;
      const { from, to } = request.query as Record<string, string>;

      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver)
        return reply.status(404).send({ success: false, error: "Not found" });

      const where: any = {
        driverId: driver.id,
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: toUKDate(from) } : {}),
                ...(to ? { lte: toUKDate(to, true) } : {}),
              },
            }
          : {}),
      };

      const earnings = await fastify.prisma.driverEarning.findMany({
        where,
        orderBy: { createdAt: "desc" },
      });

      const totalGross = earnings.reduce((s, e) => s + e.grossAmount, 0);
      const totalNet = earnings.reduce((s, e) => s + e.netAmount, 0);
      const totalFee = earnings.reduce((s, e) => s + e.platformFee, 0);

      return reply.send({
        success: true,
        data: {
          earnings,
          summary: {
            totalGross,
            totalNet,
            totalFee,
            jobCount: earnings.length,
          },
        },
      });
    }
  );

  // ─── Driver: get completed jobs ───
  fastify.get(
    "/drivers/jobs",
    { preHandler: [fastify.authenticateDriver] },
    async (request, reply) => {
      const { userId } = request.user;
      const { page = "1", limit = "20" } = request.query as Record<
        string,
        string
      >;

      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver)
        return reply.status(404).send({ success: false, error: "Not found" });

      const [items, total] = await Promise.all([
        fastify.prisma.booking.findMany({
          where: { driverId: driver.id },
          orderBy: { createdAt: "desc" },
          skip: (parseInt(page) - 1) * parseInt(limit),
          take: parseInt(limit),
        }),
        fastify.prisma.booking.count({ where: { driverId: driver.id } }),
      ]);

      return reply.send({
        success: true,
        data: { items, total, page: parseInt(page), limit: parseInt(limit) },
      });
    }
  );

  // ─── Admin: list all drivers ───
  fastify.get(
    "/admin/drivers",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const {
        page = "1",
        limit = "50",
        status,
      } = request.query as Record<string, string>;

      const where: any = {};
      if (status) where.status = status;

      const [items, total] = await Promise.all([
        fastify.prisma.driver.findMany({
          where,
          include: { user: true, vehicle: true },
          orderBy: { createdAt: "desc" },
          skip: (parseInt(page) - 1) * parseInt(limit),
          take: parseInt(limit),
        }),
        fastify.prisma.driver.count({ where }),
      ]);

      return reply.send({
        success: true,
        data: { items, total, page: parseInt(page), limit: parseInt(limit) },
      });
    }
  );

  // ─── Admin: driver document review ───
  fastify.patch(
    "/admin/drivers/:driverId/documents/:docId",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { driverId, docId } = request.params as {
        driverId: string;
        docId: string;
      };
      const { status, notes } = request.body as {
        status: "APPROVED" | "REJECTED";
        notes?: string;
      };

      const doc = await fastify.prisma.driverDocument.update({
        where: { id: docId },
        data: {
          status,
          notes,
          reviewedAt: new Date(),
          reviewedBy: request.user.userId,
        },
      });

      return reply.send({ success: true, data: doc });
    }
  );

  // ─── Admin: expiring documents alert ───
  fastify.get(
    "/admin/drivers/documents/expiring",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { days = "30" } = request.query as Record<string, string>;
      const threshold = new Date();
      threshold.setDate(threshold.getDate() + parseInt(days));

      const docs = await fastify.prisma.driverDocument.findMany({
        where: { expiryDate: { lte: threshold }, status: "APPROVED" },
        include: { driver: { include: { user: true } } },
        orderBy: { expiryDate: "asc" },
      });

      return reply.send({ success: true, data: docs });
    }
  );

  // ─── Admin: create driver ───
  fastify.post(
    "/admin/drivers",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const body = z
        .object({
          firstName: z.string().min(1),
          lastName: z.string().min(1),
          phone: z.string().min(10),
          email: z.string().email().optional(),
          pcoBadgeNumber: z.string().min(1),
          pcoLicenseExpiry: z.string(),
          drivingLicenseNumber: z.string().min(1),
          vehicle: z.object({
            make: z.string().min(1),
            model: z.string().min(1),
            year: z.number().int(),
            colour: z.string().default(""),
            licensePlate: z.string().min(1),
            class: z.nativeEnum(VehicleClass).default(VehicleClass.STANDARD),
            seats: z.number().int().default(4),
            motExpiry: z.string(),
            insuranceExpiry: z.string(),
            phvLicenceNumber: z.string().optional(),
            phvLicenceExpiry: z.string().optional(),
            phvDiscNumber: z.string().optional(),
            emissionStandard: z.string().optional(),
            isUlezCompliant: z.boolean().default(false),
          }),
        })
        .parse(request.body);

      try {
        const result = await fastify.prisma.$transaction(async (tx) => {
          // Check if user already exists (e.g. passenger becoming a driver)
          const existingUser = await tx.user.findUnique({
            where: { phone: body.phone },
          });

          if (existingUser) {
            const existingDriver = await tx.driver.findUnique({
              where: { userId: existingUser.id },
            });
            if (existingDriver) {
              throw Object.assign(
                new Error("Driver already exists for this user"),
                { code: "P2002", meta: { target: ["phone"] } }
              );
            }
          }

          const user =
            existingUser ??
            (await tx.user.create({
              data: {
                firstName: body.firstName,
                lastName: body.lastName,
                phone: body.phone,
                email: body.email,
                role: "DRIVER",
                isVerified: true,
                isActive: true,
              },
            }));

          if (existingUser) {
            await tx.user.update({
              where: { id: existingUser.id },
              data: {
                firstName: body.firstName || existingUser.firstName,
                lastName: body.lastName || existingUser.lastName,
                ...(body.email && { email: body.email }),
              },
            });
          }

          const driver = await tx.driver.create({
            data: {
              userId: user.id,
              pcoBadgeNumber: body.pcoBadgeNumber,
              pcoLicenseExpiry: new Date(body.pcoLicenseExpiry),
              drivingLicenseNumber: body.drivingLicenseNumber,
              status: DriverStatus.OFFLINE,
              onboardingComplete: false,
            },
          });
          const vehicle = await tx.vehicle.create({
            data: {
              driverId: driver.id,
              make: body.vehicle.make,
              model: body.vehicle.model,
              year: body.vehicle.year,
              colour: body.vehicle.colour,
              licensePlate: body.vehicle.licensePlate.toUpperCase(),
              class: body.vehicle.class,
              seats: body.vehicle.seats,
              motExpiry: new Date(body.vehicle.motExpiry),
              insuranceExpiry: new Date(body.vehicle.insuranceExpiry),
              phvLicenceNumber: body.vehicle.phvLicenceNumber ?? null,
              phvLicenceExpiry: body.vehicle.phvLicenceExpiry
                ? new Date(body.vehicle.phvLicenceExpiry)
                : null,
              phvDiscNumber: body.vehicle.phvDiscNumber ?? null,
              emissionStandard: body.vehicle.emissionStandard ?? null,
              isUlezCompliant: body.vehicle.isUlezCompliant ?? false,
            },
          });
          return { user, driver, vehicle };
        });

        return reply.status(201).send({ success: true, data: result });
      } catch (err: any) {
        if (err.code === "P2002") {
          const field = err.meta?.target?.[0] ?? "field";
          return reply.status(409).send({
            success: false,
            error: `A driver with this ${field} already exists`,
          });
        }
        throw err;
      }
    }
  );

  // ─── Admin: edit driver ───
  fastify.put(
    "/admin/drivers/:driverId",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { driverId } = request.params as { driverId: string };
      const body = z
        .object({
          firstName: z.string().min(1).optional(),
          lastName: z.string().min(1).optional(),
          phone: z.string().optional(),
          email: z.string().email().optional().nullable(),
          pcoBadgeNumber: z.string().optional(),
          pcoLicenseExpiry: z.string().optional(),
          drivingLicenseNumber: z.string().optional(),
          vehicle: z
            .object({
              make: z.string().optional(),
              model: z.string().optional(),
              year: z.number().int().optional(),
              colour: z.string().optional(),
              licensePlate: z.string().optional(),
              class: z.nativeEnum(VehicleClass).optional(),
              seats: z.number().int().optional(),
              motExpiry: z.string().optional(),
              insuranceExpiry: z.string().optional(),
              phvLicenceNumber: z.string().optional().nullable(),
              phvLicenceExpiry: z.string().optional().nullable(),
              phvDiscNumber: z.string().optional().nullable(),
              emissionStandard: z.string().optional().nullable(),
              isUlezCompliant: z.boolean().optional(),
            })
            .optional(),
        })
        .parse(request.body);

      const driver = await fastify.prisma.driver.findUnique({
        where: { id: driverId },
        include: { user: true, vehicle: true },
      });
      if (!driver)
        return reply
          .status(404)
          .send({ success: false, error: "Driver not found" });

      await fastify.prisma.$transaction(async (tx) => {
        if (
          body.firstName ||
          body.lastName ||
          body.phone ||
          body.email !== undefined
        ) {
          await tx.user.update({
            where: { id: driver.userId },
            data: {
              ...(body.firstName && { firstName: body.firstName }),
              ...(body.lastName && { lastName: body.lastName }),
              ...(body.phone && { phone: body.phone }),
              ...(body.email !== undefined && { email: body.email }),
            },
          });
        }
        await tx.driver.update({
          where: { id: driverId },
          data: {
            ...(body.pcoBadgeNumber && { pcoBadgeNumber: body.pcoBadgeNumber }),
            ...(body.pcoLicenseExpiry && {
              pcoLicenseExpiry: new Date(body.pcoLicenseExpiry),
            }),
            ...(body.drivingLicenseNumber && {
              drivingLicenseNumber: body.drivingLicenseNumber,
            }),
          },
        });
        if (body.vehicle && driver.vehicle) {
          await tx.vehicle.update({
            where: { driverId },
            data: {
              ...(body.vehicle.make && { make: body.vehicle.make }),
              ...(body.vehicle.model && { model: body.vehicle.model }),
              ...(body.vehicle.year && { year: body.vehicle.year }),
              ...(body.vehicle.colour !== undefined && {
                colour: body.vehicle.colour,
              }),
              ...(body.vehicle.licensePlate && {
                licensePlate: body.vehicle.licensePlate.toUpperCase(),
              }),
              ...(body.vehicle.class && { class: body.vehicle.class }),
              ...(body.vehicle.seats && { seats: body.vehicle.seats }),
              ...(body.vehicle.motExpiry && {
                motExpiry: new Date(body.vehicle.motExpiry),
              }),
              ...(body.vehicle.insuranceExpiry && {
                insuranceExpiry: new Date(body.vehicle.insuranceExpiry),
              }),
              ...(body.vehicle.phvLicenceNumber !== undefined && {
                phvLicenceNumber: body.vehicle.phvLicenceNumber,
              }),
              ...(body.vehicle.phvLicenceExpiry !== undefined && {
                phvLicenceExpiry: body.vehicle.phvLicenceExpiry
                  ? new Date(body.vehicle.phvLicenceExpiry)
                  : null,
              }),
              ...(body.vehicle.phvDiscNumber !== undefined && {
                phvDiscNumber: body.vehicle.phvDiscNumber,
              }),
              ...(body.vehicle.emissionStandard !== undefined && {
                emissionStandard: body.vehicle.emissionStandard,
              }),
              ...(body.vehicle.isUlezCompliant !== undefined && {
                isUlezCompliant: body.vehicle.isUlezCompliant,
              }),
            },
          });
        }
      });

      const updated = await fastify.prisma.driver.findUnique({
        where: { id: driverId },
        include: { user: true, vehicle: true },
      });
      return reply.send({ success: true, data: updated });
    }
  );

  // ─── Admin: delete driver ───
  fastify.delete(
    "/admin/drivers/:driverId",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { driverId } = request.params as { driverId: string };

      const driver = await fastify.prisma.driver.findUnique({
        where: { id: driverId },
        include: { user: true },
      });
      if (!driver)
        return reply
          .status(404)
          .send({ success: false, error: "Driver not found" });

      await fastify.prisma.$transaction(async (tx) => {
        await tx.booking.updateMany({
          where: { driverId },
          data: { driverId: null },
        });
        await tx.driverEarning.deleteMany({ where: { driverId } });
        await tx.driverDocument.deleteMany({ where: { driverId } });
        await tx.vehicle.deleteMany({ where: { driverId } });
        await tx.driver.delete({ where: { id: driverId } });
        await tx.pushToken.deleteMany({ where: { userId: driver.userId } });
        await tx.otpCode.deleteMany({ where: { userId: driver.userId } });
        await tx.refreshToken.deleteMany({ where: { userId: driver.userId } });
        // Only delete user if they have no other roles (e.g. passenger record)
        const passenger = await tx.passenger.findUnique({
          where: { userId: driver.userId },
        });
        if (!passenger) {
          await tx.user.delete({ where: { id: driver.userId } });
        }
      });

      return reply.send({ success: true });
    }
  );

  // ─── Admin: delete passenger ───
  fastify.delete(
    "/admin/passengers/:id",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const passenger = await fastify.prisma.passenger.findUnique({
        where: { id },
        include: { user: true },
      });
      if (!passenger)
        return reply
          .status(404)
          .send({ success: false, error: "Passenger not found" });

      await fastify.prisma.$transaction(async (tx) => {
        const bookings = await tx.booking.findMany({
          where: { passengerId: id },
          select: { id: true },
        });
        const bookingIds = bookings.map((b) => b.id);
        await tx.bookingStatusHistory.deleteMany({
          where: { bookingId: { in: bookingIds } },
        });
        await tx.receipt.deleteMany({
          where: { bookingId: { in: bookingIds } },
        });
        await tx.booking.deleteMany({ where: { passengerId: id } });
        await tx.savedPaymentMethod.deleteMany({ where: { passengerId: id } });
        await tx.passenger.delete({ where: { id } });
        await tx.otpCode.deleteMany({ where: { userId: passenger.userId } });
        await tx.refreshToken.deleteMany({
          where: { userId: passenger.userId },
        });
        await tx.user.delete({ where: { id: passenger.userId } });
      });

      return reply.send({ success: true });
    }
  );

  // ─── Driver: get own documents ───
  fastify.get(
    "/drivers/documents",
    { preHandler: [fastify.authenticateDriver] },
    async (request, reply) => {
      const { userId } = request.user;
      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver)
        return reply
          .status(404)
          .send({ success: false, error: "Driver not found" });

      const documents = await fastify.prisma.driverDocument.findMany({
        where: { driverId: driver.id },
        orderBy: { createdAt: "desc" },
      });
      return reply.send({ success: true, data: documents });
    }
  );

  // ─── Driver: upload document ───
  fastify.post(
    "/drivers/documents",
    { preHandler: [fastify.authenticateDriver] },
    async (request, reply) => {
      const { userId } = request.user;
      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver)
        return reply
          .status(404)
          .send({ success: false, error: "Driver not found" });

      let type: string | null = null;
      let fileUrl: string = `uploads/placeholder_${Date.now()}.jpg`;

      for await (const part of request.parts()) {
        if (part.type === "field" && part.fieldname === "type") {
          type = part.value as string;
        } else if (part.type === "file") {
          await part.toBuffer();
          fileUrl = `uploads/${driver.id}/${
            part.filename ?? type
          }_${Date.now()}.jpg`;
        }
      }

      if (!type)
        return reply
          .status(400)
          .send({ success: false, error: "Document type is required" });

      if (!Object.values(DocumentType).includes(type as DocumentType))
        return reply
          .status(400)
          .send({ success: false, error: "Invalid document type" });

      const docType = type as DocumentType;
      const existing = await fastify.prisma.driverDocument.findFirst({
        where: { driverId: driver.id, type: docType },
        select: { id: true },
      });

      const doc = await fastify.prisma.driverDocument.upsert({
        where: { id: existing?.id ?? "" },
        create: {
          driverId: driver.id,
          type: docType,
          fileUrl,
          status: "PENDING",
        },
        update: {
          fileUrl,
          status: "PENDING",
          notes: null,
          reviewedAt: null,
          reviewedBy: null,
        },
      });

      return reply.status(201).send({ success: true, data: doc });
    }
  );

  // ─── Get directions for map routing ───
  // Open to both drivers AND passengers (authenticate, not authenticateDriver)
  fastify.get(
    "/maps/directions",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { originLat, originLng, destLat, destLng } =
        request.query as Record<string, string>;
      const mapsService = new MapsService();
      try {
        const result = await mapsService.getDirections(
          { lat: parseFloat(originLat), lng: parseFloat(originLng) },
          { lat: parseFloat(destLat), lng: parseFloat(destLng) }
        );
        return reply.send({ success: true, data: result });
      } catch {
        return reply
          .status(500)
          .send({ success: false, error: "Could not fetch route" });
      }
    }
  );

  // ─── Push token registration (shared — used by driver + passenger apps) ───
  fastify.post(
    "/notifications/token",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { userId } = request.user;
      const { token, platform } = request.body as {
        token: string;
        platform: string;
      };

      if (!token || !platform)
        return reply
          .status(400)
          .send({ success: false, error: "token and platform are required" });

      await fastify.prisma.pushToken.upsert({
        where: { userId_token: { userId, token } },
        update: { platform, updatedAt: new Date() },
        create: { userId, token, platform },
      });

      return reply.send({ success: true });
    }
  );

  // ─── Push token deregistration (called on logout) ───
  fastify.delete(
    "/notifications/token",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { userId } = request.user;
      const { token } = request.body as { token?: string };

      if (token) {
        await fastify.prisma.pushToken.deleteMany({ where: { userId, token } });
      } else {
        // No token specified — clear all tokens for this user (full logout)
        await fastify.prisma.pushToken.deleteMany({ where: { userId } });
      }

      return reply.send({ success: true });
    }
  );
}
