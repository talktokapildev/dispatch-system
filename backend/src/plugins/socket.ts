import fp from "fastify-plugin";
import { FastifyPluginAsync } from "fastify";
import { Server as SocketServer } from "socket.io";
import { config } from "../config";
import { SocketEvent } from "../types";
import { RedisKeys } from "./redis";

declare module "fastify" {
  interface FastifyInstance {
    io: SocketServer;
  }
}

const socketPlugin: FastifyPluginAsync = fp(async (fastify) => {
  const io = new SocketServer(fastify.server, {
    cors: {
      origin: config.ALLOWED_ORIGINS.split(","),
      methods: ["GET", "POST"],
    },
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Authentication required"));

    try {
      const payload = fastify.jwt.verify(token) as {
        userId: string;
        role: string;
      };
      socket.data.userId = payload.userId;
      socket.data.role = payload.role;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", async (socket) => {
    const { userId, role } = socket.data;
    fastify.log.info(`Socket connected: ${userId} (${role})`);

    // Join role-based rooms
    if (role === "ADMIN" || role === "DISPATCHER") {
      socket.join("admin");
    }

    if (role === "DRIVER") {
      socket.join(`driver:${userId}`);
      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (driver) {
        socket.data.driverId = driver.id;
        // Join active booking room if any
        const activeBookingId = await fastify.redis.get(
          RedisKeys.activeBooking(driver.id)
        );
        if (activeBookingId) socket.join(`booking:${activeBookingId}`);
      }
    }

    if (role === "PASSENGER") {
      socket.join(`passenger:${userId}`);
    }

    // Passenger: subscribe to booking updates
    socket.on("subscribe:booking", (bookingId: string) => {
      socket.join(`booking:${bookingId}`);
      fastify.log.info(`${userId} subscribed to booking ${bookingId}`);
    });

    socket.on("unsubscribe:booking", (bookingId: string) => {
      socket.leave(`booking:${bookingId}`);
    });

    // Driver: subscribe to own room
    socket.on("subscribe:driver", (driverId: string) => {
      if (role === "ADMIN" || role === "DISPATCHER") {
        socket.join(`driver:${driverId}`);
      }
    });

    // Ping/pong heartbeat
    socket.on(SocketEvent.PING, () => {
      socket.emit(SocketEvent.PONG, { timestamp: Date.now() });
    });

    socket.on("disconnect", async (reason) => {
      fastify.log.info(`Socket disconnected: ${userId} (${reason})`);

      // Mark driver offline if disconnected unexpectedly
      if (role === "DRIVER" && socket.data.driverId) {
        // Give them 30s to reconnect before going offline
        setTimeout(async () => {
          const sockets = await io
            .in(`driver:${socket.data.userId}`)
            .fetchSockets();
          if (!sockets.length) {
            await fastify.prisma.driver
              .update({
                where: { id: socket.data.driverId },
                data: { status: "OFFLINE" },
              })
              .catch(() => {});
            await fastify.redis.srem(
              RedisKeys.onlineDrivers(),
              socket.data.driverId
            );
            io.to("admin").emit(SocketEvent.ADMIN_DRIVER_UPDATE, {
              driverId: socket.data.driverId,
              status: "OFFLINE",
            });
          }
        }, 30_000);
      }
    });

    // After the existing room joins (admin/driver), add:
    socket.on("join:booking", async ({ bookingId }: { bookingId: string }) => {
      // Optionally verify the passenger owns this booking
      socket.join(`booking:${bookingId}`);
      fastify.log.info(`Socket joined booking room: booking:${bookingId}`);
    });
  });

  fastify.decorate("io", io);
  fastify.log.info("✅ Socket.io initialised");
});

export default socketPlugin;
