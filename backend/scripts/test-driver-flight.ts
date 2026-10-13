// backend/scripts/test-driver-flight.ts
//
// Phase 2b — driver flight view + "earlier pickup possible" push + driver
// confirm. Pure checks, then a run against the LOCAL database (SMS dry run,
// in-memory Redis, no push tokens → pushes count as not delivered).
//
//   SMS_DRY_RUN=true node --env-file=.env -r ts-node/register scripts/test-driver-flight.ts
//
// Expect: every line PASS, "ALL PASS" at the end.
import { PrismaClient, BookingStatus, BookingType } from "@prisma/client";
import {
  buildDriverFlightView,
  DriverFlightInput,
} from "../src/services/driverFlightView";
import {
  applyFlightUpdate,
  confirmEarlierPickup,
} from "../src/services/flightUpdate.service";
import { ukTime } from "../src/services/flightMessages";
import { FlightArrival } from "../src/services/flightData.service";

const MIN = 60_000;
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

// ── 1. Pure view ─────────────────────────────────────────────────────────────
const now = new Date();
const landing = new Date(Math.ceil((now.getTime() + 2 * 60 * MIN) / (5 * MIN)) * 5 * MIN);
const pickup = new Date(landing.getTime() + 45 * MIN);
const base: DriverFlightInput = {
  id: "b1",
  status: "DRIVER_ASSIGNED",
  flightNumber: "EZY8182",
  scheduledAt: pickup,
  bookedPickupAt: pickup,
  pickupOffsetMinutes: 45,
  flightArrivalTime: landing,
  flightSnapshot: { airlineName: "easyJet", originName: "Athens" },
  flightWatch: null,
  flightEvents: [],
};
const watch = (o: Partial<NonNullable<DriverFlightInput["flightWatch"]>>) => ({
  status: "WATCHING",
  expectedGateArrivalAt: landing,
  actualGateArrivalAt: null,
  lastCheckedAt: now,
  unverified: false,
  ...o,
});

let v = buildDriverFlightView(base, now)!;
check("not tracked → SCHEDULED, 'Lands HH:MM'",
  v.state === "SCHEDULED" && v.chip === `Lands ${ukTime(landing)}` && !v.earlierPickup, v.chip);
check("no flight number → null", buildDriverFlightView({ ...base, flightNumber: null }, now) === null);

const sched = {
  type: "SCHEDULE_CHANGE",
  note: "Scheduled landing 14:55 -> 15:55 (+60 min). Pickup not changed.",
  createdAt: now,
};
v = buildDriverFlightView({ ...base, flightEvents: [sched] }, now)!;
check("schedule change shown before tracking",
  v.scheduleNotice?.text === "Airline changed the schedule: lands 14:55 -> 15:55 (+60 min)." &&
  v.tone === "late", v.scheduleNotice?.text);
v = buildDriverFlightView({ ...base, flightEvents: [sched], flightWatch: watch({}) }, now)!;
check("schedule notice hidden once tracking", v.scheduleNotice === null && v.state === "TRACKING");

v = buildDriverFlightView({ ...base,
  flightWatch: watch({ expectedGateArrivalAt: new Date(landing.getTime() + 40 * MIN) }) }, now)!;
check("40 min late → TRACKING, late tone",
  v.state === "TRACKING" && v.tone === "late" && v.chip.startsWith("Tracking · gate ~"), v.chip);

const touchdown = new Date(now.getTime() - 3 * MIN);
v = buildDriverFlightView({ ...base, flightSnapshot: { runwayArrivalUtc: touchdown.toISOString() },
  flightWatch: watch({ status: "ARRIVED", actualGateArrivalAt: new Date(touchdown.getTime() + 7 * MIN) }) }, now)!;
check("arrived → 'Landed HH:MM', good tone",
  v.state === "LANDED" && v.chip === `Landed ${ukTime(touchdown)}` && v.tone === "good" && v.gateIsActual, v.chip);

v = buildDriverFlightView({ ...base, flightWatch: watch({ status: "CANCELLED" }) }, now)!;
check("cancelled → bad tone", v.state === "CANCELLED" && v.tone === "bad");

