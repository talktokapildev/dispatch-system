// backend/src/services/flightRules.ts
//
// Phase 2 timing rules — PURE logic (no database, no I/O) so every scenario
// can be replayed and tested in isolation.
//
//   Gate arrival   = actual gate arrival if known, else latest estimate
//   Ideal pickup   = gate arrival + passenger's offset, to the minute
//   Later          = always applied automatically
//   Earlier        = applied automatically, but never more than 15 min
//                    earlier than the booked (agreed) time; beyond that the
//                    driver/admin confirms (EARLIER_CONFIRMED moves the booked time)
//   Milestones     = RUNNING_LATE / RUNNING_EARLY (15+ min vs booked, once),
//                    ARRIVED, CANCELLED, DIVERTED (once each)

export const EARLY_LIMIT_MIN = 15; // max automatic move earlier vs booked time
export const MESSAGE_THRESHOLD_MIN = 15; // running late/early message threshold
export const TAXI_MIN = 7; // touchdown → gate when only touchdown is known

export type FlightPhase = "SCHEDULED" | "ARRIVED" | "CANCELLED" | "DIVERTED";
export type FlightEventType =
  | "RUNNING_LATE"
  | "RUNNING_EARLY"
  | "EARLIER_CONFIRMED"
  | "ARRIVED"
  | "CANCELLED"
  | "DIVERTED"
  | "UNVERIFIED";

export type FlightFacts = {
  status: string | null;
  scheduledArrivalUtc: string;
  revisedArrivalUtc: string | null; // airline/airport estimate or actual gate time
  predictedArrivalUtc: string | null; // provider's model estimate
  runwayArrivalUtc: string | null; // actual touchdown
  departureScheduledUtc?: string | null;
  departureRevisedUtc?: string | null; // estimated (or actual) off-block at origin
  departureRunwayUtc?: string | null; // actual take-off
};

export type Interpretation = {
  phase: FlightPhase;
  gateArrival: Date;
  landedAt: Date | null;
};

const MIN = 60_000;
const toDate = (s: string | null | undefined) => (s ? new Date(s) : null);
const floorMinute = (d: Date) => new Date(Math.floor(d.getTime() / MIN) * MIN);
const ceilMinute = (d: Date) => new Date(Math.ceil(d.getTime() / MIN) * MIN);

/** Turn provider data into our view: phase + best gate-arrival time. */
export function interpretFlight(f: FlightFacts): Interpretation {
  const status = (f.status ?? "").toLowerCase();
  const scheduled = new Date(f.scheduledArrivalUtc);
  const revised = toDate(f.revisedArrivalUtc);
  const predicted = toDate(f.predictedArrivalUtc);
  const runway = toDate(f.runwayArrivalUtc);
  const runwayPlusTaxi = runway
    ? new Date(runway.getTime() + TAXI_MIN * MIN)
    : null;

  if (status === "canceled" || status === "cancelled")
    return {
      phase: "CANCELLED",
      gateArrival: revised ?? scheduled,
      landedAt: null,
    };
  if (status === "diverted")
    return {
      phase: "DIVERTED",
      gateArrival: revised ?? scheduled,
      landedAt: null,
    };
  if (status === "arrived")
    return {
      phase: "ARRIVED",
      gateArrival: revised ?? runwayPlusTaxi ?? scheduled,
      landedAt: runway ?? revised ?? scheduled,
    };
  if (status === "landed" || runway)
    return {
      phase: "ARRIVED",
      gateArrival: runwayPlusTaxi ?? revised ?? scheduled,
      landedAt: runway ?? revised ?? scheduled,
    };

  // Flight time from the timetable (used to project arrival from departure).
  const depScheduled = toDate(f.departureScheduledUtc);
  const flightMs =
    depScheduled && scheduled > depScheduled
      ? scheduled.getTime() - depScheduled.getTime()
      : null;
  const depActual = toDate(f.departureRunwayUtc);
  const departed =
    !!depActual || ["departed", "enroute", "approaching"].includes(status);

  if (departed) {
    // In the air: arrival estimates come from live tracking — trust them.
    const projected =
      depActual && flightMs ? new Date(depActual.getTime() + flightMs) : null;
    return {
      phase: "SCHEDULED",
      gateArrival: revised ?? predicted ?? projected ?? scheduled,
      landedAt: null,
    };
  }

  // Not departed yet: arrival estimates can be stale (e.g. "revised" earlier
  // than schedule while the plane is still on the ground). The plane can't
  // arrive before its expected departure + flight time, so take the LATEST
  // of all estimates. Errs late, which is safe: later moves are automatic and
  // the estimate tightens once the flight departs.
  const depExpected = toDate(f.departureRevisedUtc) ?? depScheduled;
  const projected =
    depExpected && flightMs ? new Date(depExpected.getTime() + flightMs) : null;
  const candidates = [scheduled, revised, predicted, projected].filter(
    (d): d is Date => !!d
  );
  const latest = new Date(Math.max(...candidates.map((d) => d.getTime())));
  return { phase: "SCHEDULED", gateArrival: latest, landedAt: null };
}

