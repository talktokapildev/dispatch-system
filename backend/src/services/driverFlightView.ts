// backend/src/services/driverFlightView.ts
//
// Phase 2b — the compact flight summary the DRIVER app shows (job card chip,
// job detail panel, one line on the active trip). Pure: built from what's
// already stored (booking snapshot, watch, events). No provider calls.
//
// Driver-facing text is plain and short; times are UK "HH:MM" strings built
// on the app side from the ISO times here (the app formats in UK time).
import { BookingStatus } from "@prisma/client";
import { earliestPickupAt } from "./flightUpdate.service";
import { ukTime } from "./flightMessages";

const MIN = 60_000;
const LATE_MIN = 15; // gate this much after scheduled landing → "late" tone

export type DriverFlightState =
  | "SCHEDULED" // not tracked yet (> 24h out)
  | "TRACKING"
  | "LANDED"
  | "CANCELLED"
  | "DIVERTED"
  | "UNVERIFIED"
  | "ENDED";

export type DriverFlightView = {
  flightNumber: string;
  airline: string | null;
  origin: string | null;
  state: DriverFlightState;
  /** Short label for chips, e.g. "Tracking · gate ~16:20", "Landed 15:58". */
  chip: string;
  tone: "neutral" | "info" | "late" | "good" | "bad";
  scheduledLandingAt: string | null;
  takeOffAt: string | null; // actual take-off, once airborne
  gateAt: string | null; // our gate estimate (or actual)
  gateIsActual: boolean;
  offsetMinutes: number | null;
  pickupAt: string | null; // current pickup
  bookedPickupAt: string | null; // the agreed time (differs → it moved)
  lastCheckedAt: string | null;
  flightAwareUrl: string;
  earlierPickup: { earliestAt: string } | null;
  /** Weeks-ahead airline change (step 6b), shown until tracking starts. */
  scheduleNotice: { type: string; text: string; at: string } | null;
};

type Snap = {
  airlineName?: string | null;
  originName?: string | null;
  originIata?: string | null;
  scheduledArrivalUtc?: string | null;
  runwayArrivalUtc?: string | null;
  departureRunwayUtc?: string | null;
};

export type DriverFlightInput = {
  id: string;
  status: BookingStatus | string;
  flightNumber: string | null;
  scheduledAt: Date | null;
  bookedPickupAt: Date | null;
  pickupOffsetMinutes: number | null;
  flightArrivalTime: Date | null;
  flightSnapshot: unknown;
  flightWatch: {
    status: string;
    expectedGateArrivalAt: Date | null;
    actualGateArrivalAt: Date | null;
    lastCheckedAt: Date | null;
    unverified: boolean;
  } | null;
  flightEvents: { type: string; note: string | null; createdAt: Date }[];
};

