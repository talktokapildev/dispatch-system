// backend/src/services/sms.service.ts
//
// One place to send SMS (Twilio Programmable Messaging — same account and
// messages.create() call already used for OTPs and driver applications).
//
// Sender:
//   UK numbers (+44)  → alphanumeric sender TWILIO_SENDER_ID (e.g. "OrangeRide")
//   everyone else     → TWILIO_PHONE_NUMBER (many countries, e.g. US/Canada,
//                       reject alphanumeric senders)
//   If Twilio rejects the alphanumeric sender, we retry once from the number.
//
// Never throws: SMS is best-effort. Callers get { ok, … } and carry on —
// a failed text must never block a pickup-time update or a driver push.
//
// SMS_DRY_RUN=true logs messages instead of sending (local development).
import Twilio from "twilio";

export type SmsResult =
  | { ok: true; sid: string; from: string }
  | { ok: false; error: string };

let client: Twilio.Twilio | null | undefined;

function getClient(): Twilio.Twilio | null {
  if (client !== undefined) return client;
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  client =
    TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
      ? Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
      : null;
  return client;
}

function senderFor(to: string): string | undefined {
  const senderId = process.env.TWILIO_SENDER_ID?.trim();
  if (senderId && to.startsWith("+44")) return senderId;
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

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  if (!/^\+\d{8,15}$/.test(to)) {
    return { ok: false, error: `Not an E.164 phone number: ${to}` };
  }

  if (process.env.SMS_DRY_RUN === "true") {
    console.log(
      `[SMS dry-run] to=${to} from=${senderFor(to)} (${segmentInfo(
        body
      )}): ${body}`
    );
    return { ok: true, sid: "dry-run", from: senderFor(to) ?? "" };
  }

  const twilio = getClient();
  const from = senderFor(to);
  if (!twilio || !from) return { ok: false, error: "Twilio is not configured" };

  try {
    const msg = await twilio.messages.create({ to, from, body });
    return { ok: true, sid: msg.sid, from };
  } catch (err: any) {
    const fallback = process.env.TWILIO_PHONE_NUMBER;
    // Alphanumeric sender refused (not enabled on the account, or not allowed
    // for this destination) → retry once from the regular number.
    if (from !== fallback && fallback) {
      try {
        const msg = await twilio.messages.create({ to, from: fallback, body });
        console.warn(
          `[SMS] Sender "${from}" rejected (${
            err?.code ?? err?.message
          }); sent from number instead`
        );
        return { ok: true, sid: msg.sid, from: fallback };
      } catch (err2: any) {
        return {
          ok: false,
          error: `${err2?.code ?? ""} ${err2?.message ?? err2}`.trim(),
        };
      }
    }
    return {
      ok: false,
      error: `${err?.code ?? ""} ${err?.message ?? err}`.trim(),
    };
  }
}
