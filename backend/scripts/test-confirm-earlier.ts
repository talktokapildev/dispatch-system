// backend/scripts/test-confirm-earlier.ts
//
// Rule check (pure): once an earlier pickup is CONFIRMED it is a floor — the
// rules never move below it automatically, and no "running early" text
// follows. Also checks when "Confirm earlier" is offered (5+ min gain).
//
//   node --env-file=.env -r ts-node/register scripts/test-confirm-earlier.ts
import { decide, FlightFacts } from "../src/services/flightRules";
import { earliestPickupAt } from "../src/services/flightUpdate.service";
import { ukTime } from "../src/services/flightMessages";

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`);
  if (!ok) failures++;
};
const t = (hhmm: string) => new Date(`2026-10-12T${hhmm}:00Z`); // UTC; UK = +1

// Flight now expected at gate 14:00Z (15:00 UK); passenger offset 45 → ideal 15:45 UK.
const flight: FlightFacts = {
  status: "EnRoute",
  scheduledArrivalUtc: t("14:30").toISOString(),
  revisedArrivalUtc: t("14:00").toISOString(),
  predictedArrivalUtc: null,
  runwayArrivalUtc: null,
  departureScheduledUtc: t("11:30").toISOString(),
  departureRevisedUtc: null,
  departureRunwayUtc: t("11:05").toISOString(),
};
const now = t("12:30");

// Admin confirmed 15:55 UK (driver couldn't do 15:45): booked = current = 14:55Z.
const confirmed = {
  bookedPickupAt: t("14:55"),
  lastToldPickupAt: t("14:55"),
  pickupOffsetMinutes: 45,
  currentPickupAt: t("14:55"),
  firedEvents: new Set<string>(["RUNNING_EARLY", "EARLIER_CONFIRMED"]),
  tripStarted: false,
  earlierConfirmed: true,
};
let d = decide(confirmed, flight, now);
check("confirmed time is not pulled earlier", d.newPickupAt === null, `pickup ${ukTime(d.newPickupAt ?? confirmed.currentPickupAt)}`);
check("no running-early text after confirmation", !d.events.length, d.events.map((e) => e.type).join(",") || "no events");

// Same booking WITHOUT confirmation would be auto-moved (to ≥ told − 15).
d = decide({ ...confirmed, earlierConfirmed: false, firedEvents: new Set(["RUNNING_EARLY"]) }, flight, now);
check("without confirmation: auto-moves earlier", !!d.newPickupAt && ukTime(d.newPickupAt) === "15:45", `pickup ${d.newPickupAt ? ukTime(d.newPickupAt) : "-"}`);

// A later delay still moves a confirmed pickup later.
d = decide(confirmed, { ...flight, revisedArrivalUtc: t("14:30").toISOString() }, now);
check("confirmed pickup still moves LATER", !!d.newPickupAt && ukTime(d.newPickupAt) === "16:15", `pickup ${d.newPickupAt ? ukTime(d.newPickupAt) : "-"}`);

// When is "Confirm earlier" offered?
const watch = { status: "WATCHING", expectedGateArrivalAt: t("14:00"), actualGateArrivalAt: null };
const e1 = earliestPickupAt({ status: "DRIVER_ASSIGNED", scheduledAt: t("14:55"), pickupOffsetMinutes: 45 }, watch, now);
check("offered when 10 min earlier possible: 15:45", !!e1 && ukTime(e1) === "15:45", e1 ? ukTime(e1) : "null");
const e2 = earliestPickupAt({ status: "DRIVER_ASSIGNED", scheduledAt: t("14:48"), pickupOffsetMinutes: 45 }, watch, now);
check("not offered for a 3-min gain", e2 === null, String(e2));
const e3 = earliestPickupAt({ status: "IN_PROGRESS", scheduledAt: t("14:55"), pickupOffsetMinutes: 45 }, watch, now);
check("not offered once the trip started", e3 === null, String(e3));
const e4 = earliestPickupAt({ status: "DRIVER_ASSIGNED", scheduledAt: t("14:55"), pickupOffsetMinutes: 45 }, { ...watch, status: "CANCELLED" }, now);
check("not offered for a cancelled flight", e4 === null, String(e4));
const e5 = earliestPickupAt({ status: "DRIVER_ASSIGNED", scheduledAt: t("14:55"), pickupOffsetMinutes: 45 }, watch, new Date("2026-10-12T14:47:20Z"));
check("never in the past: earliest = now rounded up (15:48)", !!e5 && ukTime(e5) === "15:48", e5 ? ukTime(e5) : "null");

console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