const earlyGate = new Date(landing.getTime() - 40 * MIN);
v = buildDriverFlightView({ ...base, flightWatch: watch({ expectedGateArrivalAt: earlyGate }) }, now)!;
check("40 min early → earlier pickup offered",
  v.earlierPickup?.earliestAt === new Date(earlyGate.getTime() + 45 * MIN).toISOString(),
  v.earlierPickup?.earliestAt ?? "none");
v = buildDriverFlightView({ ...base, status: "IN_PROGRESS",
  flightWatch: watch({ expectedGateArrivalAt: earlyGate }) }, now)!;
check("trip started → no earlier offer", v.earlierPickup === null);

// ── 2. Against the local DB ──────────────────────────────────────────────────
const prisma = new PrismaClient();
const mem = new Map<string, string>();
const fakeRedis: any = {
  get: async (k: string) => mem.get(k) ?? null,
  set: async (k: string, val: string, ...args: any[]) =>
    args.includes("NX") && mem.has(k) ? null : (mem.set(k, val), "OK"),
  del: async (k: string) => (mem.delete(k), 1),
};
const emitted: string[] = [];
const fakeIo = {
  to: (room: string) => ({
    emit: (event: string, data: any) => emitted.push(`${room} ${event} ${data?.bookingId ?? ""}`),
  }),
};

