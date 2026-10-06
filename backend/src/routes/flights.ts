// backend/src/routes/flights.ts
//
// GET /flights/lookup?number=EZY8004&date=2026-10-29
//
// Used by the passenger app when a pickup is at an airport. Returns the flight,
// the meeting point for its terminal, and the earliest pickup time for each
// luggage option (scheduled landing + buffer, rounded up to 5 minutes).
// The app does no time maths itself — and the booking endpoint re-checks all
// of this server-side, so the app can't book an earlier pickup.
import { FastifyInstance } from "fastify";
import {
  FlightDataService,
  LookupFailure,
} from "../services/flightData.service";
import { ScheduledBookingService } from "../services/scheduledBooking.service";
import {
  getFlightBuffers,
  earliestPickupAfterLanding,
  isInsideZone,
} from "../utils/airportPickup";
import {
  airportPickupSchema,
  resolveAirportPickup,
} from "../services/airportBooking.service";
import { interpretFlight } from "../services/flightRules";

const AIRPORT = "LGW"; // only airport with meeting points for now

const FAILURE_RESPONSES: Record<
  LookupFailure,
  { status: number; message: string }
> = {
  invalid_input: {
    status: 400,
    message: "Please check the flight number and date.",
  },
  not_found: {
    status: 404,
    message:
      "We couldn't find that flight on that date. Please check the number.",
  },
  not_arriving: {
    status: 404,
    message: "That flight doesn't arrive at Gatwick on that date.",
  },
  provider_error: {
    status: 502,
    message:
      "Flight information is temporarily unavailable. You can continue without it.",
  },
  daily_limit: {
    status: 503,
    message:
      "Flight information is temporarily unavailable. You can continue without it.",
  },
};

/** Round up to the next 5 minutes: 15:57 → 16:00. */
// function roundUpTo5Min(date: Date): Date {
//   const step = 5 * 60_000;
//   return new Date(Math.ceil(date.getTime() / step) * step);
// }

