import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { config } from "./config";

// Plugins
import databasePlugin from "./plugins/database";
import redisPlugin from "./plugins/redis";
import authPlugin from "./plugins/auth";
import socketPlugin from "./plugins/socket";
import { RedisKeys } from "./plugins/redis";

// Routes
import { authRoutes } from "./routes/auth";
import { bookingRoutes } from "./routes/bookings";
import { driverRoutes } from "./routes/drivers";
import { adminRoutes } from "./routes/admin";
import { passengerRoutes } from "./routes/passengers";
import { pricingRoutes } from "./routes/pricing";
import { corporateRoutes } from "./routes/corporate";
import { surchargeZoneRoutes } from "./routes/surcharge-zones";
import adminCareHomeRoutes from "./routes/admin/carehome";
import careHomeRoutes from "./routes/carehome";
import { driverApplicationRoutes } from "./routes/driver-applications";
import { adminDriverApplicationRoutes } from "./routes/admin/driver-applications";
import { adminDriverPhotoRoutes } from "./routes/admin/driver-photo.routes";
import { adminAirportPickupRoutes } from "./routes/admin/airport-pickups";
import { settingsRoutes } from "./routes/settings";
import { complianceRoutes } from "./routes/compliance";
import { teslaRoutes } from "./routes/tesla";
import { scheduledBookingRoutes } from "./routes/scheduledBooking.routes";
import { adminBookingTripRoutes } from "./routes/admin/booking-trip";
import { flightRoutes } from "./routes/flights";
import { runFlightWatchCycle } from "./services/flightWatch.service";
import { flightWebhookRoutes } from "./routes/flightWebhooks";
import { adminBookingFlightRoutes } from "./routes/admin/booking-flight";
import { adminBookingReceiptRoutes } from "./routes/admin/booking-receipt";
import { adminVehicleRoutes } from "./routes/admin/vehicles";
import { adminDocumentRoutes } from "./routes/admin/documents";
import { runDocumentCycle } from "./services/documentWatch.service";
import { twilioWebhookRoutes } from "./routes/twilioWebhooks";
import { driverFlightRoutes } from "./routes/driverFlight";
import { enableSmsTracking } from "./services/sms.service";
import { fileRoutes } from "./routes/files";
import { adminDriverRegisterRoutes } from "./routes/admin/driverRegister";
import { adminVehicleRecordRoutes } from "./routes/admin/vehicleRecord";
import { adminLostPropertyRoutes } from "./routes/admin/lostProperty";
import { missingStorageConfig } from "./services/fileStorage";
import { fileTokenSecretSet } from "./services/fileLinks";

import { Prisma } from "@prisma/client";

