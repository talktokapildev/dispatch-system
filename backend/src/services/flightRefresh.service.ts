// backend/src/services/flightRefresh.service.ts
//
// Step 6b — keep provider data on FUTURE flight bookings fresh, and tell the
// admin (only) when the airline changes the schedule weeks ahead.
//
// Runs at the start of each 5-min flight-watch cycle (before ATTACH):
//   candidates  bookings with a flight, not yet attached to a watch, whose
//               expected arrival is > 24h away, and whose snapshot is
//               missing or older than 5 days
//   lookup      by flight number + SCHEDULED London date (flightArrivalTime),
//               max 10 per cycle, one lookup per flight/date per cycle,
//               skipped while AeroDataBox units remaining < 1,500
//   result      snapshot + flightArrivalTime replaced (fresh for 5 more days).
//               Pickup time is NEVER changed here, and passenger/driver get
//               nothing. Compared with the previous snapshot:
//                 scheduled arrival moved >= 15 min → SCHEDULE_CHANGE
//                 status cancelled                  → SCHEDULE_CANCELLED (once)
//                 not found on that date            → SCHEDULE_NOT_FOUND (once)
//               each = BookingFlightEvent (admin timeline) + admin SMS.
//
// Attempts are remembered in Redis for 5 days (1h after a provider error), so a
// booking whose snapshot is missing (e.g. not found) isn't looked up every cycle.
//
// Disabled unless FLIGHT_REFRESH_ENABLED=true (safe deploy switch).
import { PrismaClient, BookingStatus, Prisma } from "@prisma/client";
import Redis from "ioredis";
import {
  FlightDataService,
  FlightArrival,
  LookupResult,
} from "./flightData.service";
import { alertAdmin } from "./flightAlerts.service";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
export const REFRESH_AFTER_DAYS = 5;
const ATTACH_WINDOW_MIN = 24 * 60; // must match flightWatch.service
const MAX_LOOKUPS_PER_CYCLE = 10;
const CANDIDATE_BATCH = 50;
const LOOKUP_SPACING_MS = 600; // AeroDataBox Pro: 2 requests/second
export const UNITS_FLOOR = 1500;
export const SCHEDULE_CHANGE_MIN = 15;
const TRIED_TTL_S = REFRESH_AFTER_DAYS * 86_400;
const ERROR_RETRY_S = 60 * 60;

const FINISHED: BookingStatus[] = [
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
];

type Log = { warn: (msg: string) => void };

export type RefreshDeps = {
  prisma: PrismaClient;
  redis: Redis;
  log: Log;
  now?: Date;
  /** Tests inject a fake; production uses FlightDataService (fresh lookup). */
  lookup?: (
    flightNumber: string,
    date: string,
    airportIata: string
  ) => Promise<LookupResult>;
  /** Tests only: restrict to these bookings. */
  onlyBookingIds?: string[];
};

export type ScheduleEventType =
  | "SCHEDULE_CHANGE"
  | "SCHEDULE_CANCELLED"
  | "SCHEDULE_NOT_FOUND";

export type RefreshOutcome =
  | { kind: "updated"; flight: FlightArrival; event: ScheduleEventType | null; note: string | null }
  | { kind: "not_found"; event: "SCHEDULE_NOT_FOUND"; note: string }
  | { kind: "retry" }; // provider error / daily limit / invalid: try again later

// ── Pure helpers (tested in scripts/test-flight-refresh.ts) ──────────────────

export function londonDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
}

