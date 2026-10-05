// Replays a flight's day through applyFlightUpdate against the LOCAL database.
// SMS are dry-run (printed), no driver is attached (no real pushes).
// Creates a temporary watch + booking and deletes them at the end.
//
//   cd backend && SMS_DRY_RUN=true node --env-file=.env -r ts-node/register scripts/replay-flight-test.ts
import { PrismaClient, BookingStatus, BookingType } from "@prisma/client";
import { applyFlightUpdate } from "../src/services/flightUpdate.service";
import { FlightArrival } from "../src/services/flightData.service";

const prisma = new PrismaClient();
const mem = new Map<string, string>();
const fakeRedis: any = {
  get: async (k: string) => mem.get(k) ?? null,
  set: async (k: string, v: string, ...args: any[]) =>
    args.includes("NX") && mem.has(k) ? null : (mem.set(k, v), "OK"),
  del: async (k: string) => (mem.delete(k), 1),
};

const MIN = 60_000;
const at = (base: Date, m: number) =>
  new Date(base.getTime() + m * MIN).toISOString();
const hm = (d: Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        minute: "2-digit",
      }).format(d)
    : "—";

(async () => {
  if (process.env.SMS_DRY_RUN !== "true")
    throw new Error("Run with SMS_DRY_RUN=true");
  // Temporary passenger + meeting point (removed at the end) so the test
  // doesn't depend on what's in the local database.
  const user = await prisma.user.create({
    data: {
      phone: `+44700${String(Date.now()).slice(-7)}`,
      firstName: "Test",
      lastName: "Passenger",
      passenger: { create: {} },
    },
    include: { passenger: true },
  });
  const passenger = { id: user.passenger!.id, user };
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

  const landing = new Date(
    Math.ceil((Date.now() + 4 * 60 * MIN) / (5 * MIN)) * 5 * MIN
  ); // ~4h from now
  const pickup = new Date(landing.getTime() + 45 * MIN);
  const date = landing.toISOString().slice(0, 10);

  const watch = await prisma.flightWatch.create({
    data: { flightNumber: "TEST001", arrivalDate: date },
  });
  const booking = await prisma.booking.create({
    data: {
      reference: `TEST${Date.now()}`,
      passengerId: passenger.id,
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
      flightNumber: "TEST001",
      meetingPointId: mp.id,
      terminal: "NORTH",
      luggageType: "CHECKED",
      pickupOffsetMinutes: 45,
      bookedPickupAt: pickup,
      flightWatchId: watch.id,
    },
  });
  console.log(
    `Booking ${booking.reference}: landing ${hm(landing)}, pickup ${hm(
      pickup
    )} (passenger ${passenger.user.phone})\n`
  );

  const flight = (
    o: Partial<FlightArrival>,
    updatedMinAfterNow: number
  ): FlightArrival => ({
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
    quality: ["Live"],
    fetchedAt: new Date().toISOString(),
    providerUpdatedAt: at(new Date(), updatedMinAfterNow),
    ...o,
  });

  const steps: [string, FlightArrival][] = [
    ["1 on time", flight({}, 1)],
    [
      "2 delayed 6 min (no message)",
      flight({ revisedArrivalUtc: at(landing, 6) }, 2),
    ],
    [
      "3 delayed 40 min (RUNNING_LATE)",
      flight({ revisedArrivalUtc: at(landing, 40) }, 3),
    ],
    [
      "4 older data arrives late (ignored)",
      flight({ revisedArrivalUtc: at(landing, 2) }, 0),
    ],
    [
      "5 delayed 52 min (no 2nd message)",
      flight({ revisedArrivalUtc: at(landing, 52) }, 4),
    ],
    [
      "5b delayed 2h (PICKUP_UPDATE: 60+ min)",
      flight({ revisedArrivalUtc: at(landing, 120) }, 4.5),
    ],
    [
      "6 landed (ARRIVED)",
      flight({ status: "Landed", runwayArrivalUtc: at(landing, 115) }, 5),
    ],
    [
      "7 arrived at gate (no duplicate)",
      flight(
        {
          status: "Arrived",
          revisedArrivalUtc: at(landing, 123),
          runwayArrivalUtc: at(landing, 115),
        },
        6
      ),
    ],
  ];

  try {
    for (const [label, f] of steps) {
      const s = await applyFlightUpdate(prisma, fakeRedis, watch.id, f);
      const b = await prisma.booking.findUnique({ where: { id: booking.id } });
      console.log(
        `${label.padEnd(38)} → pickup ${hm(b?.scheduledAt)}${
          s.stale ? " (stale, ignored)" : ""
        }${
          s.events.length
            ? ` · events: ${s.events.map((e) => e.split(":")[1]).join(", ")}`
            : ""
        }\n`
      );
    }
    const events = await prisma.bookingFlightEvent.findMany({
      where: { bookingId: booking.id },
      orderBy: { createdAt: "asc" },
    });
    console.log(
      "Recorded events:",
      events
        .map(
          (e) =>
            `${e.type} ${hm(e.oldPickupAt)}→${hm(e.newPickupAt)} sms=${
              e.smsSent
            }`
        )
        .join(" | ")
    );
  } finally {
    await prisma.bookingFlightEvent.deleteMany({
      where: { bookingId: booking.id },
    });
    await prisma.booking.delete({ where: { id: booking.id } });
    await prisma.flightWatch.delete({ where: { id: watch.id } });
    await prisma.airportMeetingPoint.delete({ where: { id: mp.id } });
    await prisma.passenger.delete({ where: { id: passenger.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
    console.log("\nCleaned up test watch + booking.");
  }
})();
