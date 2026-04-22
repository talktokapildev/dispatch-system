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

async function start() {
  const server = await buildServer();

  try {
    const port = parseInt(config.PORT);
    await server.listen({ port, host: "0.0.0.0" });
    console.log(`\n🚖 Dispatch API running on http://localhost:${port}`);
    console.log(`📡 WebSocket ready`);
    console.log(`🌍 Environment: ${config.NODE_ENV}\n`);
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
