// backend/src/routes/admin/airport-pickups.ts
//
// Admin configuration for airport pickups:
//   GET /admin/airport-pickups                     → meeting points, buffers, airport zones
//   PUT /admin/airport-pickups/meeting-points/:id  → edit name / instructions / pin / active
//   PUT /admin/airport-pickups/buffers             → pickup buffer minutes after landing
//
// Every meeting point is checked against the surcharge zone marked with the
// same airportIata. A pin outside that zone still saves, but returns a
// warning: airport pickups there would silently lose the airport charge.
import { FastifyInstance } from "fastify";
import { BookingStatus } from "@prisma/client";
import {
  getFlightBuffers,
  isInsideZone,
  BUFFER_KEYS,
  BUFFER_MIN,
  BUFFER_MAX,
} from "../../utils/airportPickup";

const FINISHED_STATUSES = [
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
  BookingStatus.NO_SHOW,
];

export async function adminAirportPickupRoutes(fastify: FastifyInstance) {
  const zoneSelect = {
    id: true,
    name: true,
    latitude: true,
    longitude: true,
    radiusMeters: true,
    polygon: true,
  };

  const zoneFor = (airportIata: string) =>
    fastify.prisma.surchargeZone.findFirst({
      where: { airportIata, isActive: true },
      select: zoneSelect,
    });

  const upcomingBookings = (meetingPointId: string) =>
    fastify.prisma.booking.count({
      where: {
        meetingPointId,
        scheduledAt: { gt: new Date() },
        status: { notIn: FINISHED_STATUSES },
      },
    });

  // ─── List meeting points + buffers + airport zones ───
  fastify.get(
    "/admin/airport-pickups",
    { preHandler: [fastify.authenticateAdmin] },
    async (_request, reply) => {
      const [points, buffers] = await Promise.all([
        fastify.prisma.airportMeetingPoint.findMany({
          orderBy: [{ airportIata: "asc" }, { terminal: "asc" }],
        }),
        getFlightBuffers(fastify.prisma),
      ]);

      const airports = [...new Set(points.map((p) => p.airportIata))];
      const zones: Record<string, any> = {};
      for (const iata of airports) zones[iata] = await zoneFor(iata);

      const meetingPoints = await Promise.all(
        points.map(async (p) => {
          const zone = zones[p.airportIata];
          return {
            ...p,
            zone: zone ? { id: zone.id, name: zone.name } : null,
            insideZone: zone
              ? isInsideZone(p.latitude, p.longitude, zone)
              : false,
            upcomingBookings: await upcomingBookings(p.id),
          };
        })
      );

      return reply.send({
        success: true,
        data: {
          buffers,
          bufferLimits: { min: BUFFER_MIN, max: BUFFER_MAX },
          meetingPoints,
          zones,
        },
      });
    }
  );

  // ─── Edit a meeting point ───
  fastify.put(
    "/admin/airport-pickups/meeting-points/:id",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as {
        name?: unknown;
        instructions?: unknown;
        latitude?: unknown;
        longitude?: unknown;
        isActive?: unknown;
      };

      const existing = await fastify.prisma.airportMeetingPoint.findUnique({
        where: { id },
      });
      if (!existing)
        return reply
          .status(404)
          .send({ success: false, error: "Meeting point not found" });

      const data: {
        name?: string;
        instructions?: string;
        latitude?: number;
        longitude?: number;
        isActive?: boolean;
      } = {};

      if (body.name !== undefined) {
        if (
          typeof body.name !== "string" ||
          !body.name.trim() ||
          body.name.length > 100
        ) {
          return reply.status(400).send({
            success: false,
            error: "Name is required (max 100 characters)",
          });
        }
        data.name = body.name.trim();
      }
      if (body.instructions !== undefined) {
        if (
          typeof body.instructions !== "string" ||
          !body.instructions.trim() ||
          body.instructions.length > 500
        ) {
          return reply.status(400).send({
            success: false,
            error: "Instructions are required (max 500 characters)",
          });
        }
        data.instructions = body.instructions.trim();
      }
      if (body.latitude !== undefined || body.longitude !== undefined) {
        const lat = Number(body.latitude);
        const lng = Number(body.longitude);
        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lng) ||
          Math.abs(lat) > 90 ||
          Math.abs(lng) > 180
        ) {
          return reply
            .status(400)
            .send({ success: false, error: "Invalid pin location" });
        }
        data.latitude = lat;
        data.longitude = lng;
      }
      if (body.isActive !== undefined) {
        if (typeof body.isActive !== "boolean") {
          return reply
            .status(400)
            .send({ success: false, error: "isActive must be true or false" });
        }
        data.isActive = body.isActive;
      }

      const updated = await fastify.prisma.airportMeetingPoint.update({
        where: { id },
        data,
      });

      const zone = await zoneFor(updated.airportIata);
      const insideZone = zone
        ? isInsideZone(updated.latitude, updated.longitude, zone)
        : false;
      const upcoming = await upcomingBookings(updated.id);

      let warning: string | undefined;
      if (!zone) {
        warning = `No active surcharge zone is marked for ${updated.airportIata}. Airport pickups won't be detected or charged.`;
      } else if (!insideZone) {
        warning = `This pin is outside the "${zone.name}" surcharge zone. Pickups here won't get the airport charge.`;
      }

      const pinMoved =
        data.latitude !== undefined &&
        (data.latitude !== existing.latitude ||
          data.longitude !== existing.longitude);
      if (pinMoved && upcoming > 0) {
        const note = `${upcoming} upcoming booking(s) still use the previous location.`;
        warning = warning ? `${warning} ${note}` : note;
      }

      return reply.send({
        success: true,
        data: {
          ...updated,
          zone: zone ? { id: zone.id, name: zone.name } : null,
          insideZone,
          upcomingBookings: upcoming,
        },
        ...(warning && { warning }),
      });
    }
  );

  // ─── Pickup buffers (minutes after landing) ───
  fastify.put(
    "/admin/airport-pickups/buffers",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const body = (request.body ?? {}) as {
        hand?: unknown;
        checked?: unknown;
      };
      const hand = Number(body.hand);
      const checked = Number(body.checked);
      const valid = (n: number) =>
        Number.isInteger(n) && n >= BUFFER_MIN && n <= BUFFER_MAX;

      if (!valid(hand) || !valid(checked)) {
        return reply.status(400).send({
          success: false,
          error: `Buffers must be whole minutes between ${BUFFER_MIN} and ${BUFFER_MAX}`,
        });
      }

      await fastify.prisma.$transaction([
        fastify.prisma.systemSetting.upsert({
          where: { key: BUFFER_KEYS.hand },
          update: { value: String(hand) },
          create: { key: BUFFER_KEYS.hand, value: String(hand) },
        }),
        fastify.prisma.systemSetting.upsert({
          where: { key: BUFFER_KEYS.checked },
          update: { value: String(checked) },
          create: { key: BUFFER_KEYS.checked, value: String(checked) },
        }),
      ]);

      return reply.send({ success: true, data: { hand, checked } });
    }
  );
}
