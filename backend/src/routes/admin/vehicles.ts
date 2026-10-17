// backend/src/routes/admin/vehicles.ts
//
// Admin Vehicles page.
//
// GET    /api/v1/admin/vehicles?status=active|retired|all   list (default active)
// GET    /api/v1/admin/vehicles/:id                          one vehicle + its recent trips
// POST   /api/v1/admin/vehicles                              add (TfL cap applies); optional driverId
// PATCH  /api/v1/admin/vehicles/:id                          edit details
// POST   /api/v1/admin/vehicles/:id/assign   { driverId|null } give to a driver / unassign
// POST   /api/v1/admin/vehicles/:id/retire                   take off the fleet (kept on old bookings)
// POST   /api/v1/admin/vehicles/:id/restore                  back on the fleet (TfL cap applies)
// DELETE /api/v1/admin/vehicles/:id                          only if it has never done a trip
//
// Rules live in services/vehicle.service.ts.
import { FastifyInstance, FastifyReply } from "fastify";
import { VehicleClass } from "@prisma/client";
import { z } from "zod";
import {
  TFL_VEHICLE_CAP,
  VehicleError,
  assertUnderCap,
  findPlateClash,
  fleetCount,
  normalisePlate,
  retireVehicle,
  setDriverVehicle,
} from "../../services/vehicle.service";

const dateStr = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date");
const optText = z
  .string()
  .trim()
  .max(200)
  .nullable()
  .optional()
  .transform((s) => (s === undefined ? undefined : s || null));

const fields = {
  make: z.string().trim().min(1, "Make is required").max(60),
  model: z.string().trim().min(1, "Model is required").max(60),
  year: z.number().int().min(1990).max(new Date().getFullYear() + 1),
  colour: z.string().trim().max(40).default(""),
  licensePlate: z.string().trim().min(2, "Registration is required").max(12),
  class: z.nativeEnum(VehicleClass).default(VehicleClass.STANDARD),
  seats: z.number().int().min(1).max(16).default(4),
  motExpiry: dateStr,
  insuranceExpiry: dateStr,
  phvLicenceNumber: optText,
  phvLicenceExpiry: dateStr.nullable().optional(),
  phvDiscNumber: optText,
  emissionStandard: optText,
  isUlezCompliant: z.boolean().default(false),
  notes: z.string().trim().max(1000).nullable().optional(),
  keeperName: optText,
  keeperAddress: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .transform((s) => (s === undefined ? undefined : s || null)),
  startDate: dateStr.optional(),
};
const createSchema = z.object({ ...fields, driverId: z.string().min(1).nullable().optional() });
const updateSchema = z.object(fields).partial();

const toDate = (s: string | null | undefined) =>
  s === undefined ? undefined : s === null ? null : new Date(s);

function vehicleData(body: Partial<z.infer<typeof updateSchema>>) {
  const { motExpiry, insuranceExpiry, phvLicenceExpiry, licensePlate, startDate, ...rest } = body;
  return {
    ...rest,
    ...(startDate !== undefined && { startDate: new Date(startDate) }),
    ...(licensePlate !== undefined && { licensePlate: normalisePlate(licensePlate) }),
    ...(motExpiry !== undefined && { motExpiry: new Date(motExpiry) }),
    ...(insuranceExpiry !== undefined && { insuranceExpiry: new Date(insuranceExpiry) }),
    ...(phvLicenceExpiry !== undefined && { phvLicenceExpiry: toDate(phvLicenceExpiry) }),
  };
}

const listInclude = {
  driver: {
    select: {
      id: true,
      status: true,
      archivedAt: true,
      user: { select: { firstName: true, lastName: true, phone: true } },
    },
  },
  _count: { select: { bookings: true } },
} as const;

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof VehicleError)
    return reply.status(err.statusCode).send({ success: false, error: err.message });
  throw err;
}

