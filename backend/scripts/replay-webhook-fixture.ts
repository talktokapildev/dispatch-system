// backend/scripts/replay-webhook-fixture.ts
//
// Step 5b check, no database or network needed: feeds stored web-hook
// notifications through the SAME parser + leg picker + rules the processor
// uses, and prints the timeline. Also checks redaction and the ARRIVED SMS
// lengths.
//
//   node --env-file=.env -r ts-node/register scripts/replay-webhook-fixture.ts \
//     [scripts/fixtures/w62221-2026-10-10.json] [2026-10-10]
//
// The fixture is AeroDataBox data: never commit it (scripts/fixtures/ is
// git-ignored) and delete it after testing (7-day retention limit).
import { readFileSync } from "fs";
import { parseArrivalLegs } from "../src/services/flightData.service";
import { interpretFlight } from "../src/services/flightRules";
import { buildFlightMessages, ukTime } from "../src/services/flightMessages";
import { londonDate } from "../src/services/flightWatch.service";
import {
  redactNotification,
  summariseNotification,
} from "../src/services/flightAlerts.service";

const file = process.argv[2] ?? "scripts/fixtures/w62221-2026-10-10.json";
const watchDate = process.argv[3] ?? "2026-10-10";
const rows: any[] = JSON.parse(readFileSync(file, "utf8"));

console.log(`${rows.length} stored notification(s), watch date ${watchDate}\n`);
console.log(
  "received | seq | ADB status   | phase     | gate  | landed | note"
);

let lastPhase = "";
for (const row of rows) {
  const body =
    typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  const s = summariseNotification(body);
  const at = new Date(row.receivedAt);
  const legs = parseArrivalLegs(body?.flights, "LGW");
  const leg = legs.find(
    (l) => londonDate(new Date(l.scheduledArrivalUtc)) === watchDate
  );
  if (!leg) {
    console.log(
      `${ukTime(at)}    | ${String(s.seqNo ?? "-").padEnd(
        3
      )} | (no leg for ${watchDate}; ${legs.length} LGW leg(s), ${
        s.flightCount
      } flight(s))`
    );
    continue;
  }
  const i = interpretFlight(leg, at);
  const raw = body.flights.find(
    (f: any) => f?.arrival?.airport?.iata === "LGW"
  )?.status;
  lastPhase = i.phase;
  console.log(
    `${ukTime(at)}    | ${String(s.seqNo ?? "-").padEnd(
      3
    )} | ${`${raw}=${leg.status}`.padEnd(12)} | ${i.phase.padEnd(9)} | ${ukTime(
      i.gateArrival
    )} | ${i.landedAt ? ukTime(i.landedAt) : "-    "}  | ${
      leg.runwayArrivalUtc ? "touchdown" : "no touchdown"
    }, quality ${leg.quality.join("+") || "-"}`
  );
}

// Redaction: nothing in the fixture should still contain a subscriber.
const leaked = rows.some((r) => JSON.stringify(r).includes('"subscriber"'));
console.log(`\nsubscriber field left in fixture: ${leaked}`);
const probe = redactNotification({
  subscription: { id: "x", subscriber: { id: "https://h/webhooks/flights/S" } },
}) as any;
console.log(
  `redactNotification removes subscriber: ${!probe.subscription.subscriber}`
);
console.log(`final phase: ${lastPhase || "none"}`);

// ARRIVED SMS lengths, worst case (longest meeting point, 8-char flight number).
console.log("\nARRIVED passenger SMS:");
for (const touchdown of [true, false]) {
  const m = buildFlightMessages("ARRIVED", {
    flight: "EZY8004A",
    meetingPoint: "Orange Car Park, Level 3",
    pickupAt: new Date("2026-10-10T12:11:00Z"),
    oldPickupAt: new Date("2026-10-10T12:30:00Z"),
    idealPickupAt: new Date("2026-10-10T12:11:00Z"),
    landedAt: new Date("2026-10-10T11:26:00Z"),
    landedIsTouchdown: touchdown,
    contactPhone: "+447398341839",
  });
  console.log(`  ${m.passengerSms!.length} chars: ${m.passengerSms}`);
  console.log(`  driver SMS: ${m.driverSmsBackup}`);
}
