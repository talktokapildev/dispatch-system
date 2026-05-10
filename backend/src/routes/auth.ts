// backend/src/routes/auth.ts

import { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { addMinutes } from "date-fns";
import Twilio from "twilio";
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
  requestedRole: z.enum(["PASSENGER", "DRIVER"]).optional(),
});

const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

// ─── Demo accounts ────────────────────────────────────────────────────────────
const DEMO_PHONES = ["+447700000001", "+447700000003"];
const DEMO_OTP = "123456";

// ─── Twilio client (lazy-initialised) ────────────────────────────────────────
function getTwilioClient(): Twilio.Twilio | null {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;
  return Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

async function sendSmsOtp(to: string, code: string): Promise<void> {
  const client = getTwilioClient();
  const from = process.env.TWILIO_PHONE_NUMBER;

  if (!client || !from) {
    console.log(`[OTP fallback] Code for ${to}: ${code}`);
    return;
  }

  await client.messages.create({
    body: `Your OrangeRide verification code is: ${code}. Valid for ${OTP_EXPIRY_MINUTES} minutes. Do not share this code.`,
    from,
    to,
  });
}

export async function authRoutes(fastify: FastifyInstance) {
  // ─── Send OTP ──────────────────────────────────────────────────────────────
  fastify.post("/auth/otp/send", async (request, reply) => {
    const body = sendOtpSchema.parse(request.body);

    if (DEMO_PHONES.includes(body.phone)) {
      fastify.log.info(`[Demo] OTP send skipped for demo number ${body.phone}`);
      return reply.send({ success: true, message: "OTP sent" });
    }

    const code = Math.random()
      .toString()
      .slice(2, 2 + OTP_LENGTH);
    const key = RedisKeys.otpCode(body.phone);

    await fastify.redis.setex(key, RedisTTL.otp, code);

    try {
      await sendSmsOtp(body.phone, code);
      fastify.log.info(`OTP sent via SMS to ${body.phone}`);
    } catch (err: any) {
      fastify.log.error(`Twilio SMS failed for ${body.phone}: ${err.message}`);
      await fastify.redis.del(key);
      return reply.status(500).send({
        success: false,
        error: "Failed to send OTP. Please try again.",
      });
    }

    return reply.send({ success: true, message: "OTP sent" });
  });

  // ─── Verify OTP ────────────────────────────────────────────────────────────
  fastify.post("/auth/otp/verify", async (request, reply) => {
    const body = verifyOtpSchema.parse(request.body);

    // ── Demo bypass ───────────────────────────────────────────────────────────
    if (DEMO_PHONES.includes(body.phone) && body.code !== DEMO_OTP) {
      return reply
        .status(400)
        .send({ success: false, error: "Invalid or expired OTP" });
    }

    if (!DEMO_PHONES.includes(body.phone)) {
      const key = RedisKeys.otpCode(body.phone);
      const storedCode = await fastify.redis.get(key);

      if (!storedCode || storedCode !== body.code) {
        return reply
          .status(400)
          .send({ success: false, error: "Invalid or expired OTP" });
      }

      await fastify.redis.del(key);
    }
    // ── End demo bypass ───────────────────────────────────────────────────────

    // Find or create user
    let user = await fastify.prisma.user.findUnique({
      where: { phone: body.phone },
      include: {
        passenger: true,
        driver: true,
      },
    });

    const isNewUser = !user;

    if (!user) {
      // Brand new phone — create as PASSENGER by default.
      // Drivers come via the self-onboarding application flow; they won't
      // arrive here without an existing approved Driver record.
      const isDemoNumber = DEMO_PHONES.includes(body.phone);
      user = await fastify.prisma.user.create({
        data: {
          phone: body.phone,
          firstName: isDemoNumber ? "Demo" : "",
          lastName: isDemoNumber ? "Passenger" : "",
          roles: ["PASSENGER"], // ← was: role: "PASSENGER"
          isVerified: true,
          passenger: { create: {} },
        },
        include: { passenger: true, driver: true },
      });
      fastify.log.info(
        isDemoNumber
          ? `[Demo] Created demo passenger account for ${body.phone}`
          : `New passenger created for ${body.phone}`
      );
    } else if (user.roles.includes("PASSENGER") && !user.passenger) {
      // Existing user with PASSENGER role but no Passenger record — create it
      await fastify.prisma.passenger.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id },
      });
    }

    const hasPassenger = !!user.passenger;
    const hasDriver = !!user.driver;

    // ── Validate the requested role is available for this user ────────────────
    if (body.requestedRole === "DRIVER" && !hasDriver) {
      return reply.status(403).send({
        success: false,
        error: "No driver account found for this number",
      });
    }

    // ── Determine active role context for this session ────────────────────────
    // The JWT carries ALL the user's roles. activeRole tells the app which
    // context this session is for (e.g. driving vs riding).
    let activeRole: string;
    if (hasPassenger && hasDriver) {
      activeRole = body.requestedRole === "DRIVER" ? "DRIVER" : "PASSENGER";
    } else if (hasDriver) {
      activeRole = "DRIVER";
    } else {
      activeRole = "PASSENGER";
    }

    // ── Sign JWT with all roles ───────────────────────────────────────────────
    const token = fastify.jwt.sign({
      userId: user.id,
      roles: user.roles, // ← full roles array
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
          roles: user.roles, // ← full array
          activeRole, // ← which context this session is for
          firstName: user.firstName,
          lastName: user.lastName,
          isVerified: user.isVerified,
        },
      },
    });
  });

  // ─── Admin login ───────────────────────────────────────────────────────────
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

    // Check user has ADMIN or DISPATCHER role
    if (!user.roles.some((r) => ["ADMIN", "DISPATCHER"].includes(r))) {
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
      roles: user.roles, // ← was: role: user.role
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
          roles: user.roles, // ← was: role: user.role
          permissions: user.adminProfile.permissions,
        },
      },
    });
  });

  // ─── Refresh token ─────────────────────────────────────────────────────────
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
      roles: token.user.roles, // ← was: role: token.user.role
      phone: token.user.phone,
    });

    return reply.send({ success: true, data: { token: newToken } });
  });

  // ─── Get current user (/auth/me) ───────────────────────────────────────────
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

      return reply.send({
        success: true,
        data: {
          id: user.id,
          phone: user.phone,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          roles: user.roles, // ← was: role: user.role
          isVerified: user.isVerified,
          passenger: user.passenger,
          driver: user.driver,
          adminProfile: user.adminProfile,
        },
      });
    }
  );
}
