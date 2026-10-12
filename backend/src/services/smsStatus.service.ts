// backend/src/services/smsStatus.service.ts
//
// Applies Twilio delivery-status callbacks to SmsMessage rows and alerts
// the admin when an important SMS is not delivered.
//
// Statuses only move FORWARD (Twilio callbacks can arrive out of order:
// "sent" after "delivered"). The forward-only update is one atomic
// updateMany, so duplicate callbacks change nothing.
//
// Alerts (SMS to ADMIN_ALERT_PHONE, at most once per message):
//   FLIGHT_PASSENGER      → any flight event, when undelivered/failed
//   FLIGHT_DRIVER_BACKUP  → ARRIVED only
//   Everything else (OTP, ADMIN_ALERT, …) → warn log only (no alert loops).
// Messages stuck without a final status: quiet (agreed).
import type { PrismaClient } from "@prisma/client";
import { alertAdmin } from "./flightAlerts.service";

type Log = { warn: (msg: string) => void };

/** Twilio message statuses in delivery order; equal rank = alternative outcomes. */
const RANK: Record<string, number> = {
  accepted: 0,
  scheduled: 0,
  queued: 1,
  sending: 2,
  sent: 3,
  delivered: 4,
  undelivered: 4,
  failed: 4,
  canceled: 4,
  read: 5,
};

export function statusRank(status: string): number | undefined {
  return RANK[status];
}

/** Statuses a row may currently have for `status` to replace it. */
export function statusesBefore(status: string): string[] {
  const r = RANK[status];
  if (r === undefined) return [];
  return Object.keys(RANK).filter((s) => RANK[s] < r);
}

export function isFailure(status: string): boolean {
  return status === "undelivered" || status === "failed";
}

export function shouldAlert(
  purpose: string,
  eventType: string | null | undefined
): boolean {
  if (purpose === "FLIGHT_PASSENGER") return true;
  if (purpose === "FLIGHT_DRIVER_BACKUP") return eventType === "ARRIVED";
  return false;
}

/** Plain ASCII, one segment. */
export function alertText(a: {
  purpose: string;
  status: string;
  errorCode: string | null;
  toLast4: string;
  reference: string | null;
  flightNumber: string | null;
  eventType: string | null;
}): string {
  const who = a.purpose === "FLIGHT_DRIVER_BACKUP" ? "driver" : "passenger";
  const code = a.errorCode ? ` (${a.errorCode})` : "";
  const what = [a.reference, a.flightNumber, a.eventType]
    .filter(Boolean)
    .join(" ");
  return `OrangeRide ops: ${who} SMS ${a.status.toUpperCase()}${code} to ***${
    a.toLast4
  }. ${what || "no booking"}`.slice(0, 160);
}

export type CallbackOutcome =
  | "ignored"
  | "unknown status"
  | "unknown sid"
  | "stale"
  | "updated"
  | "alerted";

export async function handleSmsStatusCallback(
  prisma: PrismaClient,
  log: Log,
  params: Record<string, string>
): Promise<CallbackOutcome> {
  const sid = params.MessageSid;
  const status = (params.MessageStatus || params.SmsStatus || "").toLowerCase();
  if (!sid || !status) return "ignored";
  if (statusRank(status) === undefined) {
    log.warn(`[SMS] status callback ${sid}: unknown status "${status}"`);
    return "unknown status";
  }
  const errorCode = params.ErrorCode?.trim() || null;

  const res = await prisma.smsMessage.updateMany({
    where: { sid, status: { in: statusesBefore(status) } },
    data: { status, ...(errorCode && { errorCode }) },
  });
  if (res.count === 0) {
    const exists = await prisma.smsMessage.findUnique({
      where: { sid },
      select: { id: true },
    });
    return exists ? "stale" : "unknown sid";
  }
  if (!isFailure(status)) return "updated";

  const row = await prisma.smsMessage.findUnique({ where: { sid } });
  if (!row) return "updated";

  const event = row.flightEventId
    ? await prisma.bookingFlightEvent.findUnique({
        where: { id: row.flightEventId },
        select: {
          type: true,
          booking: { select: { reference: true, flightNumber: true } },
        },
      })
    : null;
  const booking =
    event?.booking ??
    (row.bookingId
      ? await prisma.booking.findUnique({
          where: { id: row.bookingId },
          select: { reference: true, flightNumber: true },
        })
      : null);

  const text = alertText({
    purpose: row.purpose,
    status,
    errorCode: row.errorCode,
    toLast4: row.toLast4,
    reference: booking?.reference ?? null,
    flightNumber: booking?.flightNumber ?? null,
    eventType: event?.type ?? null,
  });
  log.warn(`[SMS] ${row.purpose} ${sid} ${text}`);

  if (!shouldAlert(row.purpose, event?.type)) return "updated";

  // Claim the alert atomically: two failure callbacks can't both send it.
  const claim = await prisma.smsMessage.updateMany({
    where: { sid, alertedAt: null },
    data: { alertedAt: new Date() },
  });
  if (claim.count === 0) return "updated";
  await alertAdmin(log, text);
  return "alerted";
}