export type BookingFacts = {
  bookedPickupAt: Date; // agreed time (booking, or later confirmed)
  pickupOffsetMinutes: number; // passenger's minutes after gate arrival
  currentPickupAt: Date; // what everyone sees now
  firedEvents: Set<string>; // milestones already recorded for this booking
  tripStarted: boolean; // driver arrived / trip started / finished → don't touch
};

export type PlannedEvent = {
  type: FlightEventType;
  oldPickupAt: Date;
  newPickupAt: Date;
};

export type Decision = {
  interpretation: Interpretation;
  idealPickupAt: Date; // gate arrival + offset (may be earlier than allowed)
  newPickupAt: Date | null; // null = unchanged
  events: PlannedEvent[];
  earlyBeyondLimit: boolean; // ideal is >15 min before booked → driver could confirm earlier
};

export function decide(b: BookingFacts, f: FlightFacts, now: Date): Decision {
  const interpretation = interpretFlight(f);
  const idealPickupAt = floorMinute(
    new Date(interpretation.gateArrival.getTime() + b.pickupOffsetMinutes * MIN)
  );
  const booked = b.bookedPickupAt;
  const empty: Decision = {
    interpretation,
    idealPickupAt,
    newPickupAt: null,
    events: [],
    earlyBeyondLimit: false,
  };

  if (b.tripStarted) return empty;

  // Cancelled / diverted: time unchanged, milestone once.
  if (
    interpretation.phase === "CANCELLED" ||
    interpretation.phase === "DIVERTED"
  ) {
    const type = interpretation.phase;
    return b.firedEvents.has(type)
      ? empty
      : {
          ...empty,
          events: [
            {
              type,
              oldPickupAt: b.currentPickupAt,
              newPickupAt: b.currentPickupAt,
            },
          ],
        };
  }

  // Target time: later always; earlier capped at EARLY_LIMIT_MIN before booked.
  const earliestAllowed = new Date(booked.getTime() - EARLY_LIMIT_MIN * MIN);
  let target =
    idealPickupAt >= booked
      ? idealPickupAt
      : idealPickupAt < earliestAllowed
      ? earliestAllowed
      : idealPickupAt;

  // Never move into the past (e.g. data arrives late): keep current if it's
  // already past, otherwise no earlier than now.
  if (target < now)
    target = b.currentPickupAt < now ? b.currentPickupAt : ceilMinute(now);

  const changed =
    Math.abs(target.getTime() - b.currentPickupAt.getTime()) >= MIN;
  const newPickupAt = changed ? target : null;
  const effective = newPickupAt ?? b.currentPickupAt;
  const earlyBeyondLimit = idealPickupAt < earliestAllowed;

  const events: PlannedEvent[] = [];
  if (interpretation.phase === "ARRIVED") {
    // Arrival message carries the final time — no separate late/early message.
    if (!b.firedEvents.has("ARRIVED"))
      events.push({
        type: "ARRIVED",
        oldPickupAt: b.currentPickupAt,
        newPickupAt: effective,
      });
  } else if (b.currentPickupAt > now) {
    // Late/early heads-ups only make sense before the pickup time.
    const lateBy = (idealPickupAt.getTime() - booked.getTime()) / MIN;
    if (lateBy >= MESSAGE_THRESHOLD_MIN && !b.firedEvents.has("RUNNING_LATE")) {
      events.push({
        type: "RUNNING_LATE",
        oldPickupAt: b.currentPickupAt,
        newPickupAt: effective,
      });
    } else if (
      -lateBy >= MESSAGE_THRESHOLD_MIN &&
      !b.firedEvents.has("RUNNING_EARLY")
    ) {
      events.push({
        type: "RUNNING_EARLY",
        oldPickupAt: b.currentPickupAt,
        newPickupAt: effective,
      });
    }
  }

  return {
    interpretation,
    idealPickupAt,
    newPickupAt,
    events,
    earlyBeyondLimit,
  };
}