export async function adminVehicleRoutes(fastify: FastifyInstance) {
  const prisma = fastify.prisma;

  async function plateFree(plate: string, exceptId?: string) {
    const clash = await findPlateClash(prisma, plate, exceptId);
    if (clash)
      throw new VehicleError(
        `${clash.licensePlate} is already on the system${clash.archivedAt ? " (retired — restore it instead)" : ""}.`,
        409
      );
  }

  // ─── List ───
  fastify.get("/admin/vehicles", { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { status = "active" } = request.query as { status?: string };
    const where =
      status === "retired"
        ? { archivedAt: { not: null } }
        : status === "all"
          ? {}
          : { archivedAt: null };
    const [items, fleet] = await Promise.all([
      prisma.vehicle.findMany({
        where,
        include: listInclude,
        orderBy: [{ archivedAt: "asc" }, { licensePlate: "asc" }],
      }),
      fleetCount(prisma),
    ]);
    // Last trip date per vehicle
    const last = await prisma.booking.groupBy({
      by: ["vehicleId"],
      where: { vehicleId: { in: items.map((v) => v.id) }, status: "COMPLETED" },
      _max: { completedAt: true },
    });
    const lastTrip = new Map(last.map((r) => [r.vehicleId, r._max.completedAt]));
    return reply.send({
      success: true,
      data: {
        items: items.map((v) => ({ ...v, lastTripAt: lastTrip.get(v.id) ?? null })),
        fleetCount: fleet,
        cap: TFL_VEHICLE_CAP,
      },
    });
  });

  // ─── One vehicle ───
  fastify.get("/admin/vehicles/:id", { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
      include: {
        ...listInclude,
        bookings: {
          orderBy: [{ completedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
          take: 10,
          select: {
            id: true,
            reference: true,
            status: true,
            pickupAddress: true,
            dropoffAddress: true,
            scheduledAt: true,
            completedAt: true,
            createdAt: true,
            driver: { select: { user: { select: { firstName: true, lastName: true } } } },
          },
        },
      },
    });
    if (!vehicle) return reply.status(404).send({ success: false, error: "Vehicle not found" });
    return reply.send({ success: true, data: vehicle });
  });

  // ─── Add ───
  fastify.post("/admin/vehicles", { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { driverId, ...body } = createSchema.parse(request.body);
    try {
      await plateFree(body.licensePlate);
      const vehicle = await prisma.$transaction(async (tx) => {
        await assertUnderCap(tx);
        const created = await tx.vehicle.create({
          data: vehicleData(body) as any,
        });
        if (driverId) await setDriverVehicle(tx, driverId, created.id);
        return tx.vehicle.findUniqueOrThrow({ where: { id: created.id }, include: listInclude });
      });
      return reply.status(201).send({ success: true, data: vehicle });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // ─── Edit ───
  fastify.patch("/admin/vehicles/:id", { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateSchema.parse(request.body);
    try {
      const existing = await prisma.vehicle.findUnique({ where: { id } });
      if (!existing) throw new VehicleError("Vehicle not found", 404);
      if (body.licensePlate !== undefined) await plateFree(body.licensePlate, id);
      const vehicle = await prisma.vehicle.update({
        where: { id },
        data: vehicleData(body),
        include: listInclude,
      });
      return reply.send({ success: true, data: vehicle });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // ─── Assign / unassign ───
  fastify.post(
    "/admin/vehicles/:id/assign",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { driverId } = z
        .object({ driverId: z.string().min(1).nullable() })
        .parse(request.body);
      try {
        const result = await prisma.$transaction(async (tx) => {
          const vehicle = await tx.vehicle.findUnique({ where: { id } });
          if (!vehicle) throw new VehicleError("Vehicle not found", 404);
          if (driverId) return setDriverVehicle(tx, driverId, id);
          if (vehicle.driverId) await setDriverVehicle(tx, vehicle.driverId, null);
          return { movedFromDriverId: null };
        });
        const vehicle = await prisma.vehicle.findUnique({ where: { id }, include: listInclude });
        return reply.send({ success: true, data: { vehicle, ...result } });
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );

  // ─── Retire / restore ───
  fastify.post(
    "/admin/vehicles/:id/retire",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await prisma.$transaction((tx) => retireVehicle(tx, id));
        const vehicle = await prisma.vehicle.findUnique({ where: { id }, include: listInclude });
        return reply.send({ success: true, data: vehicle });
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );

  fastify.post(
    "/admin/vehicles/:id/restore",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const vehicle = await prisma.$transaction(async (tx) => {
          const v = await tx.vehicle.findUnique({ where: { id } });
          if (!v) throw new VehicleError("Vehicle not found", 404);
          if (!v.archivedAt) return v;
          await assertUnderCap(tx);
          return tx.vehicle.update({ where: { id }, data: { archivedAt: null, isActive: true } });
        });
        return reply.send({ success: true, data: vehicle });
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );

  // ─── Delete (only a vehicle that has never been on a booking) ───
  fastify.delete("/admin/vehicles/:id", { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const vehicle = await prisma.vehicle.findUnique({
        where: { id },
        include: { _count: { select: { bookings: true } } },
      });
      if (!vehicle) throw new VehicleError("Vehicle not found", 404);
      if (vehicle._count.bookings > 0)
        throw new VehicleError(
          `${vehicle.licensePlate} is on ${vehicle._count.bookings} booking${vehicle._count.bookings === 1 ? "" : "s"}, so it can't be deleted. Retire it instead.`,
          409
        );
      await prisma.$transaction(async (tx) => {
        if (vehicle.driverId) await setDriverVehicle(tx, vehicle.driverId, null);
        await tx.vehicle.delete({ where: { id } });
      });
      return reply.send({ success: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
