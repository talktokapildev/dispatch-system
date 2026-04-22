import { FastifyInstance } from "fastify";
import { z } from "zod";
import { PricingService } from "../services/pricing.service";

const calculateSchema = z.object({
  distanceMiles: z.number().positive(),
  durationMinutes: z.number().positive(),
  scheduledAt: z.string().datetime().optional(), // ISO string
  isGatwickPickup: z.boolean().optional(),
  isGatwickDropoff: z.boolean().optional(),
  isHeathrowPickup: z.boolean().optional(),
  isHeathrowDropoff: z.boolean().optional(),
  isMeetAndGreet: z.boolean().optional(),
  isDartfordCrossing: z.boolean().optional(),
  isCongestionCharge: z.boolean().optional(),
  extraStops: z.number().int().min(0).optional(),
});

const careHomeCalculateSchema = z.object({
  distanceMiles: z.number().positive(),
  isHospitalDischarge: z.boolean().optional(),
  extraStops: z.number().int().min(0).optional(),
  waitingMinutesOverFree: z.number().min(0).optional(),
  isHalfDay: z.boolean().optional(),
  isFullDay: z.boolean().optional(),
  extraHoursBeyondFullDay: z.number().min(0).optional(),
});

const updateConfigSchema = z.object({
  baseFare: z.number().positive().optional(),
  perMile: z.number().positive().optional(),
  perMinute: z.number().min(0).optional(),
  minimumFare: z.number().positive().optional(),
  platformCommission: z.number().min(0).max(1).optional(),
  nightPremium: z.number().min(0).max(2).optional(),
  nightStartHour: z.number().int().min(0).max(23).optional(),
  nightEndHour: z.number().int().min(0).max(23).optional(),
  bankHolidayPremium: z.number().min(0).max(2).optional(),
  christmasNyePremium: z.number().min(0).max(2).optional(),
  gatwickDropoff: z.number().min(0).optional(),
  gatwickPickup: z.number().min(0).optional(),
  heathrowDropoff: z.number().min(0).optional(),
  heathrowPickup: z.number().min(0).optional(),
  meetAndGreet: z.number().min(0).optional(),
  dartfordCrossing: z.number().min(0).optional(),
  congestionCharge: z.number().min(0).optional(),
  extraStopCharge: z.number().min(0).optional(),
  freeWaitingMinutes: z.number().int().min(0).optional(),
  waitingRatePerMinute: z.number().min(0).optional(),
  retailCancelFreeMinutes: z.number().int().min(0).optional(),
  accountCancelFreeHours: z.number().int().min(0).optional(),
  careHomeUnder3miles: z.number().positive().optional(),
  careHome3to7miles: z.number().positive().optional(),
  careHome7to15miles: z.number().positive().optional(),
  careHome15to25miles: z.number().positive().optional(),
  careHome25to40miles: z.number().positive().optional(),
  careHomeHospitalDischarge: z.number().min(0).optional(),
  careHomeHalfDay: z.number().positive().optional(),
  careHomeFullDay: z.number().positive().optional(),
  careHomeHourlyBeyondFull: z.number().positive().optional(),
});

export async function pricingRoutes(fastify: FastifyInstance) {
  const pricingService = new PricingService(fastify.prisma);

  // ─── GET /pricing/config ─────────────────────────────────────────────────
  // Public — apps need this to show config-driven UI
  fastify.get("/pricing/config", async (_request, reply) => {
    const config = await pricingService.getConfig();
    return reply.send({ success: true, data: config });
  });

  // ─── POST /pricing/calculate ─────────────────────────────────────────────
  // Public — passenger app + corporate portal call this for fare estimates
  fastify.post("/pricing/calculate", async (request, reply) => {
    const body = calculateSchema.parse(request.body);
    const estimate = await pricingService.estimateFare({
      ...body,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
    });
    return reply.send({ success: true, data: estimate });
  });

  // ─── POST /pricing/calculate/care-home ───────────────────────────────────
  // Public — care home portal calls this
  fastify.post("/pricing/calculate/care-home", async (request, reply) => {
    const body = careHomeCalculateSchema.parse(request.body);
    const estimate = await pricingService.estimateCareHomeFare(
      body.distanceMiles,
      body
    );
    return reply.send({ success: true, data: estimate });
  });

  // ─── PUT /pricing/config ─────────────────────────────────────────────────
  // Admin only — update any pricing value
  fastify.put(
    "/pricing/config",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user;
      if (!["ADMIN", "DISPATCHER"].includes(user.role)) {
        return reply.status(403).send({ success: false, error: "Forbidden" });
      }

      const body = updateConfigSchema.parse(request.body);
      const updated = await pricingService.updateConfig(body, user.userId);
      return reply.send({ success: true, data: updated });
    }
  );
}