function ukHm(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** "Sat 07 Nov" (UK time). */
export function ukDay(d: Date): string {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

function isCancelled(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "canceled" || s === "cancelled";
}

/** Snapshot is due for refresh (missing, or older than 5 days). */
export function needsRefresh(fetchedAt: Date | null, now: Date): boolean {
  return !fetchedAt || now.getTime() - fetchedAt.getTime() > REFRESH_AFTER_DAYS * DAY;
}

/**
 * Compare a fresh lookup with what we stored before.
 * prevScheduled = booking.flightArrivalTime (null if the snapshot was cleared).
 */
export function compareSchedule(
  prevScheduled: Date | null,
  prevSnapshot: Partial<FlightArrival> | null,
  result: LookupResult
): RefreshOutcome {
  if (!result.ok) {
    if (result.reason === "not_found" || result.reason === "not_arriving")
      return {
        kind: "not_found",
        event: "SCHEDULE_NOT_FOUND",
        note: "Flight not found on this date (retimed or renumbered?)",
      };
    return { kind: "retry" };
  }
  const flight = result.flight;
  if (isCancelled(flight.status) && !isCancelled(prevSnapshot?.status))
    return {
      kind: "updated",
      flight,
      event: "SCHEDULE_CANCELLED",
      note: "Airline schedule shows this flight CANCELLED",
    };
  const next = new Date(flight.scheduledArrivalUtc);
  if (prevScheduled) {
    const diff = Math.round((next.getTime() - prevScheduled.getTime()) / MIN);
    if (Math.abs(diff) >= SCHEDULE_CHANGE_MIN) {
      const sameDay = londonDate(next) === londonDate(prevScheduled);
      const nextText = sameDay ? ukHm(next) : `${ukDay(next)} ${ukHm(next)}`;
      return {
        kind: "updated",
        flight,
        event: "SCHEDULE_CHANGE",
        note: `Scheduled landing ${ukHm(prevScheduled)} -> ${nextText} (${
          diff > 0 ? "+" : ""
        }${diff} min). Pickup not changed.`,
      };
    }
  }
  return { kind: "updated", flight, event: null, note: null };
}

/** Plain ASCII, single segment. */
export function adminAlertText(
  reference: string,
  flightNumber: string,
  day: string,
  event: ScheduleEventType,
  scheduledFrom?: Date | null,
  scheduledTo?: Date | null
): string {
  const head = `OrangeRide ops: ${reference} ${flightNumber} ${day}`;
  let tail: string;
  if (event === "SCHEDULE_CHANGE" && scheduledFrom && scheduledTo)
    tail = `schedule changed: lands ${ukHm(scheduledFrom)} -> ${ukHm(
      scheduledTo
    )}${
      londonDate(scheduledFrom) !== londonDate(scheduledTo)
        ? ` (${ukDay(scheduledTo)})`
        : ""
    }. Pickup NOT changed - check booking.`;
  else if (event === "SCHEDULE_CANCELLED")
    tail = "now shows CANCELLED. Pickup unchanged - contact passenger.";
  else tail = "not found on that date (retimed?). Check booking.";
  return `${head} ${tail}`.slice(0, 160);
}

// ── Cycle step ───────────────────────────────────────────────────────────────

export async function refreshFutureFlights(deps: RefreshDeps): Promise<void> {
  if (process.env.FLIGHT_REFRESH_ENABLED !== "true") return;
  const { prisma, redis, log } = deps;
  const now = deps.now ?? new Date();

  // Monthly quota guard (units seen on the last AeroDataBox response).
  const unitsRaw = await redis.get("adb:units:remaining");
  const units = unitsRaw === null ? null : Number(unitsRaw);
  if (units !== null && units < UNITS_FLOOR) {
    const day = londonDate(now);
    const first = await redis.set(`flightrefresh:lowunits:${day}`, "1", "EX", 2 * 86_400, "NX");
    if (first) {
      const text = `OrangeRide ops: future-flight refresh paused, AeroDataBox units ${units} < ${UNITS_FLOOR}.`;
      log.warn(`[FlightRefresh] ${text}`);
      await alertAdmin(log, text);
    }
    return;
  }

  const staleBefore = new Date(now.getTime() - REFRESH_AFTER_DAYS * DAY);
  const candidates = await prisma.booking.findMany({
    where: {
      ...(deps.onlyBookingIds && { id: { in: deps.onlyBookingIds } }),
      flightWatchId: null,
      flightNumber: { not: null },
      meetingPointId: { not: null },
      pickupOffsetMinutes: { not: null },
      // pickup is after arrival, so this is a cheap pre-filter; exact check below
      scheduledAt: { gt: new Date(now.getTime() + ATTACH_WINDOW_MIN * MIN) },
      status: { notIn: FINISHED },
      OR: [
        { flightSnapshotFetchedAt: null },
        { flightSnapshotFetchedAt: { lt: staleBefore } },
      ],
    },
    orderBy: { scheduledAt: "asc" },
    take: CANDIDATE_BATCH,
    select: {
      id: true,
      reference: true,
      flightNumber: true,
      scheduledAt: true,
      pickupOffsetMinutes: true,
      flightArrivalTime: true,
      flightSnapshot: true,
      flightSnapshotFetchedAt: true,
      meetingPoint: { select: { airportIata: true } },
      flightEvents: { select: { type: true } },
    },
  });

  const flights = deps.lookup
    ? null
    : new FlightDataService(redis);
  const lookup =
    deps.lookup ??
    ((n: string, d: string, a: string) =>
      flights!.lookupArrival(n, d, a, { fresh: true }));

  const perCycle = new Map<string, LookupResult>(); // one lookup per flight/date
  let lookups = 0;

  for (const b of candidates) {
    if (lookups >= MAX_LOOKUPS_PER_CYCLE) break;
    const arrival = new Date(b.scheduledAt!.getTime() - b.pickupOffsetMinutes! * MIN);
    if ((arrival.getTime() - now.getTime()) / MIN <= ATTACH_WINDOW_MIN) continue; // watch takes over
    if (!needsRefresh(b.flightSnapshotFetchedAt, now)) continue;

    const triedKey = `flightrefresh:tried:${b.id}`;
    if (await redis.get(triedKey)) continue;

    const airportIata = b.meetingPoint?.airportIata ?? "LGW";
    const date = londonDate(b.flightArrivalTime ?? arrival);
    const key = `${b.flightNumber}:${date}:${airportIata}`;
    let result = perCycle.get(key);
    if (!result) {
      if (lookups > 0) await new Promise((r) => setTimeout(r, LOOKUP_SPACING_MS));
      result = await lookup(b.flightNumber!, date, airportIata);
      perCycle.set(key, result);
      lookups++;
    }

    const prevSnapshot = (b.flightSnapshot ?? null) as Partial<FlightArrival> | null;
    const outcome = compareSchedule(b.flightArrivalTime, prevSnapshot, result);

    if (outcome.kind === "retry") {
      await redis.set(triedKey, "error", "EX", ERROR_RETRY_S);
      log.warn(
        `[FlightRefresh] ${b.reference} ${b.flightNumber} ${date}: lookup failed (${
          !result.ok ? result.reason : "?"
        }), retry in 1h`
      );
      continue;
    }
    await redis.set(triedKey, "1", "EX", TRIED_TTL_S);

    let event: ScheduleEventType | null = null;
    let note: string | null = null;
    let newScheduled: Date | null = null;

    if (outcome.kind === "updated") {
      newScheduled = new Date(outcome.flight.scheduledArrivalUtc);
      await prisma.booking.update({
        where: { id: b.id },
        data: {
          flightSnapshot: outcome.flight as unknown as Prisma.InputJsonValue,
          flightSnapshotFetchedAt: new Date(outcome.flight.fetchedAt),
          flightArrivalTime: newScheduled,
        },
      });
      event = outcome.event;
      note = outcome.note;
    } else {
      event = outcome.event;
      note = outcome.note;
    }

    // Cancelled / not found: once per booking. Schedule changes: every time it
    // moves (the snapshot was just replaced, so the same change can't repeat).
    const fired = new Set(b.flightEvents.map((e) => e.type));
    if (event && event !== "SCHEDULE_CHANGE" && fired.has(event)) event = null;

    log.warn(
      `[FlightRefresh] ${b.reference} ${b.flightNumber} ${date}: ${
        outcome.kind === "updated"
          ? `refreshed, lands ${ukHm(newScheduled!)}`
          : "not found"
      }${event ? ` → ${event}` : ""}`
    );
    if (!event) continue;

    await prisma.bookingFlightEvent.create({
      data: { bookingId: b.id, type: event, note },
    });
    await alertAdmin(
      log,
      adminAlertText(
        b.reference,
        b.flightNumber!,
        ukDay(b.flightArrivalTime ?? arrival),
        event,
        b.flightArrivalTime,
        newScheduled
      )
    );
  }
}
