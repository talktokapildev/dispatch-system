// backend/src/services/flightWatch.service.ts
//
// Runs inside the existing 5-minute cleanup loop. Each cycle:
//   1. ATTACH   flight bookings arriving within 24h to a shared watch
//               (one watch per flight number + arrival date)
//   2. CHECK    watched flights with the safety-net schedule:
//                 first lookup as soon as the watch starts
//                 3h → 1h before arrival : every 30 min
//                 last hour              : every 10 min
//                 after expected arrival : every 5 min (until arrived, max 2h)
//               Every result goes through applyFlightUpdate (one update path).
//               "Last update" includes web-hook alerts (step 5), so lookups
//               only happen when alerts are quiet.
//   3. FLAG     "unverified" when there's no fresh data within 30 min of arrival
//   4. END      watches that arrived / were cancelled / diverted / have no
//               active bookings / are 2h past arrival with no arrival data
//   5. RETAIN   clear provider-derived times on watches ended 6+ days ago
//
// Disabled unless FLIGHT_TRACKING_ENABLED=true (safe deploy switch).
import { PrismaClient, BookingStatus } from "@prisma/client";
import Redis from "ioredis";
import { FlightDataService } from "./flightData.service";
import { applyFlightUpdate } from "./flightUpdate.service";

const MIN = 60_000;
const ATTACH_WINDOW_MIN = 24 * 60;
const MAX_LOOKUPS_PER_CYCLE = 20;
const LOOKUP_SPACING_MS = 600; // AeroDataBox Pro: 2 requests/second
const UNVERIFIED_WITHIN_MIN = 30;
const GIVE_UP_AFTER_MIN = 120;
const RETENTION_DAYS = 6;

const FINISHED: BookingStatus[] = [
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
  BookingStatus.NO_SHOW,
];

type Emitter = {
  to: (room: string) => { emit: (event: string, data: unknown) => void };
};
type Log = {
  warn: (msg: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export type CycleDeps = {
  prisma: PrismaClient;
  redis: Redis;
  log: Log;
  io?: Emitter;
  now?: Date;
};

/** London calendar date (YYYY-MM-DD) of a moment. */
function londonDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(
    d
  );
}

/** Minutes between successive lookups, by time to expected arrival. null = don't look up yet. */
function lookupIntervalMin(minutesToArrival: number): number | null {
  if (minutesToArrival > 180) return null;
  if (minutesToArrival > 60) return 30;
  if (minutesToArrival > 0) return 10;
  return 5;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runFlightWatchCycle(deps: CycleDeps): Promise<void> {
  if (process.env.FLIGHT_TRACKING_ENABLED !== "true") return;
  const { prisma, redis, log } = deps;
  const now = deps.now ?? new Date();

  // One cycle at a time, even across overlapping timers/instances.
  const lock = await redis.set("flightwatch:cycle", "1", "EX", 240, "NX");
  if (!lock) return;

  try {
    await attachBookings(prisma, log, now);
    await checkWatches(deps, now);
    await flagUnverified(prisma, log, now);
    await endWatches(prisma, log, now);
    await clearOldWatchData(prisma, now);
  } finally {
    await redis.del("flightwatch:cycle");
  }
}

// ── 1. Attach ────────────────────────────────────────────────────────────────
async function attachBookings(prisma: PrismaClient, log: Log, now: Date) {
  const horizon = new Date(now.getTime() + (ATTACH_WINDOW_MIN + 180) * MIN); // + max pickup offset
  const candidates = await prisma.booking.findMany({
    where: {
      flightWatchId: null,
      flightNumber: { not: null },
      meetingPointId: { not: null },
      pickupOffsetMinutes: { not: null },
      scheduledAt: { not: null, lte: horizon },
      status: { notIn: FINISHED },
    },
    select: {
      id: true,
      reference: true,
      flightNumber: true,
      scheduledAt: true,
      pickupOffsetMinutes: true,
      flightArrivalTime: true,
      meetingPoint: { select: { airportIata: true } },
    },
  });

  for (const b of candidates) {
    // Scheduled gate arrival: from the snapshot if still there, else pickup − offset (ours, permanent).
    // Expected gate arrival = current pickup − passenger's offset (ours, permanent,
    // already includes any delay known at booking). Using the SCHEDULED time here
    // skipped flights booked when already 2h+ late (scheduled time "in the past").
    const arrival = new Date(
      b.scheduledAt!.getTime() - b.pickupOffsetMinutes! * MIN
    );
    // The provider looks flights up by SCHEDULED arrival date: use the snapshot's
    // scheduled time while we have it, else the expected date (differs only for a
    // late-evening flight delayed past midnight; step 6 keeps the snapshot fresh).
    const providerDate = londonDate(b.flightArrivalTime ?? arrival);
    const minutesToArrival = (arrival.getTime() - now.getTime()) / MIN;
    if (
      minutesToArrival > ATTACH_WINDOW_MIN ||
      minutesToArrival < -GIVE_UP_AFTER_MIN
    )
      continue;

    const airportIata = b.meetingPoint?.airportIata ?? "LGW";
    const watch = await prisma.flightWatch.upsert({
      where: {
        flightNumber_arrivalDate_airportIata: {
          flightNumber: b.flightNumber!,
          arrivalDate: providerDate,
          airportIata,
        },
      },
      update: {},
      create: {
        flightNumber: b.flightNumber!,
        arrivalDate: londonDate(arrival),
        airportIata,
        expectedGateArrivalAt: arrival,
      },
    });
    await prisma.booking.update({
      where: { id: b.id },
      data: { flightWatchId: watch.id },
    });
    log.warn(
      `[FlightWatch] ${b.reference} watching ${watch.flightNumber} ${watch.arrivalDate}`
    );
  }
}

// ── 2. Safety-net lookups ────────────────────────────────────────────────────
async function checkWatches(deps: CycleDeps, now: Date) {
  const { prisma, redis, log, io } = deps;
  const watches = await prisma.flightWatch.findMany({
    where: {
      status: "WATCHING",
      bookings: { some: { status: { notIn: FINISHED } } },
    },
  });
  const flights = new FlightDataService(redis);
  let lookups = 0;

  for (const w of watches) {
    if (lookups >= MAX_LOOKUPS_PER_CYCLE) break;
    const expected = w.expectedGateArrivalAt ?? now;
    const minutesToArrival = (expected.getTime() - now.getTime()) / MIN;
    if (minutesToArrival < -GIVE_UP_AFTER_MIN) continue; // endWatches handles it

    const interval = w.lastCheckedAt ? lookupIntervalMin(minutesToArrival) : 0; // first lookup immediately
    if (interval === null) continue;
    const sinceLastMin = w.lastCheckedAt
      ? (now.getTime() - w.lastCheckedAt.getTime()) / MIN
      : Infinity;
    if (sinceLastMin < interval) continue;

    // Don't retry a failing lookup every cycle: one attempt per interval.
    const attemptKey = `flightwatch:attempt:${w.id}`;
    const fresh = await redis.set(
      attemptKey,
      "1",
      "EX",
      Math.max(4, interval || 4) * 60 - 30,
      "NX"
    );
    if (!fresh) continue;

    if (lookups > 0) await sleep(LOOKUP_SPACING_MS);
    lookups++;
    const result = await flights.lookupArrival(
      w.flightNumber,
      w.arrivalDate,
      w.airportIata,
      { fresh: true }
    );
    if (!result.ok) {
      log.warn(
        `[FlightWatch] lookup ${w.flightNumber} ${w.arrivalDate} failed: ${result.reason}`
      );
      continue;
    }
    const s = await applyFlightUpdate(prisma, redis, w.id, result.flight, {
      now,
      io,
    });
    if (s.changed || s.events.length) {
      log.warn(
        `[FlightWatch] ${w.flightNumber}: ${s.changed} pickup(s) changed${
          s.events.length ? `, events ${s.events.join(", ")}` : ""
        }`
      );
    }
  }
}

// ── 3. Unverified ────────────────────────────────────────────────────────────
async function flagUnverified(prisma: PrismaClient, log: Log, now: Date) {
  const soon = new Date(now.getTime() + UNVERIFIED_WITHIN_MIN * MIN);
  const staleBefore = new Date(now.getTime() - UNVERIFIED_WITHIN_MIN * MIN);
  const watches = await prisma.flightWatch.findMany({
    where: {
      status: "WATCHING",
      unverified: false,
      expectedGateArrivalAt: { lte: soon },
      OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: staleBefore } }],
    },
    include: {
      bookings: {
        where: { status: { notIn: FINISHED } },
        select: { id: true, scheduledAt: true },
      },
    },
  });

  for (const w of watches) {
    await prisma.flightWatch.update({
      where: { id: w.id },
      data: { unverified: true },
    });
    for (const b of w.bookings) {
      await prisma.bookingFlightEvent.create({
        data: {
          bookingId: b.id,
          type: "UNVERIFIED",
          oldPickupAt: b.scheduledAt,
          newPickupAt: b.scheduledAt,
          note: "No fresh flight data near arrival — check Gatwick arrivals or call the passenger",
        },
      });
    }
    log.warn(
      `[FlightWatch] ${w.flightNumber} ${w.arrivalDate} UNVERIFIED (no fresh data near arrival)`
    );
  }
}

