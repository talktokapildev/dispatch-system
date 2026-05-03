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

  // ─── Routes ───
  const prefix = config.API_PREFIX;
  await fastify.register(authRoutes, { prefix });
  await fastify.register(bookingRoutes, { prefix });
  await fastify.register(driverRoutes, { prefix });
  await fastify.register(adminRoutes, { prefix });
  await fastify.register(passengerRoutes, { prefix });
  await fastify.register(pricingRoutes, { prefix });
  await fastify.register(corporateRoutes, { prefix });
  await fastify.register(surchargeZoneRoutes, { prefix });
  await fastify.register(adminCareHomeRoutes, { prefix });
  await fastify.register(careHomeRoutes, { prefix });

  // ─── Health check ───
  fastify.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  }));

  fastify.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      success: false,
      error: `Route ${request.method} ${request.url} not found`,
    });
  });

  fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error(error);

    if (error.name === "ZodError") {
      return reply.status(400).send({
        success: false,
        error: "Validation error",
        details: JSON.parse(error.message),
      });
    }

    if (error.statusCode) {
      return reply
        .status(error.statusCode)
        .send({ success: false, error: error.message });
    }

    reply.status(500).send({ success: false, error: "Internal server error" });
  });

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

async function start() {
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
