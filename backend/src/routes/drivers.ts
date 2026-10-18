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
import {
  NotificationService,
  PUSH_APPS,
  PushApp,
} from "../services/notification.service";
import { PricingService } from "../services/pricing.service";
import { readDocumentUpload } from "../services/documentUpload";
import { fileLinker } from "../services/fileLinks";
import {
  checkDriverCanWork,
  gatingEnabled,
  loadCompliance,
  loadComplianceMany,
} from "../services/documentCompliance.service";
import {
  DOC_LABELS,
  DocType,
  blockMessage,
  isDocType,
  isVehicleType,
  legacyEligibility,
  parseExpiryDate,
  problemSummary,
  typeStatus,
} from "../services/documentRules";
import {
  DocumentError,
  addDocumentVersion,
  notifyReview,
  reviewDocument,
} from "../services/documentReview.service";
import { SocketEvent } from "../types";
import { isValidEncodedPolyline } from "../utils/polyline";
import { VehicleError, setDriverVehicle } from "../services/vehicle.service";

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

      if (body.status === DriverStatus.AVAILABLE) {
        const docs = await checkDriverCanWork(
          fastify.prisma,
          driver.id,
          "going online",
          request.log
        );
        if (!docs.ok)
          return reply
            .status(403)
            .send({ success: false, error: docs.message, reason: "documents" });
      }

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
      try {
        await dispatch.acceptJob(bookingId, driver.id);
      } catch (err: any) {
        return reply.status(400).send({
          success: false,
          error: err.message ?? "Job no longer available",
        });
      }

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
            driverPhvLicenceNumber: null,
            vehicleId: null,
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
      const { status, actualDistance, actualDuration, actualRoutePolyline } =
        request.body as {
          status: BookingStatus;
          actualDistance?: number;
          actualDuration?: number;
          actualRoutePolyline?: string;
        };
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

      // Setting off for a job: documents must be in order (trips under way are never stopped)
      if (status === "DRIVER_EN_ROUTE") {
        const current = await fastify.prisma.booking.findUnique({
          where: { id: bookingId },
          select: { status: true },
        });
        if (current?.status === "DRIVER_ASSIGNED") {
          const docs = await checkDriverCanWork(
            fastify.prisma,
            driver.id,
            "setting off",
            request.log
          );
          if (!docs.ok)
            return reply
              .status(403)
              .send({ success: false, error: docs.message, reason: "documents" });
        }
      }

      const dispatch = new DispatchService(
        fastify.prisma,
        fastify.redis,
        fastify.io,
        maps
      );
      const pricing = new PricingService(fastify.prisma, fastify.redis);
      await dispatch.updateBookingStatus(
        bookingId,
        driver.id,
        status,
        actualDistance,
        actualDuration
      );

      // Store the driver's GPS trace for the admin route map.
      // Best-effort: the trip is already completed, so never fail the request over this.
      if (
        status === "COMPLETED" &&
        isValidEncodedPolyline(actualRoutePolyline)
      ) {
        try {
          await fastify.prisma.booking.update({
            where: { id: bookingId },
            data: { actualRoutePolyline },
          });
        } catch (err) {
          request.log.warn(
            { err, bookingId },
            "Failed to store actual route polyline"
          );
        }
      }

      // Also emit directly to passenger room for instant update
      // Also emit directly to passenger room for instant update.
      // (Push notifications for these statuses are sent once, by
      // dispatch.updateBookingStatus above — not here, or passengers get two.)
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
          select: { passenger: { select: { userId: true } } },
        });
        if (booking?.passenger) {
          fastify.io
            .to(`passenger:${booking.passenger.userId}`)
            .emit("passenger:status_update", {
              bookingId,
              status,
            });
        }
      }
      let completionData: Record<string, any> | undefined;
      if (status === "COMPLETED") {
        const finalBooking = await fastify.prisma.booking.findUnique({
          where: { id: bookingId },
          select: {
            actualFare: true,
            driverEarning: true,
            platformFee: true,
            suggestedCashCollection: true,
          },
        });
        const { platformCommission } = await pricing.getConfig();
        completionData = {
          actualFare: finalBooking?.actualFare,
          driverEarning: finalBooking?.driverEarning,
          platformFee: finalBooking?.platformFee,
          commissionRate: platformCommission,
          suggestedCashCollection: finalBooking?.suggestedCashCollection,
        };
      }

      return reply.send({ success: true, data: completionData });
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

  // ─── Driver: get active booking (for app recovery on ON_JOB status) ───
  fastify.get(
    "/drivers/active-booking",
    { preHandler: [fastify.authenticateDriver] },
    async (request, reply) => {
      const { userId } = request.user;
      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver)
        return reply.status(404).send({ success: false, error: "Not found" });

      // Read active booking ID from Redis
      const activeBookingId = await fastify.redis.get(
        RedisKeys.activeBooking(driver.id)
      );

      if (!activeBookingId) {
        return reply.send({ success: true, data: null });
      }

      // Fetch the booking to confirm it's still active
      const booking = await fastify.prisma.booking.findFirst({
        where: {
          id: activeBookingId,
          driverId: driver.id,
          status: {
            in: [
              "DRIVER_ASSIGNED",
              "DRIVER_EN_ROUTE",
              "DRIVER_ARRIVED",
              "IN_PROGRESS",
            ],
          },
        },
      });

      return reply.send({ success: true, data: booking ?? null });
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

      const isArchived = status === "ARCHIVED";
      const where: any = isArchived
        ? { archivedAt: { not: null } }
        : status
        ? { archivedAt: null, status: status as DriverStatus }
        : { archivedAt: null }; // hide archived from default "all drivers" list

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

      // Documents chip: ✓ or the first problem
      const compliance = await loadComplianceMany(
        fastify.prisma,
        items.filter((d) => !d.archivedAt).map((d) => d.id)
      );
      const withCompliance = items.map((d) => {
        const c = compliance.get(d.id);
        return {
          ...d,
          compliance: c
            ? {
                eligible: c.eligible,
                summary: c.eligible ? "" : problemSummary(c),
                expiringSoon: c.expiringSoon.length,
              }
            : null,
        };
      });

      return reply.send({
        success: true,
        data: {
          items: withCompliance,
          total,
          page: parseInt(page),
          limit: parseInt(limit),
        },
      });
    }
  );

  // ─── Admin: driver document review (older admin builds; new page uses /admin/documents/:id/review) ───
  fastify.patch(
    "/admin/drivers/:driverId/documents/:docId",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { docId } = request.params as { driverId: string; docId: string };
      const { status, notes, expiryDate, rejectionReason } = request.body as {
        status: "APPROVED" | "REJECTED";
        notes?: string;
        expiryDate?: string;
        rejectionReason?: string;
      };
      try {
        const doc = await reviewDocument(fastify.prisma, {
          docId,
          decision: status === "APPROVED" ? "approve" : "reject",
          expiryDate: parseExpiryDate(expiryDate),
          rejectionReason: rejectionReason ?? notes,
          notes,
          adminUserId: request.user.userId,
        });
        notifyReview(fastify.prisma, doc);
        return reply.send({ success: true, data: doc });
      } catch (err) {
        if (err instanceof DocumentError)
          return reply.status(err.statusCode).send({ success: false, error: err.message });
        throw err;
      }
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
          // Car from the Vehicles page (optional — can be assigned later)
          vehicleId: z.string().min(1).nullable().optional(),
        })
        .parse(request.body);

      // TfL Licence Condition 11 (20-vehicle cap) is enforced when vehicles are added on the
      // Vehicles page, not here: a driver is not a vehicle.

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
                roles: ["DRIVER"],
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
          if (body.vehicleId) await setDriverVehicle(tx, driver.id, body.vehicleId);
          const vehicle = await tx.vehicle.findUnique({ where: { driverId: driver.id } });
          return { user, driver, vehicle };
        });

        return reply.status(201).send({ success: true, data: result });
      } catch (err: any) {
        if (err instanceof VehicleError)
          return reply.status(err.statusCode).send({ success: false, error: err.message });
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
          // undefined = leave as is, null = take their car away, id = give them that car
          vehicleId: z.string().min(1).nullable().optional(),
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

      try {
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
          if (body.vehicleId !== undefined)
            await setDriverVehicle(tx, driverId, body.vehicleId);
        });
      } catch (err) {
        if (err instanceof VehicleError)
          return reply.status(err.statusCode).send({ success: false, error: err.message });
        throw err;
      }

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
        // Vehicle documents stay with the car; only the uploader link is cleared
        await tx.driverDocument.updateMany({
          where: { driverId, vehicleId: { not: null } },
          data: { driverId: null },
        });
        await tx.driverDocument.deleteMany({ where: { driverId } });
        // Their car stays on the fleet, unassigned (and on the bookings it did)
        await tx.vehicle.updateMany({ where: { driverId }, data: { driverId: null } });
        await tx.driver.delete({ where: { id: driverId } });
        await tx.pushToken.deleteMany({ where: { userId: driver.userId } });
        await tx.otpCode.deleteMany({ where: { userId: driver.userId } });
        await tx.refreshToken.deleteMany({ where: { userId: driver.userId } });

        // ── Role cleanup ──────────────────────────────────────────────────
        // Remove DRIVER from the user's roles array. Then decide whether to
        // delete the user entirely or keep them with their remaining roles.
        const remainingRoles = driver.user.roles.filter((r) => r !== "DRIVER");

        const passenger = await tx.passenger.findUnique({
          where: { userId: driver.userId },
        });

        if (remainingRoles.length === 0 && !passenger) {
          // No other roles, no passenger record → delete user entirely
          await tx.user.delete({ where: { id: driver.userId } });
        } else {
          // Has other roles (e.g. CORPORATE_ADMIN) or a passenger record →
          // keep the user but strip the DRIVER role.
          // If they have a passenger record but no remaining roles, restore PASSENGER.
          const finalRoles =
            remainingRoles.length > 0
              ? remainingRoles
              : (["PASSENGER"] as any[]);
          await tx.user.update({
            where: { id: driver.userId },
            data: { roles: finalRoles },
          });
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

  // ─── Driver: own documents (driver documents + current car's) ───
  // One row per type: the newest upload (waiting for review / rejected) if there is one,
  // otherwise the approved version in force. Newest first, as older app builds expect.
  fastify.get(
    "/drivers/documents",
    { preHandler: [fastify.authenticateDriver] },
    async (request, reply) => {
      const { userId } = request.user;
      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
        select: { id: true, vehicle: { select: { id: true, licensePlate: true } } },
      });
      if (!driver)
        return reply
          .status(404)
          .send({ success: false, error: "Driver not found" });

      const vehicle = driver.vehicle;
      const rows = await fastify.prisma.driverDocument.findMany({
        where: {
          archivedAt: null,
          replacedAt: null,
          OR: [
            { driverId: driver.id, vehicleId: null },
            ...(vehicle ? [{ vehicleId: vehicle.id }] : []),
          ],
        },
        orderBy: { createdAt: "desc" },
      });
      const now = new Date();
      const files = fileLinker(request, { kind: "driver", id: userId });
      const types = [...new Set(rows.map((r) => r.type))];
      const data = types
        .map((type) => {
          const own = rows.filter((r) =>
            isVehicleType(type) ? r.vehicleId === vehicle?.id : !r.vehicleId
          );
          const st = typeStatus(type as DocType, own, now);
          const shown = st.pending ?? st.rejected ?? st.current;
          if (!shown) return null;
          return {
            ...files.doc(shown), // fileUrl / pageUrls / pages = short-lived links
            label: DOC_LABELS[type as DocType],
            state: st.state,
            current: st.current
              ? { id: st.current.id, expiryDate: st.current.expiryDate, daysLeft: st.daysLeft }
              : null,
            vehiclePlate: isVehicleType(type) ? vehicle?.licensePlate ?? null : null,
          };
        })
        .filter((d): d is NonNullable<typeof d> => !!d)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return reply.send({ success: true, data });
    }
  );

  // GET /driver/dispatch-eligibility
  // Whether the driver's documents (and their current car's) allow them to work, and why not.
  // Keeps the older fields (eligible, missingDocs, pendingDocs, expiredDocs, rejectedDocs) for
  // app 1.0.22. `enforced` false = shadow mode (jobs still come while we check the data).
  fastify.get(
    "/driver/dispatch-eligibility",
    { onRequest: [fastify.authenticate] },
    async (req, reply) => {
      const userId = (req.user as any).userId;
      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!driver) {
        return reply.status(404).send({ error: "Driver not found" });
      }
      const c = await loadCompliance(fastify.prisma, driver.id);
      if (!c) return reply.status(404).send({ error: "Driver not found" });

      const item = (i: (typeof c.items)[number]) => ({
        type: i.type,
        label: DOC_LABELS[i.type],
        owner: i.owner,
        state: i.state,
        expiryDate: i.expiryDate,
        daysLeft: i.daysLeft,
        pendingReview: !!i.pending,
        rejectionReason: i.rejected?.rejectionReason ?? null,
      });
      return reply.send({
        ...legacyEligibility(c),
        enforced: gatingEnabled(),
        message: c.eligible ? "" : blockMessage(c),
        noVehicle: c.noVehicle,
        vehicle: c.vehicle,
        items: c.items.map(item),
        problems: c.problems.map(item),
        expiringSoon: c.expiringSoon.map(item),
      });
    }
  );

  // ─── Driver: upload a document (new version, waits for review) ───
  // Multipart: type, optional expiryDate (YYYY-MM-DD or ISO), one or more files (pages).
  // Vehicle documents go on the driver's current car.
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

      let upload: Awaited<ReturnType<typeof readDocumentUpload>>;
      try {
        upload = await readDocumentUpload(request, `${driver.id}_${Date.now()}`);
      } catch (err: any) {
        fastify.log.error(
          { err },
          "Cloudinary upload failed for driver document"
        );
        return reply.status(500).send({
          success: false,
          error: "Document upload failed. Please try again.",
        });
      }
      const { fields, files } = upload;
      const type = fields.type;

      if (!type)
        return reply
          .status(400)
          .send({ success: false, error: "Document type is required" });
      if (!files.length)
        return reply
          .status(400)
          .send({ success: false, error: "A document file is required" });
      if (!isDocType(type))
        return reply
          .status(400)
          .send({ success: false, error: "Invalid document type" });
      const expiryDate = parseExpiryDate(fields.expiryDate);

      try {
        const doc = await addDocumentVersion(fastify.prisma, {
          type,
          files,
          driverId: driver.id,
          expiryDate,
          uploadedBy: userId,
        });
        const links = fileLinker(request, { kind: "driver", id: userId });
        return reply.status(201).send({ success: true, data: links.doc(doc) });
      } catch (err) {
        if (err instanceof DocumentError)
          return reply.status(err.statusCode).send({ success: false, error: err.message });
        throw err;
      }
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
      const { token, platform, app } = request.body as {
        token: string;
        platform: string;
        app?: string; // "driver" | "passenger" — older app builds don't send it
      };

      if (!token || !platform)
        return reply.status(400).send({
          success: false,
          error: "token and platform are required",
        });
      if (app !== undefined && !PUSH_APPS.includes(app as PushApp))
        return reply.status(400).send({
          success: false,
          error: "app must be driver or passenger",
        });

      await fastify.prisma.pushToken.upsert({
        where: { userId_token: { userId, token } },
        update: { platform, ...(app && { app }), updatedAt: new Date() },
        create: { userId, token, platform, app: app ?? null },
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

  // ─── POST /drivers/bookings/:id/request-card-payment ───────────────────────
  // Driver triggers card payment on passenger's phone for a cash booking.
  // Creates a Stripe PaymentIntent and sends the clientSecret to the passenger
  // via socket so their app can show the payment sheet automatically.
  fastify.post(
    "/drivers/bookings/:id/request-card-payment",
    { preHandler: [fastify.authenticateDriver] },
    async (request, reply) => {
      const { userId } = request.user;
      const { id } = request.params as { id: string };

      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver)
        return reply
          .status(404)
          .send({ success: false, error: "Driver not found" });

      const booking = await fastify.prisma.booking.findUnique({
        where: { id },
        include: { passenger: { include: { user: true } } },
      });
      if (!booking)
        return reply
          .status(404)
          .send({ success: false, error: "Booking not found" });
      if (booking.driverId !== driver.id)
        return reply
          .status(403)
          .send({ success: false, error: "Access denied" });
      if (booking.status !== "COMPLETED")
        return reply
          .status(400)
          .send({ success: false, error: "Booking not completed" });
      if (booking.paymentMethod !== "CASH")
        return reply.status(400).send({
          success: false,
          error: "Only cash bookings can switch to card",
        });
      if (!booking.passenger)
        return reply
          .status(400)
          .send({ success: false, error: "No passenger on booking" });

      const fare = booking.actualFare ?? booking.estimatedFare;

      const { StripeService } = await import("../services/stripe.service");
      const stripeService = new StripeService(booking.passenger.user.phone);
      const { clientSecret, paymentIntentId } =
        await stripeService.createPaymentIntent(
          StripeService.toPence(fare),
          "gbp",
          {
            bookingId: id,
            reference: booking.reference,
            type: "post_trip_card_driver_triggered",
          },
          "automatic"
        );

      await fastify.prisma.booking.update({
        where: { id },
        data: { stripePaymentIntentId: paymentIntentId },
      });

      // Push card payment request to passenger app
      fastify.io
        .to(`passenger:${booking.passenger.userId}`)
        .emit("booking:card_payment_requested", {
          bookingId: id,
          clientSecret,
          fare,
        });

      fastify.log.info(
        `[CardPayment] Driver ${driver.id} requested card payment for booking ${booking.reference}`
      );

      return reply.send({ success: true });
    }
  );

  // ─── PATCH /drivers/jobs/:bookingId/cash-collected ──────────────────────
  // Driver confirms actual cash collected after a completed CASH trip.
  // Settles the wallet debit via WalletService.settleCashTrip and records
  // any over/under as a CASH_ADJUSTMENT. actualCashCollected is claimed
  // atomically first (idempotency guard) — if the wallet settlement then
  // fails, the claim is released so a retry is possible.
  fastify.patch(
    "/drivers/jobs/:bookingId/cash-collected",
    { preHandler: [fastify.authenticateDriver] },
    async (request, reply) => {
      const { userId } = request.user;
      const { bookingId } = request.params as { bookingId: string };
      const { amountCollected } = request.body as { amountCollected: number };

      if (typeof amountCollected !== "number" || amountCollected < 0) {
        return reply.status(400).send({
          success: false,
          error: "amountCollected must be a non-negative number",
        });
      }

      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver)
        return reply
          .status(404)
          .send({ success: false, error: "Driver not found" });

      const booking = await fastify.prisma.booking.findUnique({
        where: { id: bookingId },
      });
      if (!booking)
        return reply
          .status(404)
          .send({ success: false, error: "Booking not found" });
      if (booking.driverId !== driver.id)
        return reply
          .status(403)
          .send({ success: false, error: "Access denied" });
      if (booking.status !== "COMPLETED")
        return reply
          .status(400)
          .send({ success: false, error: "Booking not completed" });
      if (booking.paymentMethod !== "CASH")
        return reply
          .status(400)
          .send({ success: false, error: "Not a cash booking" });
      if (!booking.passengerId)
        return reply
          .status(400)
          .send({ success: false, error: "No passenger on booking" });

      // Atomic claim — only succeeds if nobody has settled this booking yet.
      const claimed = await fastify.prisma.booking.updateMany({
        where: { id: bookingId, actualCashCollected: null },
        data: { actualCashCollected: amountCollected },
      });
      if (claimed.count === 0) {
        return reply.status(409).send({
          success: false,
          error: "Cash collection already recorded for this booking",
        });
      }

      const fare = booking.actualFare ?? booking.estimatedFare;

      try {
        const { WalletService } = await import("../services/wallet.service");
        const walletService = new WalletService(fastify.prisma);
        const result = await walletService.settleCashTrip(
          booking.passengerId,
          bookingId,
          fare,
          amountCollected
        );

        fastify.log.info(
          `[Wallet] Cash settled for booking ${booking.reference}: collected £${amountCollected}, expected £${result.expectedCollection}, variance £${result.variance}`
        );

        return reply.send({ success: true, data: result });
      } catch (err: any) {
        // Settlement failed after we claimed the slot — release it so a
        // retry (or admin correction) is possible instead of it being
        // permanently locked out.
        await fastify.prisma.booking
          .update({
            where: { id: bookingId },
            data: { actualCashCollected: null },
          })
          .catch(() => {});
        fastify.log.error({ err }, "[Wallet] settleCashTrip failed");
        return reply.status(500).send({
          success: false,
          error: "Failed to settle cash collection",
        });
      }
    }
  );
}