(async () => {
  if (process.env.SMS_DRY_RUN !== "true") throw new Error("Run with SMS_DRY_RUN=true");
  const stamp = String(Date.now()).slice(-7);
  const dUser = await prisma.user.create({
    data: { phone: `+44701${stamp}`, firstName: "Test", lastName: "Driver" },
  });
  const driver = await prisma.driver.create({
    data: {
      userId: dUser.id,
      pcoBadgeNumber: `TEST${stamp}`,
      pcoLicenseExpiry: new Date(Date.now() + 365 * 86_400_000),
      drivingLicenseNumber: `TEST${stamp}`,
    },
  });
  const pUser = await prisma.user.create({
    data: { phone: `+44702${stamp}`, firstName: "Test", lastName: "Passenger",
      passenger: { create: {} } },
    include: { passenger: true },
  });
  const mp = await prisma.airportMeetingPoint.create({
    data: { airportIata: "TST", terminal: `NORTH-${stamp}`, name: "Car Park 6, Level 4",
      instructions: "Test", latitude: 51.1617, longitude: -0.176 },
  });

  // Lands in 60 min, pickup 45 min after. It lands NOW-ish instead (58 min early).
  const land = new Date(Math.ceil((Date.now() + 60 * MIN) / (5 * MIN)) * 5 * MIN);
  const pick = new Date(land.getTime() + 45 * MIN);
  const w = await prisma.flightWatch.create({
    data: { flightNumber: "TEST002", arrivalDate: land.toISOString().slice(0, 10),
      expectedGateArrivalAt: land },
  });
  const booking = await prisma.booking.create({
    data: {
      reference: `TEST${Date.now()}`,
      passengerId: pUser.passenger!.id,
      driverId: driver.id,
      type: BookingType.PREBOOKED,
      status: BookingStatus.DRIVER_ASSIGNED,
      pickupAddress: "Gatwick North Terminal: Car Park 6, Level 4",
      pickupLatitude: mp.latitude, pickupLongitude: mp.longitude,
      dropoffAddress: "Crawley", dropoffLatitude: 51.11, dropoffLongitude: -0.18,
      estimatedFare: 20, scheduledAt: pick, bookedPickupAt: pick,
      flightNumber: "TEST002", meetingPointId: mp.id, terminal: "NORTH",
      luggageType: "CHECKED", pickupOffsetMinutes: 45, flightWatchId: w.id,
    },
  });

  const touch = new Date(Date.now() - 2 * MIN);
  const flight = (updatedMin: number): FlightArrival => ({
    flightNumber: "TE 002", airlineName: "Test Air", airlineIata: "TE",
    originIata: "BCN", originName: "Barcelona",
    scheduledArrivalUtc: land.toISOString(), predictedArrivalUtc: null,
    revisedArrivalUtc: touch.toISOString(), runwayArrivalUtc: touch.toISOString(),
    departureScheduledUtc: null, departureRevisedUtc: null,
    departureRunwayUtc: new Date(touch.getTime() - 150 * MIN).toISOString(),
    terminal: "NORTH", status: "Arrived", quality: ["Live"],
    fetchedAt: new Date().toISOString(),
    providerUpdatedAt: new Date(Date.now() + updatedMin * MIN).toISOString(),
  });
  const events = async () =>
    (await prisma.bookingFlightEvent.findMany({
      where: { bookingId: booking.id }, orderBy: { createdAt: "asc" },
      select: { type: true, pushSent: true, smsSent: true, note: true },
    }));

  try {
    await applyFlightUpdate(prisma, fakeRedis, w.id, flight(1), { io: fakeIo });
    let ev = await events();
    check("landed 58 min early → ARRIVED + EARLIER_POSSIBLE",
      ev.map((e) => e.type).join() === "ARRIVED,EARLIER_POSSIBLE",
      ev.map((e) => `${e.type}${e.note ? `: ${e.note}` : ""}`).join(" | "));
    check("driver app told to refresh (socket)",
      emitted.some((e) => e === `driver:${dUser.id} driver:flight_update ${booking.id}`));

    await applyFlightUpdate(prisma, fakeRedis, w.id, flight(2), { io: fakeIo });
    ev = await events();
    check("second update → no second EARLIER_POSSIBLE",
      ev.filter((e) => e.type === "EARLIER_POSSIBLE").length === 1);

    const row = await prisma.booking.findUnique({
      where: { id: booking.id },
      select: { status: true, flightNumber: true, scheduledAt: true, bookedPickupAt: true,
        pickupOffsetMinutes: true, flightArrivalTime: true, flightSnapshot: true, id: true,
        flightWatch: { select: { status: true, expectedGateArrivalAt: true,
          actualGateArrivalAt: true, lastCheckedAt: true, unverified: true } },
        flightEvents: { select: { type: true, note: true, createdAt: true } } },
    });
    const view = buildDriverFlightView(row!)!;
    check("driver view: LANDED with earlier pickup offered",
      view.state === "LANDED" && !!view.earlierPickup, `${view.chip}, earliest ${
        view.earlierPickup ? ukTime(new Date(view.earlierPickup.earliestAt)) : "none"}`);

    emitted.length = 0;
    const r = await confirmEarlierPickup(prisma, fakeRedis, booking.id,
      ukTime(new Date(view.earlierPickup!.earliestAt)), "driver Test Driver",
      { io: fakeIo, byDriver: true });
    ev = await events();
    const after = await prisma.booking.findUnique({ where: { id: booking.id },
      select: { scheduledAt: true, bookedPickupAt: true } });
    check("driver confirm → EARLIER_CONFIRMED, pickup + booked time moved, no push back",
      r.ok && !r.pushSent && ev.at(-1)?.type === "EARLIER_CONFIRMED" &&
      ev.at(-1)?.note === "Confirmed by driver Test Driver" &&
      after!.scheduledAt!.toISOString() === view.earlierPickup!.earliestAt &&
      after!.bookedPickupAt!.toISOString() === view.earlierPickup!.earliestAt,
      r.ok ? `pickup ${ukTime(new Date(r.pickupAt))}, sms ${r.smsSent}` : (r as any).error);
    check("driver app told to refresh after confirm",
      emitted.some((e) => e.startsWith(`driver:${dUser.id} driver:flight_update`)));
  } finally {
    await prisma.bookingFlightEvent.deleteMany({ where: { bookingId: booking.id } });
    await prisma.booking.delete({ where: { id: booking.id } });
    await prisma.flightWatch.delete({ where: { id: w.id } });
    await prisma.airportMeetingPoint.delete({ where: { id: mp.id } });
    await prisma.driver.delete({ where: { id: driver.id } });
    await prisma.passenger.delete({ where: { id: pUser.passenger!.id } });
    await prisma.user.deleteMany({ where: { id: { in: [dUser.id, pUser.id] } } });
    await prisma.$disconnect();
    console.log("Cleaned up test data.");
    console.log(failures ? `${failures} FAILED` : "ALL PASS");
    process.exit(failures ? 1 : 0);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