// How long a PENDING booking can sit before being auto-cancelled (30 minutes)
const STALE_BOOKING_THRESHOLD_MS = 30 * 60 * 1000;
// How often to run the cleanup job (every 5 minutes)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: config.NODE_ENV === "development" ? "info" : "warn",
      transport:
        config.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
  });

  // ─── Core plugins ───
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.ip,
  });

  await fastify.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  // ─── App plugins ───
  await fastify.register(databasePlugin);
  await fastify.register(redisPlugin);
  await fastify.register(authPlugin);
  await fastify.register(socketPlugin);

  // Record every SMS + request Twilio delivery-status callbacks (backlog A).
  enableSmsTracking(fastify.prisma);

  // Error handlers must be set BEFORE routes are registered: Fastify only applies them to
  // routes registered afterwards (before this, auth/booking/admin routes fell back to the
  // default handler and returned 500 for validation errors).
  fastify.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      success: false,
      error: `Route ${request.method} ${request.url} not found`,
    });
  });

  fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error(error);

    if (error.name === "ZodError") {
      const issues = JSON.parse(error.message) as { path?: (string | number)[]; message?: string }[];
      const first = issues[0];
      const where = first?.path?.length ? `${first.path.join(".")}: ` : "";
      return reply.status(400).send({
        success: false,
        error: first ? `Invalid input — ${where}${first.message}` : "Validation error",
        details: issues,
      });
    }

    if (error.statusCode) {
      return reply
        .status(error.statusCode)
        .send({ success: false, error: error.message });
    }

    reply.status(500).send({ success: false, error: "Internal server error" });
  });


  // ─── Routes ───
  const prefix = config.API_PREFIX;
  await fastify.register(authRoutes, { prefix });
  await fastify.register(bookingRoutes, { prefix });
  await fastify.register(scheduledBookingRoutes, { prefix });
  await fastify.register(driverRoutes, { prefix });
  await fastify.register(adminRoutes, { prefix });
  await fastify.register(passengerRoutes, { prefix });
  await fastify.register(pricingRoutes, { prefix });
  await fastify.register(corporateRoutes, { prefix });
  await fastify.register(surchargeZoneRoutes, { prefix });
  await fastify.register(adminCareHomeRoutes, { prefix });
  await fastify.register(careHomeRoutes, { prefix });
  fastify.register(driverApplicationRoutes, { prefix });
  fastify.register(adminDriverApplicationRoutes, { prefix });
  fastify.register(adminDriverPhotoRoutes, { prefix });
  fastify.register(adminAirportPickupRoutes, { prefix });
  fastify.register(adminBookingTripRoutes, { prefix });
  fastify.register(settingsRoutes, { prefix });
  fastify.register(complianceRoutes, { prefix });
  fastify.register(teslaRoutes, { prefix });
  fastify.register(flightRoutes, { prefix });
  fastify.register(driverFlightRoutes, { prefix });
  fastify.register(adminBookingFlightRoutes, { prefix });
  fastify.register(adminBookingReceiptRoutes, { prefix });
  fastify.register(adminVehicleRoutes, { prefix });
  fastify.register(adminDocumentRoutes, { prefix });
  // Short-lived links to private document files (signed token in the URL, no auth header)
  fastify.register(fileRoutes, { prefix });
  fastify.register(adminDriverRegisterRoutes, { prefix });
  fastify.register(adminVehicleRecordRoutes, { prefix });
  fastify.register(adminLostPropertyRoutes, { prefix });
  // Provider callback — no /api/v1 prefix (URL contains FLIGHT_WEBHOOK_SECRET)
  fastify.register(flightWebhookRoutes);
  // Provider callback — no /api/v1 prefix (Twilio-signed)
  fastify.register(twilioWebhookRoutes);

  // ─── Health check ───
  fastify.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  }));

  // Tesla public key — must be at root path, no /api/v1 prefix
  fastify.get(
    "/.well-known/appspecific/com.tesla.3p.public-key.pem",
    async (request, reply) => {
      return reply
        .header("Content-Type", "application/x-pem-file")
        .send(process.env.TESLA_PUBLIC_KEY!);
    }
  );

  return fastify;
}

