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
import { buildFlightMessages, ukTime } from "./flightMessages";
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
const DRIVER_UPDATE_MIN = 15; // driver push when pickup moves this much since they were last told
const PASSENGER_UPDATE_MIN = 60; // extra passenger SMS only for big further changes
const TOLD_TTL_S = 3 * 24 * 3600;

// What we last told each party (transient, day-of tracking state).
const toldKey = (who: "driver" | "passenger", bookingId: string) =>
  `flight:told:${who}:${bookingId}`;
async function getTold(
  redis: Redis,
  who: "driver" | "passenger",
  bookingId: string
): Promise<Date | null> {
  const v = await redis.get(toldKey(who, bookingId));
  return v ? new Date(v) : null;
}
async function setTold(
  redis: Redis,
  who: "driver" | "passenger",
  bookingId: string,
  at: Date
) {
  await redis.set(toldKey(who, bookingId), at.toISOString(), "EX", TOLD_TTL_S);
}
const minutesApart = (a: Date, b: Date) =>
  Math.abs(a.getTime() - b.getTime()) / 60_000;

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

    let interp = interpretFlight(flight, now);
    // Before take-off, never let the estimate go BACKWARDS: provider data can
    // regress (EZY858 lost a known delay). After take-off, live tracking rules.
    if (
      interp.phase === "SCHEDULED" &&
      !interp.departed &&
      watch.expectedGateArrivalAt &&
      interp.gateArrival < watch.expectedGateArrivalAt
    ) {
      interp = { ...interp, gateArrival: watch.expectedGateArrivalAt };
    }
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

      const toldDriver = await getTold(redis, "driver", b.id);
      const toldPassenger = await getTold(redis, "passenger", b.id);
      const lastTold =
        [toldDriver, toldPassenger]
          .filter((d): d is Date => !!d)
          .sort((x, y) => y.getTime() - x.getTime())[0] ?? null;

      const d = decide(
        {
          bookedPickupAt: b.bookedPickupAt,
          lastToldPickupAt: lastTold,
          pickupOffsetMinutes: b.pickupOffsetMinutes,
          currentPickupAt: b.scheduledAt,
          firedEvents: new Set(b.flightEvents.map((e) => e.type)),
          tripStarted: STARTED.includes(b.status),
          earlierConfirmed: b.flightEvents.some(
            (e) => e.type === "EARLIER_CONFIRMED"
          ),
        },
        flight,
        now,
        interp
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
          oldPickupAt: b.bookedPickupAt, // passenger's reference: the time they agreed, not quiet adjustments
          idealPickupAt: d.idealPickupAt,
          landedAt: d.interpretation.landedAt,
          landedIsTouchdown: !!flight.runwayArrivalUtc,
          contactPhone: phone,
        });

        let smsSent = false;
        let pushSent = false;
        const passengerPhone = b.passenger?.user?.phone;
        if (msg.passengerSms && passengerPhone)
          smsSent = (
            await sendSms(passengerPhone, msg.passengerSms, {
              purpose: "FLIGHT_PASSENGER",
              bookingId: b.id,
              flightEventId: event.id,
            })
          ).ok;
        if (smsSent) await setTold(redis, "passenger", b.id, ev.newPickupAt);

        const driverUser = b.driver?.user;
        if (driverUser) {
          if (msg.driverPush) {
            try {
              const delivered = await notifications.sendToUser(
                driverUser.id,
                {
                  ...msg.driverPush,
                  data: {
                    type: `FLIGHT_${ev.type}`,
                    bookingId: b.id,
                  },
                },
                "driver"
              );
              pushSent = delivered > 0;
              if (pushSent)
                await setTold(redis, "driver", b.id, ev.newPickupAt);
            } catch (err) {
              pushSent = false;
              console.error("[FlightUpdate] driver push failed:", err);
            }
          }
          if (msg.driverSmsBackup && driverUser.phone)
            await sendSms(driverUser.phone, msg.driverSmsBackup, {
              purpose: "FLIGHT_DRIVER_BACKUP",
              bookingId: b.id,
              flightEventId: event.id,
            });
        }

        await prisma.bookingFlightEvent.update({
          where: { id: event.id },
          data: { smsSent, pushSent },
        });
      }

      // Follow-up updates (no milestone this round, flight still on its way):
      //  driver    — whenever pickup moved 15+ min since they were last told
      //  passenger — only after a "running late/early" text, and 60+ min since their last text
      const effective = d.newPickupAt ?? b.scheduledAt;
      if (!d.events.length && d.interpretation.phase === "SCHEDULED") {
        const fired = new Set(b.flightEvents.map((e) => e.type));
        const driverUser = b.driver?.user;
        const driverBase = toldDriver ?? b.bookedPickupAt;
        const sendDriver =
          !!driverUser &&
          minutesApart(effective, driverBase) >= DRIVER_UPDATE_MIN;
        const passengerBase = toldPassenger ?? b.bookedPickupAt;
        const sendPassenger =
          (fired.has("RUNNING_LATE") || fired.has("RUNNING_EARLY")) &&
          !!toldPassenger &&
          minutesApart(effective, passengerBase) >= PASSENGER_UPDATE_MIN;

        if (sendDriver || sendPassenger) {
          const event = await prisma.bookingFlightEvent.create({
            data: {
              bookingId: b.id,
              type: "PICKUP_UPDATE",
              oldPickupAt: b.scheduledAt,
              newPickupAt: effective,
            },
          });
          summary.events.push(`${b.reference}:PICKUP_UPDATE`);
          const msg = buildFlightMessages("PICKUP_UPDATE", {
            flight: b.flightNumber ?? "Your flight",
            meetingPoint: b.meetingPoint?.name ?? b.pickupAddress,
            pickupAt: effective,
            oldPickupAt: sendDriver ? driverBase : passengerBase,
            idealPickupAt: d.idealPickupAt,
            landedAt: null,
            contactPhone: phone,
          });
          let smsSent = false;
          let pushSent = false;
          if (sendPassenger && msg.passengerSms && b.passenger?.user?.phone) {
            smsSent = (
              await sendSms(b.passenger.user.phone, msg.passengerSms, {
                purpose: "FLIGHT_PASSENGER",
                bookingId: b.id,
                flightEventId: event.id,
              })
            ).ok;
            if (smsSent) await setTold(redis, "passenger", b.id, effective);
          }
          if (sendDriver && msg.driverPush && driverUser) {
            try {
              const delivered = await notifications.sendToUser(
                driverUser.id,
                {
                  ...msg.driverPush,
                  data: {
                    type: "FLIGHT_PICKUP_UPDATE",
                    bookingId: b.id,
                  },
                },
                "driver"
              );
              pushSent = delivered > 0;
              if (pushSent) await setTold(redis, "driver", b.id, effective);
            } catch (err) {
              pushSent = false;
              console.error("[FlightUpdate] driver push failed:", err);
            }
          }
          await prisma.bookingFlightEvent.update({
            where: { id: event.id },
            data: { smsSent, pushSent },
          });
        }
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

// ── Confirm an earlier pickup ────────────────────────────────────────────────
// Admin action now; the driver's "Yes, I can make it" button (Phase 2b) will
// call the same function. Sets BOTH the current and the booked pickup (the
// confirmed time becomes the new agreed time — the rules then never move it
// earlier automatically), records EARLIER_CONFIRMED, texts the passenger and
// pushes the driver.
const MIN_MS = 60_000;
const EARLIER_MIN_GAIN_MIN = 5; // only offer it when at least 5 min earlier
const floorMin = (d: Date) =>
  new Date(Math.floor(d.getTime() / MIN_MS) * MIN_MS);
const ceilMin = (d: Date) => new Date(Math.ceil(d.getTime() / MIN_MS) * MIN_MS);

type EarlierBooking = {
  status: BookingStatus | string;
  scheduledAt: Date | null;
  pickupOffsetMinutes: number | null;
};
type EarlierWatch = {
  status: string;
  expectedGateArrivalAt: Date | null;
  actualGateArrivalAt: Date | null;
} | null;

/**
 * Earliest the passenger could be picked up (gate arrival + their offset,
 * never in the past) — only when that is at least 5 min before the current
 * pickup and the trip hasn't started. Otherwise null.
 */
export function earliestPickupAt(
  b: EarlierBooking,
  w: EarlierWatch | undefined,
  now: Date = new Date()
): Date | null {
  if (!w || b.pickupOffsetMinutes == null || !b.scheduledAt) return null;
  if ([...FINISHED, ...STARTED].includes(b.status as BookingStatus)) return null;
  if (w.status !== "WATCHING" && w.status !== "ARRIVED") return null;
  if (b.scheduledAt <= now) return null;
  const gate = w.actualGateArrivalAt ?? w.expectedGateArrivalAt;
  if (!gate) return null;
  let earliest = floorMin(
    new Date(gate.getTime() + b.pickupOffsetMinutes * MIN_MS)
  );
  const soonest = ceilMin(now);
  if (earliest < soonest) earliest = soonest;
  return b.scheduledAt.getTime() - earliest.getTime() >=
    EARLIER_MIN_GAIN_MIN * MIN_MS
    ? earliest
    : null;
}

/** Minutes London is ahead of UTC at a moment (0 in winter, 60 in summer). */
function londonOffsetMin(at: Date): number {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
  return Math.round((asUtc - floorMin(at).getTime()) / MIN_MS);
}
const londonDay = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
/** "2026-10-12" + "15:31" (UK time) → Date. */
function londonDateTime(day: string, hhmm: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - londonOffsetMin(new Date(guess)) * MIN_MS;
  t = guess - londonOffsetMin(new Date(t)) * MIN_MS; // settle DST edges
  return new Date(t);
}

export type ConfirmEarlierResult =
  | { ok: true; pickupAt: string; smsSent: boolean; pushSent: boolean }
  | { ok: false; status: number; error: string };

export async function confirmEarlierPickup(
  prisma: PrismaClient,
  redis: Redis,
  bookingId: string,
  pickupTime: string, // "HH:MM", UK time
  confirmedBy: string,
  opts: { now?: Date; io?: Emitter } = {}
): Promise<ConfirmEarlierResult> {
  const now = opts.now ?? new Date();
  const first = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { flightWatchId: true },
  });
  if (!first) return { ok: false, status: 404, error: "Booking not found" };
  if (!first.flightWatchId)
    return {
      ok: false,
      status: 400,
      error: "This booking's flight isn't being tracked",
    };

  // Same lock as flight updates, so a poll/web-hook can't interleave.
  const lockKey = `flightwatch:lock:${first.flightWatchId}`;
  const locked = await redis.set(lockKey, "1", "EX", 30, "NX");
  if (!locked)
    return {
      ok: false,
      status: 409,
      error: "A flight update is in progress - try again in a moment",
    };

  try {
    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        flightWatch: true,
        passenger: { include: { user: { select: { id: true, phone: true } } } },
        driver: { include: { user: { select: { id: true, phone: true } } } },
        meetingPoint: { select: { name: true } },
      },
    });
    if (!b || !b.scheduledAt)
      return { ok: false, status: 404, error: "Booking not found" };

    const earliest = earliestPickupAt(b, b.flightWatch, now);
    if (!earliest)
      return {
        ok: false,
        status: 400,
        error: "No earlier pickup is available for this booking",
      };

    let pickupAt = londonDateTime(londonDay(earliest), pickupTime);
    if (pickupAt < earliest)
      pickupAt = new Date(pickupAt.getTime() + 24 * 60 * MIN_MS); // past midnight
    if (pickupAt < earliest || pickupAt >= b.scheduledAt)
      return {
        ok: false,
        status: 400,
        error: `Choose a time from ${ukTime(earliest)} and before ${ukTime(
          b.scheduledAt
        )}`,
      };

    const old = b.scheduledAt;
    await prisma.booking.update({
      where: { id: b.id },
      data: { scheduledAt: pickupAt, bookedPickupAt: pickupAt },
    });
    // Event first (it's also the record), then send, then mark what was sent.
    const event = await prisma.bookingFlightEvent.create({
      data: {
        bookingId: b.id,
        type: "EARLIER_CONFIRMED",
        oldPickupAt: old,
        newPickupAt: pickupAt,
        note: `Confirmed by ${confirmedBy}`,
      },
    });

    const msg = buildFlightMessages("EARLIER_CONFIRMED", {
      flight: b.flightNumber ?? "Your flight",
      meetingPoint: b.meetingPoint?.name ?? b.pickupAddress,
      pickupAt,
      oldPickupAt: old,
      idealPickupAt: earliest,
      landedAt: null,
      contactPhone: await contactPhone(prisma),
    });

    let smsSent = false;
    let pushSent = false;
    const passengerPhone = b.passenger?.user?.phone;
    if (msg.passengerSms && passengerPhone) {
      smsSent = (
        await sendSms(passengerPhone, msg.passengerSms, {
          purpose: "FLIGHT_PASSENGER",
          bookingId: b.id,
          flightEventId: event.id,
        })
      ).ok;
      if (smsSent) await setTold(redis, "passenger", b.id, pickupAt);
    }
    const driverUser = b.driver?.user;
    if (msg.driverPush && driverUser) {
      try {
        const delivered = await new NotificationService(prisma).sendToUser(
          driverUser.id,
          {
            ...msg.driverPush,
            data: { type: "FLIGHT_EARLIER_CONFIRMED", bookingId: b.id },
          },
          "driver"
        );
        pushSent = delivered > 0;
        if (pushSent) await setTold(redis, "driver", b.id, pickupAt);
      } catch (err) {
        console.error("[FlightUpdate] confirm-earlier driver push failed:", err);
      }
    }
    await prisma.bookingFlightEvent.update({
      where: { id: event.id },
      data: { smsSent, pushSent },
    });

    opts.io
      ?.to("admin")
      .emit("admin:booking:updated", { bookingId: b.id, status: b.status });
    return { ok: true, pickupAt: pickupAt.toISOString(), smsSent, pushSent };
  } finally {
    await redis.del(lockKey);
  }
}