/** Prisma select that provides everything buildDriverFlightView needs. */
export const driverFlightSelect = {
  id: true,
  status: true,
  flightNumber: true,
  scheduledAt: true,
  bookedPickupAt: true,
  pickupOffsetMinutes: true,
  flightArrivalTime: true,
  flightSnapshot: true,
  flightWatch: {
    select: {
      status: true,
      expectedGateArrivalAt: true,
      actualGateArrivalAt: true,
      lastCheckedAt: true,
      unverified: true,
    },
  },
  flightEvents: {
    select: { type: true, note: true, createdAt: true },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

const iso = (d: Date | string | null | undefined) =>
  d ? new Date(d).toISOString() : null;

const SCHEDULE_TEXT: Record<string, (note: string | null) => string> = {
  SCHEDULE_CHANGE: (note) =>
    `Airline changed the schedule: ${
      (note ?? "").replace(/^Scheduled landing /, "lands ").replace(/ Pickup not changed\.$/, "") ||
      "new landing time"
    }`,
  SCHEDULE_CANCELLED: () => "Airline schedule shows this flight CANCELLED",
  SCHEDULE_NOT_FOUND: () =>
    "Flight not found on this date - it may have been retimed",
};

export function buildDriverFlightView(
  b: DriverFlightInput,
  now: Date = new Date()
): DriverFlightView | null {
  if (!b.flightNumber) return null;
  const snap = (b.flightSnapshot ?? null) as Snap | null;
  const w = b.flightWatch;

  const scheduled =
    b.flightArrivalTime ??
    (snap?.scheduledArrivalUtc ? new Date(snap.scheduledArrivalUtc) : null);
  const gate = w ? w.actualGateArrivalAt ?? w.expectedGateArrivalAt : null;
  const takeOff =
    snap?.departureRunwayUtc && new Date(snap.departureRunwayUtc) <= now
      ? new Date(snap.departureRunwayUtc)
      : null;

  let state: DriverFlightState = "SCHEDULED";
  let chip: string;
  let tone: DriverFlightView["tone"] = "neutral";

  if (!w) {
    state = "SCHEDULED";
    chip = scheduled ? `Lands ${ukTime(scheduled)}` : "Not tracked yet";
  } else if (w.status === "CANCELLED" || w.status === "DIVERTED") {
    state = w.status;
    chip = w.status === "CANCELLED" ? "Flight cancelled" : "Flight diverted";
    tone = "bad";
  } else if (w.status === "ARRIVED") {
    state = "LANDED";
    const touchdown =
      snap?.runwayArrivalUtc && new Date(snap.runwayArrivalUtc) <= now
        ? new Date(snap.runwayArrivalUtc)
        : null;
    chip = touchdown
      ? `Landed ${ukTime(touchdown)}`
      : gate
      ? `Arrived ${ukTime(gate)}`
      : "Landed";
    tone = "good";
  } else if (w.unverified) {
    state = "UNVERIFIED";
    chip = gate ? `Unconfirmed · gate ~${ukTime(gate)}` : "Unconfirmed";
    tone = "late";
  } else if (w.status === "WATCHING") {
    state = "TRACKING";
    chip = gate ? `Tracking · gate ~${ukTime(gate)}` : "Tracking";
    tone =
      gate && scheduled && gate.getTime() - scheduled.getTime() >= LATE_MIN * MIN
        ? "late"
        : "info";
  } else {
    state = "ENDED";
    chip = "Tracking ended";
  }

  // Weeks-ahead schedule notices (6b): only before tracking starts — once the
  // flight is tracked, the live status above supersedes them.
  let scheduleNotice: DriverFlightView["scheduleNotice"] = null;
  if (!w) {
    const last = [...b.flightEvents]
      .reverse()
      .find((e) => e.type in SCHEDULE_TEXT);
    if (last) {
      scheduleNotice = {
        type: last.type,
        text: SCHEDULE_TEXT[last.type](last.note),
        at: last.createdAt.toISOString(),
      };
      if (last.type !== "SCHEDULE_CHANGE") tone = "bad";
      else if (tone === "neutral") tone = "late";
    }
  }

  const earliest = w
    ? earliestPickupAt(
        {
          status: b.status,
          scheduledAt: b.scheduledAt,
          pickupOffsetMinutes: b.pickupOffsetMinutes,
        },
        w,
        now
      )
    : null;

  return {
    flightNumber: b.flightNumber,
    airline: snap?.airlineName ?? null,
    origin: snap?.originName ?? snap?.originIata ?? null,
    state,
    chip,
    tone,
    scheduledLandingAt: iso(scheduled),
    takeOffAt: iso(takeOff),
    gateAt: iso(gate),
    gateIsActual: !!w?.actualGateArrivalAt,
    offsetMinutes: b.pickupOffsetMinutes,
    pickupAt: iso(b.scheduledAt),
    bookedPickupAt: iso(b.bookedPickupAt),
    lastCheckedAt: iso(w?.lastCheckedAt),
    flightAwareUrl: `https://www.flightaware.com/live/flight/${encodeURIComponent(
      b.flightNumber
    )}`,
    earlierPickup: earliest ? { earliestAt: earliest.toISOString() } : null,
    scheduleNotice,
  };
}