// ─── Auto-cancel stale PENDING bookings ──────────────────────────────────────
// Runs every 5 minutes. Cancels any PENDING booking older than 30 minutes
// that was never dispatched. Prevents stale test/failed bookings from
// being offered to drivers when they come online.
async function startStaleBiookingCleanup(
  fastify: Awaited<ReturnType<typeof buildServer>>
) {
  const run = async () => {
    // ── Flight data retention (AeroDataBox: max 7 days) ──────────────────
    // Runs FIRST: the stale-booking cleanup below returns early when there's
    // nothing stale, which would otherwise skip this.
    // Provider data on bookings is a snapshot. Future bookings are refreshed
    // every 5 days (step 6b, flightRefresh.service); it is deleted
    //   - 1 day after the pickup (pickup is after arrival, so >= arrival + 1 day)
    //   - or once 6 days old (safety net: refresh paused / not found)
    // Passenger-owned fields (flightNumber, terminal, luggageType,
    // meetingPointId) and the pickup time are ours and are kept.
    try {
      const cutoff = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const cleared = await fastify.prisma.booking.updateMany({
        where: {
          flightSnapshotFetchedAt: { not: null },
          OR: [
            { flightSnapshotFetchedAt: { lt: cutoff } },
            { scheduledAt: { lt: dayAgo } },
          ],
        },
        data: {
          flightSnapshot: Prisma.DbNull,
          flightSnapshotFetchedAt: null,
          flightArrivalTime: null,
        },
      });
      if (cleared.count > 0) {
        fastify.log.warn(
          `[Cleanup] Cleared expired flight data on ${cleared.count} booking(s)`
        );
      }
      // Raw web-hook notifications are provider data too.
      await fastify.prisma.flightWebhookEvent.deleteMany({
        where: { receivedAt: { lt: cutoff } },
      });
    } catch (err) {
      fastify.log.error({ err }, "[Cleanup] Flight data retention error");
    }
    // ── SMS delivery log retention (30 days) ─────────────────────────────
    try {
      await fastify.prisma.smsMessage.deleteMany({
        where: {
          createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      });
    } catch (err) {
      fastify.log.error({ err }, "[Cleanup] SMS log retention error");
    }
    // ── Flight tracking (Phase 2): watches + safety-net lookups ─────────
    try {
      await runFlightWatchCycle({
        prisma: fastify.prisma,
        redis: fastify.redis,
        log: fastify.log,
        io: fastify.io as any,
      });
    } catch (err) {
      fastify.log.error({ err }, "[FlightWatch] Cycle error");
    }
    // ── Driver & vehicle documents: reminders, expiry, unassign, review alerts ──
    try {
      await runDocumentCycle({
        prisma: fastify.prisma,
        redis: fastify.redis,
        log: fastify.log,
        io: fastify.io as any,
      });
    } catch (err) {
      fastify.log.error({ err }, "[Documents] Cycle error");
    }

    try {
      const cutoff = new Date(Date.now() - STALE_BOOKING_THRESHOLD_MS);

      const stale = await fastify.prisma.booking.findMany({
        where: {
          status: "PENDING",
          createdAt: { lt: cutoff },
        },
        select: { id: true, reference: true, createdAt: true },
      });

      if (!stale.length) return;

      fastify.log.warn(
        `[Cleanup] Auto-cancelling ${
          stale.length
        } stale PENDING booking(s): ${stale.map((b) => b.reference).join(", ")}`
      );

      for (const booking of stale) {
        await fastify.prisma.$transaction([
          fastify.prisma.booking.update({
            where: { id: booking.id },
            data: {
              status: "CANCELLED",
              cancellationReason:
                "Auto-cancelled: no driver found within 30 minutes",
            },
          }),
          fastify.prisma.bookingStatusHistory.create({
            data: {
              bookingId: booking.id,
              status: "CANCELLED",
              note: "Auto-cancelled by system: no driver found within 30 minutes",
            },
          }),
        ]);

        // Notify admin via socket
        fastify.io.to("admin").emit("admin:booking:updated", {
          bookingId: booking.id,
          status: "CANCELLED",
        });
      }
    } catch (err) {
      //fastify.log.error("[Cleanup] Stale booking cleanup error:", err);
      fastify.log.error({ err }, "[Cleanup] Stale booking cleanup error");
    }
  };

  // Run once immediately on startup, then every 5 minutes
  await run();
  setInterval(run, CLEANUP_INTERVAL_MS);
}

// ─── Reseed Redis drivers:online on startup ───────────────────────────────
// If Railway redeploys or Redis restarts, the drivers:online set is wiped.
// On startup, find all drivers whose DB status is AVAILABLE or ON_JOB
// and re-add them to Redis so they can receive dispatch immediately.
async function reseedOnlineDrivers(
  fastify: Awaited<ReturnType<typeof buildServer>>
) {
  try {
    const activeDrivers = await fastify.prisma.driver.findMany({
      where: {
        status: { in: ["AVAILABLE", "ON_JOB"] },
      },
      select: { id: true, status: true },
    });

    if (!activeDrivers.length) return;

    for (const driver of activeDrivers) {
      await fastify.redis.sadd(RedisKeys.onlineDrivers(), driver.id);
    }

    fastify.log.info(
      `[Startup] Reseeded ${activeDrivers.length} driver(s) into Redis drivers:online`
    );
  } catch (err) {
    fastify.log.error({ err }, "[Startup] Failed to reseed online drivers");
  }
}

/** Private document storage needs these; refuse to start in production without them. */
function checkFileStorageConfig() {
  const missing = [
    ...missingStorageConfig(),
    ...(fileTokenSecretSet() ? [] : ["FILE_TOKEN_SECRET (32+ characters)"]),
  ];
  if (!missing.length) return;
  const msg = `[Startup] Private document storage not configured — missing: ${missing.join(", ")}`;
  if (config.NODE_ENV === "production") {
    console.error(msg);
    process.exit(1);
  }
  console.warn(`${msg} (local: document uploads/links may not work)`);
}

async function start() {
  checkFileStorageConfig();
  const server = await buildServer();

  try {
    const port = parseInt(config.PORT);
    await server.listen({ port, host: "0.0.0.0" });
    console.log(`\n🚖 Dispatch API running on http://localhost:${port}`);
    console.log(`📡 WebSocket ready`);
    console.log(`🌍 Environment: ${config.NODE_ENV}`);
    console.log(
      `🧹 Stale booking cleanup: every ${
        CLEANUP_INTERVAL_MS / 60000
      } min (threshold: ${STALE_BOOKING_THRESHOLD_MS / 60000} min)\n`
    );

    // Start background cleanup job
    startStaleBiookingCleanup(server);
    reseedOnlineDrivers(server);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down...");
  process.exit(0);
});
process.on("SIGINT", async () => {
  console.log("SIGINT received, shutting down...");
  process.exit(0);
});

start();
