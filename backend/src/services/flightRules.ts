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
  | "UNVERIFIED"
  | "PICKUP_UPDATE";

/** LIVE = in the air / landed (tracking data, reliable); TIMETABLE = schedule only;
 *  UNCERTAIN = departure time has passed but no take-off seen (provider data unreliable). */
export type Confidence = "LIVE" | "TIMETABLE" | "UNCERTAIN";

export type FlightFacts = {
  status: string | null;
  scheduledArrivalUtc: string;
  revisedArrivalUtc: string | null; // airline/airport estimate or actual gate time (can be STALE)
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
  departed: boolean;
  confidence: Confidence;
};

const MIN = 60_000;
const TAXI_OUT_MIN = 15; // gate → take-off, used when projecting arrival from take-off
const MIN_FLIGHT_FRACTION = 0.7; // no plane arrives faster than 70% of its scheduled time
const UNCERTAIN_AFTER_MIN = 15; // departure this late with no take-off seen → uncertain
const toDate = (s: string | null | undefined) => (s ? new Date(s) : null);
const floorMinute = (d: Date) => new Date(Math.floor(d.getTime() / MIN) * MIN);
const ceilMinute = (d: Date) => new Date(Math.ceil(d.getTime() / MIN) * MIN);
const latest = (ds: (Date | null)[]) =>
  new Date(
    Math.max(...ds.filter((d): d is Date => !!d).map((d) => d.getTime()))
  );

/**
 * Turn provider data into our view: phase + best gate-arrival time.
 * Defends against stale/impossible provider times (seen live on EZY858:
 * "revised arrival" stuck at the schedule even after landing 3h late).
 */
export function interpretFlight(
  f: FlightFacts,
  now: Date = new Date()
): Interpretation {
  const status = (f.status ?? "").toLowerCase();
  const scheduled = new Date(f.scheduledArrivalUtc);
  const revised = toDate(f.revisedArrivalUtc);
  const predicted = toDate(f.predictedArrivalUtc);
  const runway = toDate(f.runwayArrivalUtc);
  const depScheduled = toDate(f.departureScheduledUtc);
  const depActual = toDate(f.departureRunwayUtc);
  const flightMs =
    depScheduled && scheduled > depScheduled
      ? scheduled.getTime() - depScheduled.getTime()
      : null;

  if (status === "canceled" || status === "cancelled")
    return {
      phase: "CANCELLED",
      gateArrival: revised ?? scheduled,
      landedAt: null,
      departed: false,
      confidence: "LIVE",
    };
  if (status === "diverted")
    return {
      phase: "DIVERTED",
      gateArrival: revised ?? scheduled,
      landedAt: null,
      departed: true,
      confidence: "LIVE",
    };

  // Landed / arrived: touchdown is the anchor. A "revised" time only counts
  // as the real gate time if it's AFTER touchdown (otherwise it's stale).
  if (status === "landed" || status === "arrived" || runway) {
    if (runway) {
      const gate =
        revised && revised > runway
          ? revised
          : new Date(runway.getTime() + TAXI_MIN * MIN);
      return {
        phase: "ARRIVED",
        gateArrival: gate,
        landedAt: runway,
        departed: true,
        confidence: "LIVE",
      };
    }
    const gate = latest([revised, predicted, scheduled]);
    return {
      phase: "ARRIVED",
      gateArrival: gate,
      landedAt: gate,
      departed: true,
      confidence: "LIVE",
    };
  }

  const departed =
    !!depActual || ["departed", "enroute", "approaching"].includes(status);

  if (departed) {
    if (depActual && flightMs) {
      // In the air: trust live estimates, but never one that's impossible
      // (earlier than take-off + 70% of the scheduled flight time).
      const minPlausible = new Date(
        depActual.getTime() + flightMs * MIN_FLIGHT_FRACTION
      );
      const plausible = (d: Date | null) => (d && d >= minPlausible ? d : null);
      const projected = new Date(
        depActual.getTime() + flightMs - TAXI_OUT_MIN * MIN
      );
      return {
        phase: "SCHEDULED",
        gateArrival: plausible(revised) ?? plausible(predicted) ?? projected,
        landedAt: null,
        departed: true,
        confidence: "LIVE",
      };
    }
    // Departed per status but no take-off time: take the latest estimate (safe).
    return {
      phase: "SCHEDULED",
      gateArrival: latest([revised, predicted, scheduled]),
      landedAt: null,
      departed: true,
      confidence: "LIVE",
    };
  }

  // Not departed yet. Estimates can be stale, so:
  //  - the plane can't leave before NOW (time floor), and
  //  - can't arrive before its expected departure + flight time,
  // so take the LATEST credible estimate. Errs late (safe); tightens at take-off.
  const depExpected = toDate(f.departureRevisedUtc) ?? depScheduled;
  const depFloor = depExpected ? latest([depExpected, now]) : null;
  const projected =
    depFloor && flightMs ? new Date(depFloor.getTime() + flightMs) : null;
  const uncertain =
    !!depExpected &&
    now.getTime() - depExpected.getTime() > UNCERTAIN_AFTER_MIN * MIN;
  return {
    phase: "SCHEDULED",
    gateArrival: latest([scheduled, revised, predicted, projected]),
    landedAt: null,
    departed: false,
    confidence: uncertain ? "UNCERTAIN" : "TIMETABLE",
  };
}

export type BookingFacts = {
  bookedPickupAt: Date; // agreed time (booking, or later confirmed)
  lastToldPickupAt?: Date | null; // last pickup time we told anyone (caps automatic earlier moves)
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

export function decide(
  b: BookingFacts,
  f: FlightFacts,
  now: Date,
  interpretationOverride?: Interpretation
): Decision {
  const interpretation = interpretationOverride ?? interpretFlight(f, now);
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
  // Earlier moves: at most 15 min below the last time we told anyone (driver
  // or passenger) — falls back to the booked time if nothing was sent yet.
  const reference = b.lastToldPickupAt ?? booked;
  const earliestAllowed = new Date(reference.getTime() - EARLY_LIMIT_MIN * MIN);
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
