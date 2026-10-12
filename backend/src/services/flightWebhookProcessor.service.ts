// backend/src/services/flightWebhookProcessor.service.ts
//
// Step 5b: apply AeroDataBox Flight Alert notifications to bookings.
// Called by the web-hook route AFTER it has replied 200, so a slow lock or
// database never keeps the provider waiting. Never throws.
//
//   1. Find open watches by SUBSCRIPTION ID (exact — no flight-number
//      matching, so "U2 8004" vs "EZY8004" never matters).
//   2. For each watch, pick the leg landing at its airport on its SCHEDULED
//      London date (one subscription covers every date the number flies) —
//      the same date rule attachBookings uses to set arrivalDate.
//   3. FLIGHT_WEBHOOKS_APPLY=true → applyFlightUpdate, the same path as
//      polling (lock, stale-data check, send-once). Its lastCheckedAt update
//      makes polling back off while notifications arrive.
//      Otherwise SHADOW: log what the rules make of the data and change
//      nothing — polling stays the only writer.
//   4. A notification no open watch needs → delete its subscription now
//      (each notification costs a credit).
//   5. Record the outcome on the stored event, then check the credit balance.
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { parseArrivalLegs } from "./flightData.service";
import { applyFlightUpdate } from "./flightUpdate.service";
import { interpretFlight } from "./flightRules";
import { ukTime } from "./flightMessages";
import { deleteSubscription, maybeTopUp } from "./flightAlerts.service";
import { londonDate } from "./flightWatch.service";

const LOCK_RETRY_MS = 2000; // a poll may be mid-update for the same watch
const ORPHAN_DELETE_RETRY_S = 600;

type Emitter = {
  to: (room: string) => { emit: (event: string, data: unknown) => void };
};
type Log = { warn: (msg: string) => void };

export type ProcessDeps = {
  prisma: PrismaClient;
  redis: Redis;
  log: Log;
  io?: Emitter;
};

export const applyEnabled = () => process.env.FLIGHT_WEBHOOKS_APPLY === "true";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Processes one (already redacted) notification. Returns the outcome text. */
export async function processFlightNotification(
  deps: ProcessDeps,
  eventId: string | null,
  body: any
): Promise<string> {
  let outcome: string;
  try {
    outcome = await handle(deps, body);
  } catch (err) {
    outcome = `error: ${String(err)}`;
    deps.log.warn(`[FlightAlert] processing error: ${String(err)}`);
  }

  if (eventId) {
    try {
      await deps.prisma.flightWebhookEvent.update({
        where: { id: eventId },
        data: { processedAt: new Date(), outcome: outcome.slice(0, 500) },
      });
    } catch (err) {
      deps.log.warn(`[FlightAlert] could not record outcome: ${String(err)}`);
    }
  }

  const credits = body?.balance?.creditsRemaining;
  if (typeof credits === "number") await maybeTopUp(deps, credits);
  return outcome;
}

async function handle(deps: ProcessDeps, body: any): Promise<string> {
  const { prisma, redis, log, io } = deps;
  const subId =
    body?.subscription?.id != null ? String(body.subscription.id) : null;
  if (!subId) return "ignored: no subscription id";
  const flights: unknown = body?.flights;

  const watches = await prisma.flightWatch.findMany({
    where: { subscriptionId: subId, endedAt: null },
    select: {
      id: true,
      flightNumber: true,
      arrivalDate: true,
      airportIata: true,
      status: true,
      expectedGateArrivalAt: true,
    },
    orderBy: { arrivalDate: "asc" },
  });
  if (!watches.length) return releaseOrphan(deps, subId);

  const now = new Date();
  const results: string[] = [];

  for (const w of watches) {
    const tag = `${w.flightNumber} ${w.arrivalDate}`;
    // Arrived/cancelled/diverted but not ended yet (endWatches runs every 5 min).
    if (w.status !== "WATCHING") {
      results.push(`${tag}: already ${w.status}`);
      continue;
    }

    const leg = parseArrivalLegs(flights, w.airportIata).find(
      (l) => londonDate(new Date(l.scheduledArrivalUtc)) === w.arrivalDate
    );
    if (!leg) {
      results.push(`${tag}: no matching leg`);
      continue;
    }
    if (leg.status?.startsWith("Unknown(")) {
      log.warn(`[FlightAlert] unmapped status ${leg.status} for ${tag}`);
    }

    if (!applyEnabled()) {
      // Pure: no writes, no messages. Compare with the watch's current
      // estimate (from polling). Note: applyFlightUpdate also stops a
      // pre-take-off estimate going backwards; that clamp isn't shown here.
      const i = interpretFlight(leg, now);
      const line = `${tag}: shadow ${leg.status ?? "?"} -> ${
        i.phase
      } gate ${ukTime(i.gateArrival)}${
        i.landedAt ? ` landed ${ukTime(i.landedAt)}` : ""
      }${
        i.phase === "ARRIVED"
          ? leg.runwayArrivalUtc
            ? ""
            : " (no touchdown)"
          : leg.runwayArrivalUtc
          ? ` (landing forecast ${ukTime(new Date(leg.runwayArrivalUtc))})`
          : ""
      } | watch gate ${
        w.expectedGateArrivalAt ? ukTime(w.expectedGateArrivalAt) : "-"
      }`;
      log.warn(`[FlightAlert] ${line}`);
      results.push(line);
      continue;
    }

    let s = await applyFlightUpdate(prisma, redis, w.id, leg, { io });
    if (s.stale) {
      // "stale" also means "lock held by a poll" — wait once and retry.
      await sleep(LOCK_RETRY_MS);
      s = await applyFlightUpdate(prisma, redis, w.id, leg, { io });
    }
    const events = s.events.length ? `, events ${s.events.join(" ")}` : "";
    results.push(
      s.stale
        ? `${tag}: stale or locked (${leg.status ?? "?"})`
        : `${tag}: applied ${leg.status ?? "?"}, ${s.changed} changed${events}`
    );
    if (s.changed || s.events.length) {
      log.warn(`[FlightAlert] ${tag}: ${s.changed} pickup(s) changed${events}`);
    }
  }
  return results.join("; ");
}

/** No open watch uses this subscription any more → delete it now. */
async function releaseOrphan(deps: ProcessDeps, subId: string) {
  const { prisma, redis, log } = deps;
  const first = await redis.set(
    `flightalert:orphan:${subId}`,
    "1",
    "EX",
    ORPHAN_DELETE_RETRY_S,
    "NX"
  );
  if (!first) return "no open watch (delete already attempted)";

  // Re-check right before deleting.
  const inUse = await prisma.flightWatch.count({
    where: { subscriptionId: subId, endedAt: null },
  });
  if (inUse > 0) return "no open watch at first check, now in use - kept";

  const ok = await deleteSubscription(subId, log);
  // Also clear it from any watch that picked it up in the same instant:
  // ensureSubscriptions then resubscribes on the next cycle instead of a
  // watch holding a dead id.
  await prisma.flightWatch.updateMany({
    where: { subscriptionId: subId },
    data: { subscriptionId: null },
  });
  log.warn(
    `[FlightAlert] notification for ${subId} with no open watch - subscription ${
      ok ? "deleted" : "delete failed (hourly reconcile will retry)"
    }`
  );
  return ok
    ? "no open watch: subscription deleted"
    : "no open watch: delete failed";
}
