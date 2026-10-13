// backend/scripts/test-flight-refresh.ts
//
// Step 6b — future-flight refresh. Pure checks, then a run against the LOCAL
// database with a fake lookup + in-memory Redis (no AeroDataBox units, SMS dry
// run). Creates one test booking and deletes everything it made.
//
//   SMS_DRY_RUN=true node --env-file=.env -r ts-node/register scripts/test-flight-refresh.ts
//
// Expect: every line PASS, "ALL PASS" at the end.
import { PrismaClient, BookingStatus, BookingType } from "@prisma/client";
import {
  compareSchedule,
  needsRefresh,
  adminAlertText,
  refreshFutureFlights,
} from "../src/services/flightRefresh.service";
import {
  FlightArrival,
  LookupResult,
} from "../src/services/flightData.service";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`
  );
}

const landing = new Date(
  Math.ceil((Date.now() + 10 * DAY) / (5 * MIN)) * 5 * MIN
); // ~10 days ahead
const at = (m: number) => new Date(landing.getTime() + m * MIN).toISOString();
const flight = (o: Partial<FlightArrival> = {}): FlightArrival => ({
  flightNumber: "TE 001",
  airlineName: "Test Air",
  airlineIata: "TE",
  originIata: "BCN",
  originName: "Barcelona",
  scheduledArrivalUtc: landing.toISOString(),
  predictedArrivalUtc: null,
  revisedArrivalUtc: null,
  runwayArrivalUtc: null,
  departureScheduledUtc: null,
  departureRevisedUtc: null,
  departureRunwayUtc: null,
  terminal: "NORTH",
  status: "Expected",
  quality: ["Basic"],
  fetchedAt: new Date().toISOString(),
  providerUpdatedAt: null,
  ...o,
});
const ok = (f: FlightArrival): LookupResult => ({ ok: true, flight: f });

// ── 1. Pure rules ──────────────────────────────────────────────────────────
const prev = flight();
const kindEvent = (r: ReturnType<typeof compareSchedule>) =>
  r.kind === "retry" ? "retry" : `${r.kind}/${r.event ?? "-"}`;
check(
  "same schedule → refresh, no event",
  kindEvent(compareSchedule(landing, prev, ok(flight()))) === "updated/-"
);
check(
  "+10 min → no event",
  kindEvent(
    compareSchedule(landing, prev, ok(flight({ scheduledArrivalUtc: at(10) })))
  ) === "updated/-"
);
const later = compareSchedule(
  landing,
  prev,
  ok(flight({ scheduledArrivalUtc: at(105) }))
);
check(
  "+105 min → SCHEDULE_CHANGE",
  kindEvent(later) === "updated/SCHEDULE_CHANGE",
  later.kind === "updated" ? later.note ?? "" : ""
);
check(
  "-20 min → SCHEDULE_CHANGE",
  kindEvent(
    compareSchedule(landing, prev, ok(flight({ scheduledArrivalUtc: at(-20) })))
  ) === "updated/SCHEDULE_CHANGE"
);
check(
  "no previous time (snapshot cleared) → no change event",
  kindEvent(
    compareSchedule(null, null, ok(flight({ scheduledArrivalUtc: at(105) })))
  ) === "updated/-"
);
check(
  "cancelled → SCHEDULE_CANCELLED",
  kindEvent(
    compareSchedule(landing, prev, ok(flight({ status: "Canceled" })))
  ) === "updated/SCHEDULE_CANCELLED"
);
check(
  "already cancelled before → no event",
  kindEvent(
    compareSchedule(
      landing,
      flight({ status: "Canceled" }),
      ok(flight({ status: "Canceled" }))
    )
  ) === "updated/-"
);
check(
  "not found → SCHEDULE_NOT_FOUND",
  kindEvent(
    compareSchedule(landing, prev, { ok: false, reason: "not_found" })
  ) === "not_found/SCHEDULE_NOT_FOUND"
);
check(
  "provider error / daily limit → retry",
  kindEvent(
    compareSchedule(landing, prev, { ok: false, reason: "provider_error" })
  ) === "retry" &&
    kindEvent(
      compareSchedule(landing, prev, { ok: false, reason: "daily_limit" })
    ) === "retry"
);
const now0 = new Date();
check(
  "needsRefresh: missing / 6 days / 4 days",
  needsRefresh(null, now0) &&
    needsRefresh(new Date(now0.getTime() - 6 * DAY), now0) &&
    !needsRefresh(new Date(now0.getTime() - 4 * DAY), now0)
);
const texts = [
  adminAlertText(
    "DSMV55X0PZ9ZH",
    "EZY8182",
    "Sat 07 Nov",
    "SCHEDULE_CHANGE",
    landing,
    new Date(landing.getTime() + 105 * MIN)
  ),
  adminAlertText(
    "DSMV55X0PZ9ZH",
    "EZY8182",
    "Sat 07 Nov",
    "SCHEDULE_CANCELLED"
  ),
  adminAlertText(
    "DSMV55X0PZ9ZH",
    "EZY8182",
    "Sat 07 Nov",
    "SCHEDULE_NOT_FOUND"
  ),
];
check(
  "admin texts ASCII, one segment",
  texts.every((t) => /^[\x20-\x7E]+$/.test(t) && t.length <= 160),
  texts[0]
);

// ── 2. Against the local DB ────────────────────────────────────────────────
const prisma = new PrismaClient();
const mem = new Map<string, string>();
const fakeRedis: any = {
  get: async (k: string) => mem.get(k) ?? null,
  set: async (k: string, v: string, ...args: any[]) =>
    args.includes("NX") && mem.has(k) ? null : (mem.set(k, v), "OK"),
  del: async (k: string) => (mem.delete(k), 1),
};
const log = { warn: (m: string) => console.log(`  log: ${m}`) };

let alerts = 0;
const origLog = console.log;
console.log = (...a: any[]) => {
  if (String(a[0]).includes("[SMS dry-run] ADMIN_ALERT")) alerts++;
  origLog(...a);
};

(async () => {
  if (process.env.SMS_DRY_RUN !== "true")
    throw new Error("Run with SMS_DRY_RUN=true");
  process.env.FLIGHT_REFRESH_ENABLED = "true";
  process.env.ADMIN_ALERT_PHONE = "+447700900999";

  const user = await prisma.user.create({
    data: {
      phone: `+44700${String(Date.now()).slice(-7)}`,
      firstName: "Test",
      lastName: "Refresh",
      passenger: { create: {} },
    },
    include: { passenger: true },
  });
  const mp = await prisma.airportMeetingPoint.create({
    data: {
      airportIata: "TST",
      terminal: `NORTH-${Date.now()}`,
      name: "Car Park 6, Level 4",
      instructions: "Test",
      latitude: 51.1617,
      longitude: -0.176,
    },
  });
  const pickup = new Date(landing.getTime() + 45 * MIN);
  const booking = await prisma.booking.create({
    data: {
      reference: `TEST${Date.now()}`,
      passengerId: user.passenger!.id,
      type: BookingType.PREBOOKED,
      status: BookingStatus.SCHEDULED_OPEN,
      pickupAddress: "Gatwick North Terminal: Car Park 6, Level 4",
      pickupLatitude: mp.latitude,
      pickupLongitude: mp.longitude,
      dropoffAddress: "Crawley",
      dropoffLatitude: 51.11,
      dropoffLongitude: -0.18,
      estimatedFare: 20,
      scheduledAt: pickup,
      bookedPickupAt: pickup,
      flightNumber: "TEST001",
      meetingPointId: mp.id,
      terminal: "NORTH",
      luggageType: "CHECKED",
      pickupOffsetMinutes: 45,
      flightArrivalTime: landing,
      flightSnapshot: flight({
        fetchedAt: new Date(Date.now() - 6 * DAY).toISOString(),
      }) as any,
      flightSnapshotFetchedAt: new Date(Date.now() - 6 * DAY),
    },
  });

  let next: LookupResult = ok(flight());
  let calls = 0;
  const lookup = async (n: string, d: string, a: string) => {
    calls++;
    return next.ok
      ? ok({ ...next.flight, fetchedAt: new Date(cycleNow).toISOString() })
      : next;
  };
  let cycleNow = Date.now();
  const run = (daysLater: number, clearTried = true) => {
    cycleNow = Date.now() + daysLater * DAY;
    if (clearTried) mem.delete(`flightrefresh:tried:${booking.id}`);
    return refreshFutureFlights({
      prisma,
      redis: fakeRedis,
      log,
      lookup,
      now: new Date(cycleNow),
      onlyBookingIds: [booking.id],
    });
  };
  const state = () =>
    prisma.booking.findUnique({
      where: { id: booking.id },
      select: {
        scheduledAt: true,
        bookedPickupAt: true,
        flightArrivalTime: true,
        flightSnapshotFetchedAt: true,
        flightEvents: {
          select: { type: true, note: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

  try {
    // a) airline moves the flight 1h45 later
    next = ok(flight({ scheduledArrivalUtc: at(105) }));
    await run(0);
    let s = await state();
    check(
      "a) SCHEDULE_CHANGE event + 1 admin alert",
      s!.flightEvents.map((e) => e.type).join() === "SCHEDULE_CHANGE" &&
        alerts === 1,
      s!.flightEvents[0]?.note ?? ""
    );
    check(
      "a) pickup NOT changed, scheduled time + snapshot refreshed",
      s!.scheduledAt!.getTime() === pickup.getTime() &&
        s!.bookedPickupAt!.getTime() === pickup.getTime() &&
        s!.flightArrivalTime!.toISOString() === at(105) &&
        Date.now() - s!.flightSnapshotFetchedAt!.getTime() < 60_000
    );

    // b) same cycle again: remembered attempt + fresh snapshot → no lookup
    const before = calls;
    await run(0, false);
    check("b) fresh snapshot → no lookup", calls === before);

    // c) 6 days later, unchanged → refreshed quietly
    await run(6);
    s = await state();
    check(
      "c) unchanged → no new event",
      s!.flightEvents.length === 1 && alerts === 1
    );

    // d) cancellation, reported once (snapshot made stale so it's looked up)
    next = ok(flight({ scheduledArrivalUtc: at(105), status: "Canceled" }));
    await prisma.booking.update({
      where: { id: booking.id },
      data: { flightSnapshotFetchedAt: new Date(Date.now() - 6 * DAY) },
    });
    await run(1);
    await run(6); // fresh snapshot → skipped anyway
    s = await state();
    check(
      "d) SCHEDULE_CANCELLED once",
      s!.flightEvents.filter((e) => e.type === "SCHEDULE_CANCELLED").length ===
        1 && alerts === 2
    );

    // e) not found, twice (snapshot made stale) → one event
    next = { ok: false, reason: "not_found" };
    await prisma.booking.update({
      where: { id: booking.id },
      data: { flightSnapshotFetchedAt: new Date(Date.now() - 6 * DAY) },
    });
    await run(1);
    await run(1);
    s = await state();
    check(
      "e) SCHEDULE_NOT_FOUND once",
      s!.flightEvents.filter((e) => e.type === "SCHEDULE_NOT_FOUND").length ===
        1 && alerts === 3
    );

    // f) provider error → nothing written, retry key 1h
    next = { ok: false, reason: "provider_error" };
    const evCount = s!.flightEvents.length;
    await run(1);
    s = await state();
    check(
      "f) provider error → no event, retry later",
      s!.flightEvents.length === evCount &&
        mem.get(`flightrefresh:tried:${booking.id}`) === "error"
    );

    // g) units below floor → no lookup, one admin alert per day
    mem.set("adb:units:remaining", "1200");
    const c0 = calls;
    await run(1);
    await run(1);
    check(
      "g) units < 1,500 → paused, alerted once",
      calls === c0 && alerts === 4
    );
    mem.delete("adb:units:remaining");

    // h) within 24h of arrival → left to the watch
    const c1 = calls;
    await run(9.5);
    check("h) < 24h before arrival → not refreshed", calls === c1);
  } finally {
    await prisma.bookingFlightEvent.deleteMany({
      where: { bookingId: booking.id },
    });
    await prisma.booking.delete({ where: { id: booking.id } });
    await prisma.airportMeetingPoint.delete({ where: { id: mp.id } });
    await prisma.passenger.delete({ where: { id: user.passenger!.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
    console.log = origLog;
    console.log("Cleaned up test booking.");
    console.log(failures ? `${failures} FAILED` : "ALL PASS");
    process.exit(failures ? 1 : 0);
  }
})().catch((err) => {
  console.log = origLog;
  console.error(err);
  process.exit(1);
});
