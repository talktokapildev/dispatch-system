import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET ?? "changeme";

// ─── Auth helper ────────────────────────────────────────────────────────────
async function verifyCareHomeStaff(request: any, reply: any) {
  const auth = request.headers.authorization;
  if (!auth?.startsWith("Bearer "))
    return reply.status(401).send({ error: "Unauthorized" });
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as {
      staffId: string;
      careHomeId: string;
    };
    request.staffId = payload.staffId;
    request.careHomeId = payload.careHomeId;
  } catch {
    return reply.status(401).send({ error: "Invalid token" });
  }
}

export default async function careHomeRoutes(fastify: FastifyInstance) {
  // ─── AUTH ────────────────────────────────────────────────────────────────

  // POST /carehome/auth/login
  fastify.post<{ Body: { email: string; password: string } }>(
    "/carehome/auth/login",
    async (request, reply) => {
      const { email, password } = request.body;
      const staff = await prisma.careHomeStaff.findUnique({ where: { email } });
      if (!staff)
        return reply.status(401).send({ error: "Invalid credentials" });

      const valid = await bcrypt.compare(password, staff.passwordHash);
      if (!valid)
        return reply.status(401).send({ error: "Invalid credentials" });

      const account = await prisma.careHomeAccount.findUnique({
        where: { id: staff.careHomeId },
      });
      if (account?.status !== "ACTIVE") {
        return reply.status(403).send({ error: "Account is not active" });
      }

      const token = jwt.sign(
        { staffId: staff.id, careHomeId: staff.careHomeId },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      const { passwordHash: _, ...safeStaff } = staff;
      return { token, staff: safeStaff, account };
    }
  );

  // GET /carehome/auth/me
  fastify.get(
    "/carehome/auth/me",
    { preHandler: verifyCareHomeStaff },
    async (request: any, reply) => {
      const staff = await prisma.careHomeStaff.findUnique({
        where: { id: request.staffId },
      });
      if (!staff) return reply.status(404).send({ error: "Not found" });
      const account = await prisma.careHomeAccount.findUnique({
        where: { id: request.careHomeId },
      });
      const { passwordHash: _, ...safeStaff } = staff;
      return { staff: safeStaff, account };
    }
  );

  // ─── RESIDENTS ──────────────────────────────────────────────────────────

  // GET /carehome/residents
  fastify.get(
    "/carehome/residents",
    { preHandler: verifyCareHomeStaff },
    async (request: any, reply) => {
      const residents = await prisma.careHomeResident.findMany({
        where: { careHomeId: request.careHomeId, isActive: true },
        orderBy: { name: "asc" },
      });
      return residents;
    }
  );

  // POST /carehome/residents
  fastify.post<{
    Body: {
      name: string;
      dateOfBirth?: string;
      mobility?: string;
      accessNotes?: string;
      medicalNotes?: string;
      contactName?: string;
      contactPhone?: string;
    };
  }>(
    "/carehome/residents",
    { preHandler: verifyCareHomeStaff },
    async (request: any, reply) => {
      const { dateOfBirth, ...rest } = request.body;
      const resident = await prisma.careHomeResident.create({
        data: {
          careHomeId: request.careHomeId,
          ...rest,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
        },
      });
      return resident;
    }
  );

  // PUT /carehome/residents/:id
  fastify.put<{
    Params: { id: string };
    Body: {
      name?: string;
      dateOfBirth?: string;
      mobility?: string;
      accessNotes?: string;
      medicalNotes?: string;
      contactName?: string;
      contactPhone?: string;
    };
  }>(
    "/carehome/residents/:id",
    { preHandler: verifyCareHomeStaff },
    async (request: any, reply) => {
      const { dateOfBirth, ...rest } = request.body;
      const resident = await prisma.careHomeResident.update({
        where: { id: request.params.id },
        data: {
          ...rest,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
        },
      });
      return resident;
    }
  );

  // DELETE /carehome/residents/:id — soft delete
  fastify.delete<{ Params: { id: string } }>(
    "/carehome/residents/:id",
    { preHandler: verifyCareHomeStaff },
    async (request: any, reply) => {
      await prisma.careHomeResident.update({
        where: { id: request.params.id },
        data: { isActive: false },
      });
      return { success: true };
    }
  );

  // ─── BOOKINGS ────────────────────────────────────────────────────────────

  // GET /carehome/bookings
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    "/carehome/bookings",
    { preHandler: verifyCareHomeStaff },
    async (request: any, reply) => {
      const { from, to } = request.query;
      const bookings = await prisma.booking.findMany({
        where: {
          careHomeId: request.careHomeId,
          ...(from &&
            to && {
              scheduledAt: { gte: new Date(from), lte: new Date(to) },
            }),
        },
        include: {
          resident: true,
          driver: { include: { user: true, vehicle: true } },
        },
        orderBy: { scheduledAt: "desc" },
      });
      return bookings;
    }
  );

  // POST /carehome/bookings — create a one-off booking
  fastify.post<{
    Body: {
      residentId: string;
      pickupAddress: string;
      pickupLat: number;
      pickupLng: number;
      dropoffAddress: string;
      dropoffLat: number;
      dropoffLng: number;
      scheduledAt: string;
      notes?: string;
      recurringBookingId?: string;
    };
  }>(
    "/carehome/bookings",
    { preHandler: verifyCareHomeStaff },
    async (request: any, reply) => {
      const {
        residentId,
        pickupAddress,
        pickupLat,
        pickupLng,
        dropoffAddress,
        dropoffLat,
        dropoffLng,
        scheduledAt,
        notes,
        recurringBookingId,
      } = request.body;

      // Verify resident belongs to this care home
      const resident = await prisma.careHomeResident.findFirst({
        where: { id: residentId, careHomeId: request.careHomeId },
      });
      if (!resident)
        return reply.status(404).send({ error: "Resident not found" });

      // Calculate fare using distance-band pricing
      const distanceMiles = await calculateDistanceMiles(
        pickupLat,
        pickupLng,
        dropoffLat,
        dropoffLng
      );
      const fare = await getCareHomeFare(distanceMiles, recurringBookingId);

      const booking = await prisma.booking.create({
        data: {
          reference: `CH-${Date.now().toString(36).toUpperCase()}`,
          type: "CAREHOME",
          careHomeId: request.careHomeId,
          residentId,
          recurringBookingId: recurringBookingId ?? null,
          pickupAddress,
          pickupLatitude: pickupLat,
          pickupLongitude: pickupLng,
          dropoffAddress,
          dropoffLatitude: dropoffLat,
          dropoffLongitude: dropoffLng,
          scheduledAt: new Date(scheduledAt),
          estimatedFare: fare,
          paymentMethod: "INVOICE",
          status: "PENDING",
          notes: notes ?? null,
        },
        include: { resident: true },
      });
      return booking;
    }
  );

  // GET /carehome/bookings/:id
  fastify.get<{ Params: { id: string } }>(
    "/carehome/bookings/:id",
    { preHandler: verifyCareHomeStaff },
    async (request: any, reply) => {
      const booking = await prisma.booking.findFirst({
        where: { id: request.params.id, careHomeId: request.careHomeId },
        include: {
          resident: true,
          driver: { include: { user: true, vehicle: true } },
        },
      });
      if (!booking) return reply.status(404).send({ error: "Not found" });
      return booking;
    }
  );

  // DELETE /carehome/bookings/:id — cancel booking
  fastify.delete<{ Params: { id: string } }>(
    "/carehome/bookings/:id",
    { preHandler: verifyCareHomeStaff },
    async (request: any, reply) => {
      const booking = await prisma.booking.findFirst({
        where: { id: request.params.id, careHomeId: request.careHomeId },
      });
      if (!booking) return reply.status(404).send({ error: "Not found" });
      if (!["PENDING", "ACCEPTED"].includes(booking.status)) {
        return reply
          .status(400)
          .send({ error: "Cannot cancel a booking in progress" });
      }
      await prisma.booking.update({
        where: { id: request.params.id },
        data: { status: "CANCELLED" },
      });
      return { success: true };
    }
  );

  // ─── RECURRING BOOKINGS ──────────────────────────────────────────────────

  // GET /carehome/recurring
  fastify.get(
    "/carehome/recurring",
    { preHandler: verifyCareHomeStaff },
    async (request: any, reply) => {
      const recurring = await prisma.recurringBooking.findMany({
        where: { careHomeId: request.careHomeId, isActive: true },
        include: { resident: true },
        orderBy: { createdAt: "desc" },
      });
      return recurring;
    }
  );

  // POST /carehome/recurring
  fastify.post<{
    Body: {
      residentId: string;
      pickupAddress: string;
      pickupLat?: number;
      pickupLng?: number;
      dropoffAddress: string;
      dropoffLat?: number;
      dropoffLng?: number;
      pattern: string;
      dayOfWeek?: number;
      dayOfMonth?: number;
      scheduledTime: string;
      distanceMiles?: number;
      flatFare?: number;
      notes?: string;
    };
  }>(
    "/carehome/recurring",
    { preHandler: verifyCareHomeStaff },
    async (request: any, reply) => {
      const resident = await prisma.careHomeResident.findFirst({
        where: { id: request.body.residentId, careHomeId: request.careHomeId },
      });
      if (!resident)
        return reply.status(404).send({ error: "Resident not found" });

      const recurring = await prisma.recurringBooking.create({
        data: {
          careHomeId: request.careHomeId,
          ...request.body,
        },
        include: { resident: true },
      });
      return recurring;
    }
  );

  // PUT /carehome/recurring/:id
  fastify.put<{
    Params: { id: string };
    Body: Record<string, any>;
  }>(
    "/carehome/recurring/:id",
    { preHandler: verifyCareHomeStaff },
    async (request: any, reply) => {
      const recurring = await prisma.recurringBooking.update({
        where: { id: request.params.id },
        data: request.body,
        include: { resident: true },
      });
      return recurring;
    }
  );

  // DELETE /carehome/recurring/:id — deactivate
  fastify.delete<{ Params: { id: string } }>(
    "/carehome/recurring/:id",
    { preHandler: verifyCareHomeStaff },
    async (request: any, reply) => {
      await prisma.recurringBooking.update({
        where: { id: request.params.id },
        data: { isActive: false },
      });
      return { success: true };
    }
  );

  // ─── INVOICES ────────────────────────────────────────────────────────────

  // GET /carehome/invoices
  fastify.get(
    "/carehome/invoices",
    { preHandler: verifyCareHomeStaff },
    async (request: any, reply) => {
      const invoices = await prisma.careHomeInvoice.findMany({
        where: { careHomeId: request.careHomeId },
        orderBy: { createdAt: "desc" },
      });
      return invoices;
    }
  );

  // GET /carehome/invoices/:id
  fastify.get<{ Params: { id: string } }>(
    "/carehome/invoices/:id",
    { preHandler: verifyCareHomeStaff },
    async (request: any, reply) => {
      const invoice = await prisma.careHomeInvoice.findFirst({
        where: { id: request.params.id, careHomeId: request.careHomeId },
        include: {
          bookings: {
            include: { resident: true },
            orderBy: { scheduledAt: "asc" },
          },
        },
      });
      if (!invoice) return reply.status(404).send({ error: "Not found" });
      return invoice;
    }
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function calculateDistanceMiles(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number
): Promise<number> {
  // Haversine formula
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(dropoffLat - pickupLat);
  const dLon = toRad(dropoffLng - pickupLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(pickupLat)) *
      Math.cos(toRad(dropoffLat)) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

async function getCareHomeFare(
  distanceMiles: number,
  recurringBookingId?: string
): Promise<number> {
  // If recurring booking has a flat fare, use it
  if (recurringBookingId) {
    const rb = await prisma.recurringBooking.findUnique({
      where: { id: recurringBookingId },
    });
    if (rb?.flatFare) return rb.flatFare;
  }

  // Use care home distance-band pricing from PricingConfig
  const config = await prisma.pricingConfig.findFirst();
  if (!config) return 15; // fallback

  if (distanceMiles < 3) return config.careHomeUnder3miles;
  if (distanceMiles < 7) return config.careHome3to7miles;
  if (distanceMiles < 15) return config.careHome7to15miles;
  if (distanceMiles < 25) return config.careHome15to25miles;
  return config.careHome25to40miles;
}
