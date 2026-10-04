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
import { getFlightBuffers } from "../utils/airportPickup";

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
function roundUpTo5Min(date: Date): Date {
  const step = 5 * 60_000;
  return new Date(Math.ceil(date.getTime() / step) * step);
}

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

      const landing = new Date(flight.scheduledArrivalUtc);
      const handPickup = roundUpTo5Min(
        new Date(landing.getTime() + buffers.hand * 60_000)
      );
      const checkedPickup = roundUpTo5Min(
        new Date(landing.getTime() + buffers.checked * 60_000)
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
}