export async function flightRoutes(fastify: FastifyInstance) {
  const flights = new FlightDataService(fastify.redis);

  fastify.get(
    "/flights/lookup",
    {
      preHandler: [fastify.authenticate],
      config: { rateLimit: { max: 15, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { number, date } = request.query as {
        number?: string;
        date?: string;
      };
      if (!number || !date) {
        return reply.status(400).send({
          success: false,
          error: "number and date are required",
          code: "invalid_input",
        });
      }

      const result = await flights.lookupArrival(number, date, AIRPORT);
      if (!result.ok) {
        const f = FAILURE_RESPONSES[result.reason];
        return reply
          .status(f.status)
          .send({ success: false, error: f.message, code: result.reason });
      }

      const flight = result.flight;
      const [buffers, meetingPoints] = await Promise.all([
        getFlightBuffers(fastify.prisma),
        fastify.prisma.airportMeetingPoint.findMany({
          where: { airportIata: AIRPORT, isActive: true },
          select: {
            id: true,
            terminal: true,
            name: true,
            instructions: true,
            latitude: true,
            longitude: true,
          },
          orderBy: { terminal: "asc" },
        }),
      ]);

      //const landing = new Date(flight.scheduledArrivalUtc);
      // Same gate-arrival rule as Phase 2: actual if landed, else best estimate.
      const interp = interpretFlight(flight);
      // Don't offer pickups for flights that won't arrive, or already have.
      if (interp.phase !== "SCHEDULED") {
        const n = flight.flightNumber || number;
        const t = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/London",
          hour: "2-digit",
          minute: "2-digit",
        }).format(interp.landedAt ?? interp.gateArrival);
        const error =
          interp.phase === "CANCELLED"
            ? `${n} on that date has been cancelled. Please check with your airline.`
            : interp.phase === "DIVERTED"
            ? `${n} has been diverted to another airport. Please check with your airline.`
            : `${n} landed at ${t} on that date. If you're at Gatwick now, book with "Now".`;
        return reply.status(409).send({
          success: false,
          error,
          code: `flight_${interp.phase.toLowerCase()}`,
        });
      }
      const expectedArrivalUtc = interp.gateArrival.toISOString();
      const handPickup = earliestPickupAfterLanding(
        expectedArrivalUtc,
        buffers,
        "HAND"
      );
      const checkedPickup = earliestPickupAfterLanding(
        expectedArrivalUtc,
        buffers,
        "CHECKED"
      );

      const suggested = flight.terminal
        ? meetingPoints.find((m) => m.terminal === flight.terminal) ?? null
        : null;

      return reply.send({
        success: true,
        data: {
          flight: {
            flightNumber: flight.flightNumber,
            airlineName: flight.airlineName,
            originIata: flight.originIata,
            originName: flight.originName,
            scheduledArrivalUtc: flight.scheduledArrivalUtc,
            expectedArrivalUtc,
            confidence: interp.confidence,
            terminal: flight.terminal,
            status: flight.status,
          },
          // Passenger confirms the terminal; if the provider didn't give one,
          // suggestedMeetingPoint is null and the app asks them to choose.
          suggestedMeetingPoint: suggested,
          meetingPoints,
          buffers,
          earliestPickupUtc: {
            hand: handPickup.toISOString(),
            checked: checkedPickup.toISOString(),
          },
          // Scheduled bookings need a minimum lead time; if the earliest pickup
          // is too soon, the app should offer a "Now" booking instead.
          tooSoonToSchedule: {
            hand: !ScheduledBookingService.hasMinimumLeadTime(handPickup),
            checked: !ScheduledBookingService.hasMinimumLeadTime(checkedPickup),
          },
        },
      });
    }
  );

  // ─── Is this pickup at an airport with meeting points? ───
  // Uses the airport's surcharge zone, so "airport pickup" and "airport charge" always agree.
  fastify.get(
    "/flights/airport-pickup",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const q = request.query as { lat?: string; lng?: string };
      const lat = Number(q.lat);
      const lng = Number(q.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return reply
          .status(400)
          .send({ success: false, error: "lat and lng are required" });
      }
      const zones = await fastify.prisma.surchargeZone.findMany({
        where: { isActive: true, airportIata: { not: null } },
        select: {
          airportIata: true,
          latitude: true,
          longitude: true,
          radiusMeters: true,
          polygon: true,
        },
      });
      const zone = zones.find((z) => isInsideZone(lat, lng, z));
      if (!zone?.airportIata) return reply.send({ success: true, data: null });

      const meetingPoints = await fastify.prisma.airportMeetingPoint.findMany({
        where: { airportIata: zone.airportIata, isActive: true },
        select: {
          id: true,
          terminal: true,
          name: true,
          instructions: true,
          latitude: true,
          longitude: true,
        },
        orderBy: { terminal: "asc" },
      });
      if (!meetingPoints.length)
        return reply.send({ success: true, data: null });

      const names: Record<string, string> = { LGW: "Gatwick" };
      return reply.send({
        success: true,
        data: {
          airportIata: zone.airportIata,
          airportName: names[zone.airportIata] ?? zone.airportIata,
          meetingPoints,
        },
      });
    }
  );

  // ─── Dry-run the airport checks before taking card payment ───
  fastify.post(
    "/flights/validate-pickup",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const body = request.body as { scheduledAt?: string };
      const input = airportPickupSchema.parse(request.body);
      const result = await resolveAirportPickup(
        fastify.prisma,
        fastify.redis,
        input,
        body?.scheduledAt ? new Date(body.scheduledAt) : null
      );
      if (!result.ok) {
        return reply.status(result.status).send({
          success: false,
          error: result.error,
          code: result.code,
          ...result.extra,
        });
      }
      return reply.send({ success: true });
    }
  );
}
