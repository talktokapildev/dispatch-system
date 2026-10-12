// backend/src/services/sms.service.ts
//
// The ONE place that sends SMS (Twilio Programmable Messaging). Flight
// messages, admin alerts, OTPs and driver-application texts all come here.
//
// Sender:
//   UK numbers (+44)  → alphanumeric sender TWILIO_SENDER_ID (e.g. "OrangeRide")
//   everyone else     → TWILIO_PHONE_NUMBER (many countries, e.g. US/Canada,
//                       reject alphanumeric senders)
//   preferNumber      → always TWILIO_PHONE_NUMBER (OTPs: unchanged behaviour)
//   If Twilio rejects the alphanumeric sender, we retry once from the number.
//
// Delivery tracking (backlog A):
//   Once enableSmsTracking(prisma) has been called (server.ts), every message
//   Twilio accepts is recorded in SmsMessage (last 4 digits only) and asks
//   Twilio for status callbacks at BACKEND_URL + SMS_STATUS_PATH
//   (routes/twilioWebhooks.ts → smsStatus.service.ts). Scripts that don't
//   enable tracking send exactly as before.
//
// Never throws: SMS is best-effort. Callers get { ok, … } and carry on —
// a failed text must never block a pickup-time update or a driver push.
// "ok" means Twilio ACCEPTED the message, not that it was delivered.
//
// SMS_DRY_RUN=true logs messages instead of sending (local development).
import Twilio from "twilio";
import type { PrismaClient } from "@prisma/client";

export type SmsPurpose =
  | "FLIGHT_PASSENGER"
  | "FLIGHT_DRIVER_BACKUP"
  | "ADMIN_ALERT"
  | "OTP"
  | "DRIVER_APPLICATION"
  | "TEST"
  | "OTHER";

export type SmsOptions = {
  purpose?: SmsPurpose;
  bookingId?: string | null;
  flightEventId?: string | null;
  /** Send from TWILIO_PHONE_NUMBER even to +44 (no alphanumeric sender). */
  preferNumber?: boolean;
};

export type SmsResult =
  | { ok: true; sid: string; from: string }
  | { ok: false; error: string; notConfigured?: boolean };

/** Path Twilio posts delivery status to (no /api/v1 prefix). */
export const SMS_STATUS_PATH = "/webhooks/twilio/sms-status";

let client: Twilio.Twilio | null | undefined;
let trackingPrisma: PrismaClient | null = null;

function getClient(): Twilio.Twilio | null {
  if (client !== undefined) return client;
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  client =
    TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
      ? Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
      : null;
  return client;
}

/** Call once at start-up (server.ts) to record messages + request callbacks. */
export function enableSmsTracking(prisma: PrismaClient) {
  trackingPrisma = prisma;
}

/** Full public URL Twilio calls back on — also the URL signatures are checked against. */
export function statusCallbackUrl(): string | null {
  const base = (process.env.BACKEND_URL ?? "").trim().replace(/\/+$/, "");
  return base ? `${base}${SMS_STATUS_PATH}` : null;
}

export function last4(phone: string): string {
  return phone.replace(/\D/g, "").slice(-4);
}

/** For logs: never log a full phone number. */
export function maskPhone(phone: string): string {
  return `***${last4(phone)}`;
}

/** Twilio error texts can quote the number — mask anything phone-like. */
function scrub(text: string): string {
  return text.replace(/\+?\d{9,15}/g, (m) => maskPhone(m));
}

/** UK numbers typed as 07… / 447… → +447… ; anything else unchanged. */
export function normaliseUkPhone(phone: string): string {
  const p = phone.replace(/[\s()-]/g, "");
  if (/^07\d{9}$/.test(p)) return `+44${p.slice(1)}`;
  if (/^447\d{9}$/.test(p)) return `+${p}`;
  return p;
}

function senderFor(to: string, preferNumber?: boolean): string | undefined {
  const senderId = process.env.TWILIO_SENDER_ID?.trim();
  if (!preferNumber && senderId && to.startsWith("+44")) return senderId;
  return process.env.TWILIO_PHONE_NUMBER;
}

/** Plain-ASCII check: emoji/accents switch SMS to UCS-2 (70 chars/segment, more cost). */
function segmentInfo(body: string): string {
  const unicode = /[^\x00-\x7F£€]/.test(body);
  const perSegment = unicode ? 70 : 160;
  const segments = Math.ceil(body.length / perSegment);
  return `${body.length} chars, ${segments} segment(s)${
    unicode ? ", UNICODE" : ""
  }`;
}

async function record(
  to: string,
  sid: string,
  from: string,
  status: string | undefined,
  opts: SmsOptions
) {
  if (!trackingPrisma) return;
  try {
    await trackingPrisma.smsMessage.create({
      data: {
        sid,
        purpose: opts.purpose ?? "OTHER",
        bookingId: opts.bookingId ?? null,
        flightEventId: opts.flightEventId ?? null,
        toLast4: last4(to),
        sender: from,
        status: status || "queued",
      },
    });
  } catch (err: any) {
    // Never fail a send because the log row couldn't be written.
    console.error(`[SMS] could not record ${sid}: ${err?.message ?? err}`);
  }
}

function errorText(err: any): string {
  return scrub(`${err?.code ?? ""} ${err?.message ?? err}`.trim());
}

export async function sendSms(
  to: string,
  body: string,
  opts: SmsOptions = {}
): Promise<SmsResult> {
  const purpose = opts.purpose ?? "OTHER";
  if (!/^\+\d{8,15}$/.test(to)) {
    console.error(
      `[SMS] ${purpose} not sent: not an E.164 number (${maskPhone(to)})`
    );
    return { ok: false, error: `Not an E.164 phone number: ${maskPhone(to)}` };
  }

  const from = senderFor(to, opts.preferNumber);

  if (process.env.SMS_DRY_RUN === "true") {
    console.log(
      `[SMS dry-run] ${purpose} to=${to} from=${from} (${segmentInfo(
        body
      )}): ${body}`
    );
    return { ok: true, sid: "dry-run", from: from ?? "" };
  }

  const twilio = getClient();
  if (!twilio || !from)
    return {
      ok: false,
      error: "Twilio is not configured",
      notConfigured: true,
    };

  // Only ask for callbacks when we record the message (the callback looks it up).
  const callback = trackingPrisma ? statusCallbackUrl() : null;
  const extra = callback ? { statusCallback: callback } : {};

  try {
    const msg = await twilio.messages.create({ to, from, body, ...extra });
    await record(to, msg.sid, from, msg.status, opts);
    return { ok: true, sid: msg.sid, from };
  } catch (err: any) {
    const fallback = process.env.TWILIO_PHONE_NUMBER;
    // Alphanumeric sender refused (not enabled on the account, or not allowed
    // for this destination) → retry once from the regular number.
    if (from !== fallback && fallback) {
      try {
        const msg = await twilio.messages.create({
          to,
          from: fallback,
          body,
          ...extra,
        });
        console.warn(
          `[SMS] Sender "${from}" rejected (${errorText(
            err
          )}); sent from number instead`
        );
        await record(to, msg.sid, fallback, msg.status, opts);
        return { ok: true, sid: msg.sid, from: fallback };
      } catch (err2: any) {
        const error = errorText(err2);
        console.error(`[SMS] ${purpose} to ${maskPhone(to)} FAILED: ${error}`);
        return { ok: false, error };
      }
    }
    const error = errorText(err);
    console.error(`[SMS] ${purpose} to ${maskPhone(to)} FAILED: ${error}`);
    return { ok: false, error };
  }
}
