// backend/scripts/test-landing-forecast.ts
//
// Rule check (pure — no database, network or SMS): a runway time AHEAD of
// now is a landing FORECAST, not a touchdown. Uses the real EZY8182 data
// from Mon 12 Oct (all times UTC; UK = UTC+1).
//
//   node --env-file=.env -r ts-node/register scripts/test-landing-forecast.ts
import {
  interpretFlight,
  decide,
  FlightFacts,
} from "../src/services/flightRules";
import { ukTime } from "../src/services/flightMessages";

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`);
  if (!ok) failures++;
}
const t = (hhmm: string) => new Date(`2026-10-12T${hhmm}:00Z`);
const base: FlightFacts = {
  status: "EnRoute",
  scheduledArrivalUtc: t("12:45").toISOString(),
  revisedArrivalUtc: t("14:05").toISOString(),
  predictedArrivalUtc: null,
  runwayArrivalUtc: t("14:00").toISOString(), // provider's forecast touchdown
  departureScheduledUtc: t("09:05").toISOString(),
  departureRevisedUtc: null,
  departureRunwayUtc: null, // take-off never recorded on this flight
};

// 1. 13:58:21 notification: runway 14:00 is 2 min ahead → still in the air.
let i = interpretFlight(base, new Date("2026-10-12T13:58:21Z"));
check(
  "forecast runway, before it: not arrived",
  i.phase === "SCHEDULED" && i.landedAt === null && i.departed,
  `phase ${i.phase}, gate ${ukTime(i.gateArrival)}`
);
check(
  "  gate = revised 15:05 (revised is later than touchdown)",
  ukTime(i.gateArrival) === "15:05",
  ukTime(i.gateArrival)
);

// 2. 13:59:39 notification: revised 14:03, runway still 14:00 ahead.
i = interpretFlight(
  { ...base, revisedArrivalUtc: t("14:03").toISOString() },
  new Date("2026-10-12T13:59:39Z")
);
check(
  "second forecast: not arrived, gate 15:03",
  i.phase === "SCHEDULED" && ukTime(i.gateArrival) === "15:03",
  `${i.phase} ${ukTime(i.gateArrival)}`
);

// 3. Forecast without a later revised time → gate = runway + 7.
i = interpretFlight(
  { ...base, revisedArrivalUtc: null },
  new Date("2026-10-12T13:58:00Z")
);
check(
  "forecast, no revised: gate = runway + 7 = 15:07",
  ukTime(i.gateArrival) === "15:07",
  ukTime(i.gateArrival)
);

// 4. Same stored data re-applied at 14:02 (the watch-cycle re-check).
i = interpretFlight(base, new Date("2026-10-12T14:02:15Z"));
check(
  "forecast time passed: ARRIVED, landed 15:00",
  i.phase === "ARRIVED" && !!i.landedAt && ukTime(i.landedAt) === "15:00",
  `${i.phase} landed ${i.landedAt ? ukTime(i.landedAt) : "-"} gate ${ukTime(
    i.gateArrival
  )}`
);

// 5. Status says Arrived → trust it even if runway is (oddly) ahead.
i = interpretFlight(
  { ...base, status: "Arrived" },
  new Date("2026-10-12T13:59:00Z")
);
check("status Arrived wins", i.phase === "ARRIVED", i.phase);

// 6. Arrived without any runway time (10 Oct W62221 case) unchanged.
i = interpretFlight(
  {
    ...base,
    status: "Arrived",
    runwayArrivalUtc: null,
    revisedArrivalUtc: t("11:26").toISOString(),
    scheduledArrivalUtc: t("09:45").toISOString(),
  },
  new Date("2026-10-12T11:35:00Z")
);
check(
  "arrived without touchdown: gate = revised",
  i.phase === "ARRIVED" && ukTime(i.gateArrival) === "12:26",
  `${i.phase} ${ukTime(i.gateArrival)}`
);

// 7. decide(): no ARRIVED event on the forecast, ARRIVED event once it passes.
const booking = {
  bookedPickupAt: t("14:25"),
  lastToldPickupAt: t("14:47"),
  pickupOffsetMinutes: 45,
  currentPickupAt: t("14:52"),
  firedEvents: new Set<string>(["RUNNING_LATE"]),
  tripStarted: false,
};
let d = decide(booking, base, new Date("2026-10-12T13:58:21Z"));
check(
  "decide on forecast: no ARRIVED event",
  !d.events.some((e) => e.type === "ARRIVED"),
  d.events.map((e) => e.type).join(",") || "no events"
);
d = decide(booking, base, new Date("2026-10-12T14:02:15Z"));
check(
  "decide after forecast passes: ARRIVED, pickup 15:50",
  d.events.some((e) => e.type === "ARRIVED") &&
    ukTime(d.newPickupAt ?? booking.currentPickupAt) === "15:50",
  `${d.events.map((e) => e.type).join(",")} pickup ${ukTime(
    d.newPickupAt ?? booking.currentPickupAt
  )}`
);

console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
