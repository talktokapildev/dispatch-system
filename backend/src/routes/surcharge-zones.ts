import { FastifyInstance } from "fastify";
import { z } from "zod";
import { PricingService } from "../services/pricing.service";

const zoneSchema = z.object({
  name: z.string().min(2),
  type: z.enum(["AIRPORT", "HOTEL", "VENUE", "OTHER"]).default("OTHER"),
  latitude: z.number(),
  longitude: z.number(),
  radiusMeters: z.number().int().min(50).max(5000).default(500),
  pickupFee: z.number().min(0).default(0),
  dropoffFee: z.number().min(0).default(0),
  isActive: z.boolean().default(true),
  notes: z.string().optional(),
  polygon: z
    .array(z.object({ lat: z.number(), lng: z.number() }))
    .nullable()
    .optional(),
});

export async function surchargeZoneRoutes(fastify: FastifyInstance) {
  const pricing = new PricingService(fastify.prisma, fastify.redis);

  // ─── GET /surcharge-zones (public — used by apps + corporate portal) ──────
  fastify.get("/surcharge-zones", async (_request, reply) => {
    const zones = await pricing.getSurchargeZones();
    return reply.send({ success: true, data: zones });
  });

  // ─── GET /admin/surcharge-zones ───────────────────────────────────────────
  fastify.get(
    "/admin/surcharge-zones",
    { preHandler: [fastify.authenticateAdmin] },
    async (_request, reply) => {
      const zones = await (fastify.prisma as any).surchargeZone.findMany({
        orderBy: [{ isActive: "desc" }, { type: "asc" }, { name: "asc" }],
      });
      return reply.send({ success: true, data: zones });
    }
  );

  // ─── POST /admin/surcharge-zones ──────────────────────────────────────────
  fastify.post(
    "/admin/surcharge-zones",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const body = zoneSchema.parse(request.body);
      const zone = await (fastify.prisma as any).surchargeZone.create({
        data: body,
      });
      await pricing.invalidateZonesCache();
      return reply.status(201).send({ success: true, data: zone });
    }
  );

  // ─── PUT /admin/surcharge-zones/:id ──────────────────────────────────────
  fastify.put(
    "/admin/surcharge-zones/:id",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = zoneSchema.partial().parse(request.body);
      const zone = await (fastify.prisma as any).surchargeZone.update({
        where: { id },
        data: body,
      });
      await pricing.invalidateZonesCache();
      return reply.send({ success: true, data: zone });
    }
  );

  // ─── DELETE /admin/surcharge-zones/:id ───────────────────────────────────
  fastify.delete(
    "/admin/surcharge-zones/:id",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await (fastify.prisma as any).surchargeZone.delete({ where: { id } });
      await pricing.invalidateZonesCache();
      return reply.send({ success: true });
    }
  );
}
