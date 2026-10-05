// backend/src/services/flightUpdate.service.ts
//
// The single path for flight data (from web-hook alerts AND safety-net
// lookups): update the watch, recalculate every booking's pickup with the
// rules in flightRules.ts, record milestones, and send messages.
//
// Order per milestone: record the event FIRST (it's also the "send once" log),
// then send, then mark what was sent — so a crash can't cause duplicates.
import { PrismaClient, BookingStatus, Prisma } from "@prisma/client";
import Redis from "ioredis";
import { FlightArrival } from "./flightData.service";
import { decide, interpretFlight } from "./flightRules";
import { buildFlightMessages } from "./flightMessages";
import { sendSms } from "./sms.service";
import { NotificationService } from "./notification.service";

const FINISHED: BookingStatus[] = [
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
  BookingStatus.NO_SHOW,
];
const STARTED: BookingStatus[] = [
  BookingStatus.DRIVER_ARRIVED,
  BookingStatus.IN_PROGRESS,
];
const DEFAULT_CONTACT_PHONE = "+447398341839";

export type UpdateSummary = {
  watchId: string;
  stale: boolean;
  bookings: number;
  changed: number;
  events: string[];
};

type Emitter = {
  to: (room: string) => { emit: (event: string, data: unknown) => void };
};

async function contactPhone(prisma: PrismaClient): Promise<string> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: "contactPhone" },
  });
  return row?.value || DEFAULT_CONTACT_PHONE;
}

export async function applyFlightUpdate(
  prisma: PrismaClient,
  redis: Redis,
  watchId: string,
  flight: FlightArrival,
  opts: { now?: Date; io?: Emitter } = {}
): Promise<UpdateSummary> {
  const now = opts.now ?? new Date();
  const summary: UpdateSummary = {
    watchId,
    stale: false,
    bookings: 0,
    changed: 0,
    events: [],
  };

  // One update per watch at a time (an alert and a lookup can arrive together).
  const lockKey = `flightwatch:lock:${watchId}`;
  const locked = await redis.set(lockKey, "1", "EX", 30, "NX");
  if (!locked) return { ...summary, stale: true };

  try {
    const watch = await prisma.flightWatch.findUnique({
      where: { id: watchId },
    });
    if (!watch) return summary;

    // Never let older data overwrite newer data.
    const providerAt = flight.providerUpdatedAt
      ? new Date(flight.providerUpdatedAt)
      : null;
    if (
      providerAt &&
      watch.providerUpdatedAt &&
      providerAt < watch.providerUpdatedAt
    ) {
      await prisma.flightWatch.update({
        where: { id: watchId },
        data: { lastCheckedAt: now },
      });
      return { ...summary, stale: true };
    }

    const interp = interpretFlight(flight);
    await prisma.flightWatch.update({
      where: { id: watchId },
      data: {
        expectedGateArrivalAt: interp.gateArrival,
        actualGateArrivalAt:
          interp.phase === "ARRIVED" ? interp.gateArrival : null,
        status: interp.phase === "SCHEDULED" ? "WATCHING" : interp.phase,
        providerUpdatedAt: providerAt ?? watch.providerUpdatedAt,
        lastCheckedAt: now,
        unverified: false,
      },
    });

    const bookings = await prisma.booking.findMany({
      where: { flightWatchId: watchId, status: { notIn: FINISHED } },
      include: {
        passenger: { include: { user: { select: { id: true, phone: true } } } },
        driver: { include: { user: { select: { id: true, phone: true } } } },
        meetingPoint: { select: { name: true } },
        flightEvents: { select: { type: true } },
      },
    });
    summary.bookings = bookings.length;
    if (!bookings.length) return summary;

    const phone = await contactPhone(prisma);
    const notifications = new NotificationService(prisma);

    for (const b of bookings) {
      if (b.pickupOffsetMinutes == null || !b.bookedPickupAt || !b.scheduledAt)
        continue;

      const d = decide(
        {
          bookedPickupAt: b.bookedPickupAt,
          pickupOffsetMinutes: b.pickupOffsetMinutes,
          currentPickupAt: b.scheduledAt,
          firedEvents: new Set(b.flightEvents.map((e) => e.type)),
          tripStarted: STARTED.includes(b.status),
        },
        flight,
        now
      );

      // Pickup time + refreshed snapshot (provider data, 6-day retention).
      await prisma.booking.update({
        where: { id: b.id },
        data: {
          ...(d.newPickupAt && { scheduledAt: d.newPickupAt }),
          flightSnapshot: flight as unknown as Prisma.InputJsonValue,
          flightSnapshotFetchedAt: new Date(flight.fetchedAt),
        },
      });
      if (d.newPickupAt) summary.changed++;

      for (const ev of d.events) {
        const event = await prisma.bookingFlightEvent.create({
          data: {
            bookingId: b.id,
            type: ev.type,
            oldPickupAt: ev.oldPickupAt,
            newPickupAt: ev.newPickupAt,
          },
        });
        summary.events.push(`${b.reference}:${ev.type}`);

        const msg = buildFlightMessages(ev.type, {
          flight: b.flightNumber ?? "Your flight",
          meetingPoint: b.meetingPoint?.name ?? b.pickupAddress,
          pickupAt: ev.newPickupAt,
          oldPickupAt: b.bookedPickupAt,
          idealPickupAt: d.idealPickupAt,
          landedAt: d.interpretation.landedAt,
          contactPhone: phone,
        });

        let smsSent = false;
        let pushSent = false;
        const passengerPhone = b.passenger?.user?.phone;
        if (msg.passengerSms && passengerPhone)
          smsSent = (await sendSms(passengerPhone, msg.passengerSms)).ok;

        const driverUser = b.driver?.user;
        if (driverUser) {
          if (msg.driverPush) {
            try {
              await notifications.sendToUser(driverUser.id, {
                ...msg.driverPush,
                data: { type: `FLIGHT_${ev.type}`, bookingId: b.id },
              });
              pushSent = true;
            } catch {
              pushSent = false;
            }
          }
          if (msg.driverSmsBackup && driverUser.phone)
            await sendSms(driverUser.phone, msg.driverSmsBackup);
        }

        await prisma.bookingFlightEvent.update({
          where: { id: event.id },
          data: { smsSent, pushSent },
        });
      }

      if (d.newPickupAt || d.events.length) {
        opts.io
          ?.to("admin")
          .emit("admin:booking:updated", { bookingId: b.id, status: b.status });
      }
    }

    return summary;
  } finally {
    await redis.del(lockKey);
  }
}
