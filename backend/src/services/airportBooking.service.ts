// backend/src/services/airportBooking.service.ts
//
// Validates the airport-pickup part of a new passenger booking, server-side.
// The app's calculations are never trusted:
//   - meeting point must exist and be active; its address + pin replace
//     whatever pickup the app sent (so pickups land exactly at the car park)
//   - flight is re-looked-up (normally a Redis cache hit from the app's lookup)
//   - pickup time must be ≥ scheduled landing + luggage buffer
//
// All fields are optional: bookings without them (non-airport pickups, older
// app versions) behave exactly as before.
import { PrismaClient, Prisma } from "@prisma/client";
import Redis from "ioredis";
import { z } from "zod";
import { FlightDataService, normaliseFlightNumber } from "./flightData.service";
import {
  getFlightBuffers,
  earliestPickupAfterLanding,
} from "../utils/airportPickup";
import { interpretFlight } from "./flightRules";

export const airportPickupSchema = z.object({
  meetingPointId: z.string().uuid().optional(),
  flightNumber: z.string().trim().max(12).optional(),
  flightDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(), // arrival date, UK local
  luggageType: z.enum(["HAND", "CHECKED"]).optional(),
});
export type AirportPickupInput = z.infer<typeof airportPickupSchema>;

type Failure = {
  ok: false;
  status: number;
  code: string;
  error: string;
  extra?: Record<string, unknown>;
};
type Success = {
  ok: true;
  pickup: { address: string; latitude: number; longitude: number } | null; // null = keep the app's pickup
  data: {
    meetingPointId?: string;
    terminal?: string;
    flightNumber?: string;
    luggageType?: string;
    flightArrivalTime?: Date;
    flightSnapshot?: Prisma.InputJsonValue;
    flightSnapshotFetchedAt?: Date;
    pickupOffsetMinutes?: number;
    bookedPickupAt?: Date;
  };
};

const AIRPORT_NAMES: Record<string, string> = { LGW: "Gatwick" };
const TERMINAL_NAMES: Record<string, string> = {
  NORTH: "North Terminal",
  SOUTH: "South Terminal",
};

const fail = (
  status: number,
  code: string,
  error: string,
  extra?: Record<string, unknown>
): Failure => ({ ok: false, status, code, error, extra });

export async function resolveAirportPickup(
  prisma: PrismaClient,
  redis: Redis,
  input: AirportPickupInput,
  scheduledAt: Date | null
): Promise<Failure | Success> {
  if (!input.meetingPointId && !input.flightNumber)
    return { ok: true, pickup: null, data: {} };

  if (!input.meetingPointId)
    return fail(
      400,
      "terminal_required",
      "Please confirm which terminal you're arriving at."
    );

  const mp = await prisma.airportMeetingPoint.findFirst({
    where: { id: input.meetingPointId, isActive: true },
  });
  if (!mp)
    return fail(
      400,
      "invalid_meeting_point",
      "That meeting point is no longer available. Please choose your terminal again."
    );

  const airportName = AIRPORT_NAMES[mp.airportIata] ?? mp.airportIata;
  const pickup = {
    address: `${airportName} ${TERMINAL_NAMES[mp.terminal] ?? mp.terminal}: ${
      mp.name
    }`,
    latitude: mp.latitude,
    longitude: mp.longitude,
  };
  const data: Success["data"] = {
    meetingPointId: mp.id,
    terminal: mp.terminal,
  };

  // Meeting point only (e.g. "Now" booking at the airport) — no flight checks.
  if (!input.flightNumber) return { ok: true, pickup, data };

  if (!scheduledAt)
    return fail(
      400,
      "flight_requires_schedule",
      "Flight details can only be added to scheduled pickups."
    );
  if (!input.flightDate || !input.luggageType)
    return fail(
      400,
      "invalid_input",
      "Flight date and luggage type are required."
    );

  const number = normaliseFlightNumber(input.flightNumber);
  if (!number)
    return fail(400, "invalid_input", "Please check the flight number.");

  const lookup = await new FlightDataService(redis).lookupArrival(
    number,
    input.flightDate,
    mp.airportIata
  );
  if (!lookup.ok) {
    if (lookup.reason === "provider_error" || lookup.reason === "daily_limit") {
      return fail(
        503,
        "flight_unverified",
        "We couldn't check your flight just now. Please try again, or book without flight details."
      );
    }
    return fail(
      400,
      lookup.reason,
      `We couldn't find ${number} arriving at ${airportName} on that date. Please check the details.`
    );
  }

  const flight = lookup.flight;
  const buffers = await getFlightBuffers(prisma);
  // Same gate-arrival rule as the lookup and Phase 2 (no double-counting of delays).
  const interp = interpretFlight(flight);
  if (interp.phase !== "SCHEDULED") {
    const msg =
      interp.phase === "CANCELLED"
        ? "This flight has been cancelled. Please check with your airline."
        : interp.phase === "DIVERTED"
        ? "This flight has been diverted. Please check with your airline."
        : 'This flight has already landed. If you\'re at Gatwick, book with "Now".';
    return fail(409, `flight_${interp.phase.toLowerCase()}`, msg);
  }
  const expectedArrival = interp.gateArrival;
  const earliest = earliestPickupAfterLanding(
    expectedArrival.toISOString(),
    buffers,
    input.luggageType
  );

  // 1-minute tolerance for clock/rounding differences between app and server.
  if (scheduledAt.getTime() < earliest.getTime() - 60_000) {
    return fail(
      400,
      "pickup_too_early",
      "That pickup time is earlier than your flight allows. Please choose a later time.",
      { earliestPickupUtc: earliest.toISOString() }
    );
  }

  return {
    ok: true,
    pickup,
    data: {
      ...data,
      flightNumber: number, // passenger's own input (normalised) — kept permanently
      luggageType: input.luggageType,
      // Ours: passenger's minutes after the scheduled gate arrival, and the agreed pickup.

      pickupOffsetMinutes: Math.round(
        (scheduledAt.getTime() - expectedArrival.getTime()) / 60_000
      ),
      bookedPickupAt: scheduledAt,
      // Provider data below is a snapshot: refreshed or deleted by the daily job within 6 days.
      flightArrivalTime: new Date(flight.scheduledArrivalUtc),
      flightSnapshot: flight as unknown as Prisma.InputJsonValue,
      flightSnapshotFetchedAt: new Date(flight.fetchedAt),
    },
  };
}
