import { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { addMinutes } from "date-fns";
import { RedisKeys, RedisTTL } from "../plugins/redis";
import { OTP_EXPIRY_MINUTES, OTP_LENGTH } from "../config";

const sendOtpSchema = z.object({
  phone: z
    .string()
    .regex(/^\+44\d{10}$/, "Must be a valid UK phone number (+44...)"),
});

const verifyOtpSchema = z.object({
  phone: z.string(),
  code: z.string().length(OTP_LENGTH),
});

const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function authRoutes(fastify: FastifyInstance) {
  // ─── Send OTP ────────────────────────────────────────────────────────────────
  fastify.post("/auth/otp/send", async (request, reply) => {
    const body = sendOtpSchema.parse(request.body);

    const code = Math.random()
      .toString()
      .slice(2, 2 + OTP_LENGTH);
    const key = RedisKeys.otpCode(body.phone);

    await fastify.redis.setex(key, RedisTTL.otp, code);

    fastify.log.info(`OTP for ${body.phone}: ${code}`);

    // TODO: Twilio integration
    // await twilioClient.messages.create({ body: `Your code: ${code}`, from: ..., to: body.phone })

    return reply.send({
      success: true,
      message: "OTP sent",
      ...(process.env.NODE_ENV === "development" ? { _devCode: code } : {}),
    });
  });

  // ─── Verify OTP ──────────────────────────────────────────────────────────────
  fastify.post("/auth/otp/verify", async (request, reply) => {
    const body = verifyOtpSchema.parse(request.body);

    const key = RedisKeys.otpCode(body.phone);
    const storedCode = await fastify.redis.get(key);

    if (!storedCode || storedCode !== body.code) {
      return reply
        .status(400)
        .send({ success: false, error: "Invalid or expired OTP" });
    }

    await fastify.redis.del(key);

    // Find or create user
    let user = await fastify.prisma.user.findUnique({
      where: { phone: body.phone },
    });

    const isNewUser = !user;

    if (!user) {
      // Brand-new phone number → create as PASSENGER with linked Passenger record
      user = await fastify.prisma.user.create({
        data: {
          phone: body.phone,
          firstName: "",
          lastName: "",
          role: "PASSENGER",
          isVerified: true,
          passenger: { create: {} },
        },
      });
    } else if (user.role === "PASSENGER") {
      // Existing PASSENGER — ensure Passenger record exists (safety net)
      await fastify.prisma.passenger.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id },
      });
    }
    // Note: DRIVER users are allowed through here — the individual apps
    // enforce their own role check (driver app blocks PASSENGER, passenger app blocks DRIVER)

    const token = fastify.jwt.sign({
      userId: user.id,
      role: user.role,
      phone: user.phone,
    });

    const refreshToken = uuid();
    await fastify.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt: addMinutes(new Date(), 60 * 24 * 30),
      },
    });

    return reply.send({
      success: true,
      data: {
        token,
        refreshToken,
        isNewUser,
        user: {
          id: user.id,
          phone: user.phone,
          role: user.role,
          firstName: user.firstName,
          lastName: user.lastName,
          isVerified: user.isVerified,
        },
      },
    });
  });

  // ─── Admin login ─────────────────────────────────────────────────────────────
  fastify.post("/auth/admin/login", async (request, reply) => {
    const body = adminLoginSchema.parse(request.body);

    const user = await fastify.prisma.user.findUnique({
      where: { email: body.email },
      include: { adminProfile: true },
    });

    if (!user || !user.passwordHash || !user.adminProfile) {
      return reply
        .status(401)
        .send({ success: false, error: "Invalid credentials" });
    }

    if (!["ADMIN", "DISPATCHER"].includes(user.role)) {
      return reply
        .status(403)
        .send({ success: false, error: "Not an admin account" });
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
          permissions: user.adminProfile.permissions,
        },
      },
    });
  });

  // ─── Refresh token ───────────────────────────────────────────────────────────
  fastify.post("/auth/refresh", async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken: string };

    const token = await fastify.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!token || token.expiresAt < new Date()) {
      return reply
        .status(401)
        .send({ success: false, error: "Invalid refresh token" });
    }

    const newToken = fastify.jwt.sign({
      userId: token.user.id,
      role: token.user.role,
      phone: token.user.phone,
    });

    return reply.send({ success: true, data: { token: newToken } });
  });

  // ─── Get current user (/auth/me) ─────────────────────────────────────────────
  // Returns role-appropriate profile data.
  // Passenger app expects:  reply.data.passenger
  // Driver app expects:     reply.data.driver
  // Admin panel expects:    reply.data.adminProfile
  fastify.get(
    "/auth/me",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = await fastify.prisma.user.findUnique({
        where: { id: request.user.userId },
        include: {
          passenger: true,
          driver: { include: { vehicle: true } },
          adminProfile: true,
        },
      });

      if (!user) {
        return reply
          .status(404)
          .send({ success: false, error: "User not found" });
      }

      // Return the full user object with all relations — each app picks out what it needs.
      // passenger app: data.passenger
      // driver app:    data.driver
      return reply.send({
        success: true,
        data: {
          id: user.id,
          phone: user.phone,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isVerified: user.isVerified,
          passenger: user.passenger,
          driver: user.driver,
          adminProfile: user.adminProfile,
        },
      });
    }
  );
}
