import { FastifyInstance } from "fastify";
import { z } from "zod";
import { PricingService } from "../services/pricing.service";

// ── Geometry helpers ────────────────────────────────────────────────────────

/** Haversine distance in metres between two lat/lng points */
function haversineMetres(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Ray-casting point-in-polygon for {lat, lng}[] polygons */
function pointInPolygon(
  point: { lat: number; lng: number },
  polygon: { lat: number; lng: number }[]
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  const x = point.lat;
  const y = point.lng;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat,
      yi = polygon[i].lng;
    const xj = polygon[j].lat,
      yj = polygon[j].lng;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Returns true if a point is within a zone — polygon takes priority over radius */
function pointInZone(
  lat: number,
  lng: number,
  zone: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
    polygon: any;
  }
): boolean {
  if (zone.polygon) {
    const polygonPoints = zone.polygon as { lat: number; lng: number }[];
    return pointInPolygon({ lat, lng }, polygonPoints);
  }
  return (
    haversineMetres(lat, lng, zone.latitude, zone.longitude) <=
    zone.radiusMeters
  );
}

// ── Validation schemas ───────────────────────────────────────────────────────

const calculateSchema = z.object({
  distanceMiles: z.number().positive(),
  durationMinutes: z.number().positive(),
  scheduledAt: z.string().datetime().optional(),
  pickupLatitude: z.number().optional(),
  pickupLongitude: z.number().optional(),
  dropoffLatitude: z.number().optional(),
  dropoffLongitude: z.number().optional(),
  // Legacy boolean flags — still accepted for backwards compatibility
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

// ── Routes ───────────────────────────────────────────────────────────────────

export async function pricingRoutes(fastify: FastifyInstance) {
  const pricingService = new PricingService(fastify.prisma);

  // ─── GET /pricing/config ─────────────────────────────────────────────────
  fastify.get("/pricing/config", async (_request, reply) => {
    const config = await pricingService.getConfig();
    return reply.send({ success: true, data: config });
  });

  // ─── POST /pricing/calculate ─────────────────────────────────────────────
  fastify.post("/pricing/calculate", async (request, reply) => {
    const body = calculateSchema.parse(request.body);

    // ── Auto-detect surcharge zones from coordinates ──────────────────────
    const zoneSurcharges: { name: string; fee: number; label: string }[] = [];

    const hasPickupCoords =
      body.pickupLatitude !== undefined && body.pickupLongitude !== undefined;
    const hasDropoffCoords =
      body.dropoffLatitude !== undefined && body.dropoffLongitude !== undefined;

    if (hasPickupCoords || hasDropoffCoords) {
      const zones = await fastify.prisma.surchargeZone.findMany({
        where: { isActive: true },
      });

      for (const zone of zones) {
        if (hasPickupCoords && zone.pickupFee > 0) {
          if (pointInZone(body.pickupLatitude!, body.pickupLongitude!, zone)) {
            zoneSurcharges.push({
              name: zone.name,
              fee: zone.pickupFee,
              label: `${zone.name} pickup surcharge: £${zone.pickupFee.toFixed(
                2
              )}`,
            });
          }
        }
        if (hasDropoffCoords && zone.dropoffFee > 0) {
          if (
            pointInZone(body.dropoffLatitude!, body.dropoffLongitude!, zone)
          ) {
            zoneSurcharges.push({
              name: zone.name,
              fee: zone.dropoffFee,
              label: `${
                zone.name
              } dropoff surcharge: £${zone.dropoffFee.toFixed(2)}`,
            });
          }
        }
      }
    }

    // ── Calculate base fare ───────────────────────────────────────────────
    const estimate = await pricingService.estimateFare({
      distanceMiles: body.distanceMiles,
      durationMinutes: body.durationMinutes,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
      isGatwickPickup: body.isGatwickPickup,
      isGatwickDropoff: body.isGatwickDropoff,
      isHeathrowPickup: body.isHeathrowPickup,
      isHeathrowDropoff: body.isHeathrowDropoff,
      isMeetAndGreet: body.isMeetAndGreet,
      isDartfordCrossing: body.isDartfordCrossing,
      isCongestionCharge: body.isCongestionCharge,
      extraStops: body.extraStops,
    });

    // ── Add zone surcharges on top ────────────────────────────────────────
    const zoneSurchargeTotal = zoneSurcharges.reduce((s, z) => s + z.fee, 0);
    const total = Math.round((estimate.total + zoneSurchargeTotal) * 100) / 100;
    const commissionRate =
      estimate.total > 0 ? 1 - estimate.driverEarning / estimate.total : 0;
    const driverEarning = Math.round(total * (1 - commissionRate) * 100) / 100;
    const platformFee = Math.round((total - driverEarning) * 100) / 100;

    return reply.send({
      success: true,
      data: {
        ...estimate,
        supplements: [
          ...(estimate.supplements ?? []),
          ...zoneSurcharges.map((z) => ({ label: z.name, amount: z.fee })),
        ],
        breakdown: [
          ...estimate.breakdown,
          ...zoneSurcharges.map((z) => z.label),
        ],
        total,
        driverEarning,
        platformFee,
      },
    });
  });

  // ─── POST /pricing/calculate/care-home ───────────────────────────────────
  fastify.post("/pricing/calculate/care-home", async (request, reply) => {
    const body = careHomeCalculateSchema.parse(request.body);
    const estimate = await pricingService.estimateCareHomeFare(
      body.distanceMiles,
      body
    );
    return reply.send({ success: true, data: estimate });
  });

  // ─── PUT /pricing/config ─────────────────────────────────────────────────
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