// ── 4. End watches ───────────────────────────────────────────────────────────
async function endWatches(prisma: PrismaClient, log: Log, now: Date) {
  const giveUpBefore = new Date(now.getTime() - GIVE_UP_AFTER_MIN * MIN);
  const open = await prisma.flightWatch.findMany({
    where: { endedAt: null },
    include: {
      bookings: {
        where: { status: { notIn: FINISHED } },
        select: { id: true },
      },
    },
  });

  for (const w of open) {
    const finishedFlight =
      w.status === "ARRIVED" ||
      w.status === "CANCELLED" ||
      w.status === "DIVERTED";
    const noBookings = w.bookings.length === 0;
    const overdue =
      w.status === "WATCHING" &&
      w.expectedGateArrivalAt != null &&
      w.expectedGateArrivalAt < giveUpBefore;
    if (!finishedFlight && !noBookings && !overdue) continue;

    await prisma.flightWatch.update({
      where: { id: w.id },
      data: {
        endedAt: now,
        ...(w.status === "WATCHING" && { status: "ENDED" }),
        ...(overdue && { unverified: true }),
      },
    });
    // Step 5 adds: delete the AeroDataBox alert subscription here.
    log.warn(
      `[FlightWatch] ended ${w.flightNumber} ${w.arrivalDate} (${
        finishedFlight
          ? w.status
          : noBookings
          ? "no active bookings"
          : "overdue, no arrival data"
      })`
    );
  }
}

// ── 5. Retention ─────────────────────────────────────────────────────────────
async function clearOldWatchData(prisma: PrismaClient, now: Date) {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * MIN);
  await prisma.flightWatch.updateMany({
    where: {
      endedAt: { lt: cutoff },
      OR: [
        { expectedGateArrivalAt: { not: null } },
        { actualGateArrivalAt: { not: null } },
        { providerUpdatedAt: { not: null } },
      ],
    },
    data: {
      expectedGateArrivalAt: null,
      actualGateArrivalAt: null,
      providerUpdatedAt: null,
    },
  });
}
