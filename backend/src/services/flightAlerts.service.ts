// backend/src/services/flightAlerts.service.ts
//
// AeroDataBox Flight Alert API (web-hooks).
//
//   - One subscription per FLIGHT NUMBER (AeroDataBox subscribes by number, not
//     date), shared by every open watch with that number.
//   - Created when a watch is open, deleted when the last open watch using it
//     ends; an hourly reconcile deletes anything we no longer need, and the
//     web-hook processor deletes one immediately if a notification arrives
//     that no open watch needs.
//   - Subscriptions never expire and each notification costs 1 credit per
//     flight item (1 credit = 1 API unit, taken from the monthly quota).
//   - Credits are topped up AUTOMATICALLY (step 5b, guarded — see maybeTopUp)
//     or manually with scripts/flight-alerts.ts.
//   - Notifications are applied to bookings by flightWebhookProcessor.service.ts.
//
// Switches:
//   FLIGHT_WEBHOOKS_ENABLED=true  create subscriptions (off → reconcile deletes them)
//   FLIGHT_WEBHOOK_SECRET         random string, part of the callback URL
//   BACKEND_URL                   public base URL (already used by Tesla)
//   ADMIN_ALERT_PHONE             E.164 number for top-up alerts (SMS); unset → log only
import axios from "axios";
import { timingSafeEqual } from "crypto";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { sendSms } from "./sms.service";

const RAPIDAPI_HOST = "aerodatabox.p.rapidapi.com";
const BASE_URL = `https://${RAPIDAPI_HOST}`;
const TIMEOUT_MS = 8000;
export const LOW_BALANCE_CREDITS = 50;

// Guarded automatic top-up (agreed design).
const TOPUP_CREDITS = 100; // per top-up (≈ 8 short-haul flights)
const TOPUP_MAX_PER_DAY = 300; // credits per UK day
const TOPUP_MIN_UNITS = 1500; // never leave the monthly quota below this

type Log = { warn: (msg: string) => void };

const apiKey = () => process.env.AERODATABOX_API_KEY;
const secret = () => process.env.FLIGHT_WEBHOOK_SECRET ?? "";

/** UK calendar date (YYYY-MM-DD) — daily top-up counter. */
const ukDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);

/** Replaces the web-hook secret anywhere in a string (logs, error bodies). */
function scrub(s: string): string {
  const sec = secret();
  return sec.length >= 16 ? s.split(sec).join("[secret]") : s;
}

/** Subscriptions are only CREATED when switched on and fully configured. */
export function alertsEnabled(): boolean {
  return (
    process.env.FLIGHT_WEBHOOKS_ENABLED === "true" &&
    secret().length >= 16 &&
    !!process.env.BACKEND_URL &&
    !!apiKey()
  );
}

/** Constant-time check of the secret in the callback URL. */
export function isValidWebhookSecret(given: string): boolean {
  const expected = secret();
  if (expected.length < 16) return false;
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function callbackUrl(): string {
  const base = (process.env.BACKEND_URL ?? "").replace(/\/+$/, "");
  return `${base}/webhooks/flights/${secret()}`;
}

export type AdbResponse = {
  status: number;
  data: any;
  /** x-ratelimit-api-units-remaining (monthly quota left), null if absent. */
  unitsRemaining: number | null;
};

async function adb(
  method: "GET" | "POST" | "DELETE",
  path: string,
  data?: unknown
): Promise<AdbResponse> {
  const res = await axios.request({
    method,
    url: `${BASE_URL}${path}`,
    data,
    headers: {
      "X-RapidAPI-Key": apiKey() ?? "",
      "X-RapidAPI-Host": RAPIDAPI_HOST,
    },
    timeout: TIMEOUT_MS,
    validateStatus: () => true,
  });
  const raw = (res.headers as Record<string, unknown>)?.[
    "x-ratelimit-api-units-remaining"
  ];
  const units =
    raw != null && raw !== "" && Number.isFinite(Number(raw))
      ? Number(raw)
      : null;
  return { status: res.status, data: res.data, unitsRemaining: units };
}

/** Creates a subscription for a flight number. Returns its id, or null on failure. */
export async function subscribeFlight(
  flightNumber: string,
  log: Log
): Promise<string | null> {
  try {
    const res = await adb(
      "POST",
      `/subscriptions/webhook/FlightByNumber/${encodeURIComponent(
        flightNumber
      )}`,
      { url: callbackUrl(), maxDeliveryRetries: 0 }
    );
    const id = res.data?.id ?? res.data?.subscriptionId ?? null;
    if (res.status >= 300 || !id) {
      log.warn(
        `[FlightAlert] subscribe ${flightNumber} failed: HTTP ${
          res.status
        } ${scrub(JSON.stringify(res.data) ?? "").slice(0, 300)}`
      );
      return null;
    }
    // Never log the whole response: subscriber.id is the callback URL (secret).
    log.warn(
      `[FlightAlert] subscribed ${flightNumber} → ${id} (subject ${
        res.data?.subject?.id ?? "?"
      }, ${res.data?.billingType ?? "?"})`
    );
    return String(id);
  } catch (err) {
    log.warn(
      `[FlightAlert] subscribe ${flightNumber} error: ${scrub(String(err))}`
    );
    return null;
  }
}

/** Deletes a subscription. Treats "already gone" (404) as success. */
export async function deleteSubscription(
  id: string,
  log: Log
): Promise<boolean> {
  if (!apiKey()) return false;
  try {
    const res = await adb(
      "DELETE",
      `/subscriptions/webhook/${encodeURIComponent(id)}`
    );
    const ok = res.status < 300 || res.status === 404;
    log.warn(
      `[FlightAlert] delete ${id}: ${ok ? "ok" : `failed HTTP ${res.status}`}`
    );
    return ok;
  } catch (err) {
    log.warn(`[FlightAlert] delete ${id} error: ${String(err)}`);
    return false;
  }
}

/** All our subscription ids, or null if the list couldn't be read (then delete nothing). */
export async function listSubscriptionIds(): Promise<string[] | null> {
  if (!apiKey()) return null;
  try {
    const res = await adb("GET", "/subscriptions/webhook");
    if (res.status === 204) return [];
    if (res.status !== 200) return null;
    const items: any[] | null = Array.isArray(res.data)
      ? res.data
      : res.data?.items ?? res.data?.subscriptions ?? null;
    if (!Array.isArray(items)) return null;
    return items
      .map((s) => s?.id)
      .filter(Boolean)
      .map(String);
  } catch {
    return null;
  }
}

/** Free call. Also returns the monthly units left (response header). */
export async function getBalance(): Promise<AdbResponse> {
  return adb("GET", "/subscriptions/balance");
}

export async function refillBalance(credits: number): Promise<AdbResponse> {
  return adb("POST", "/subscriptions/balance/refill", { credits });
}

// ── Notifications ──────────────────────────────────────────────────────────

/**
 * Copy of a notification that is safe to store/log: subscription.subscriber
 * (its id is our callback URL, which contains the secret) is removed, and the
 * secret is replaced anywhere else it might appear.
 */
export function redactNotification(body: unknown): unknown {
  if (typeof body === "string") return scrub(body);
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const copy: any = { ...(body as any) };
  if (copy.subscription && typeof copy.subscription === "object") {
    const sub = { ...copy.subscription };
    delete sub.subscriber;
    copy.subscription = sub;
  }
  const sec = secret();
  if (sec.length >= 16) {
    const json = JSON.stringify(copy);
    if (json.includes(sec)) return JSON.parse(json.split(sec).join("[secret]"));
  }
  return copy;
}

export type NotificationSummary = {
  notificationId: string | null;
  subscriptionId: string | null;
  flightNumber: string | null; // AeroDataBox format, e.g. "W6 2221"
  flightCount: number;
  balance: number | null; // credits remaining after this notification
  seqNo: number | null;
};

/** Payload shape confirmed live on 10 Oct (W6 2221). */
export function summariseNotification(body: any): NotificationSummary {
  const flights: any[] = Array.isArray(body?.flights) ? body.flights : [];
  const sub = body?.subscription;
  const credits = body?.balance?.creditsRemaining;
  const seq = body?.deliveryAttempt?.seqNo;
  return {
    notificationId: body?.id != null ? String(body.id) : null,
    subscriptionId: sub?.id != null ? String(sub.id) : null,
    flightNumber: sub?.subject?.id ?? flights[0]?.number ?? null,
    flightCount: flights.length,
    balance: typeof credits === "number" ? credits : null,
    seqNo: typeof seq === "number" ? seq : null,
  };
}

// ── Guarded automatic top-up ────────────────────────────────────────────────

export async function alertAdmin(log: Log, text: string) {
  const to = process.env.ADMIN_ALERT_PHONE?.trim();
  if (!to) {
    log.warn(`[FlightAlert] (ADMIN_ALERT_PHONE not set) ${text}`);
    return;
  }
  const r = await sendSms(to, text, { purpose: "ADMIN_ALERT" });
  if (!r.ok) log.warn(`[FlightAlert] admin alert SMS failed: ${r.error}`);
}

/** Logs every time; SMS at most once per UK day per reason (no alert storms). */
async function topUpBlocked(
  redis: Redis,
  log: Log,
  day: string,
  reason: string,
  text: string
) {
  log.warn(`[FlightAlert] ${text}`);
  const first = await redis.set(
    `flightalert:topup:alerted:${day}:${reason}`,
    "1",
    "EX",
    2 * 86_400,
    "NX"
  );
  if (first) await alertAdmin(log, text);
}

/**
 * Tops up 100 credits when the balance is below 50 — only if:
 *   - web-hooks are enabled and at least one flight is being watched,
 *   - the monthly quota stays ≥ 1,500 units AFTER the top-up,
 *   - today's automatic top-ups stay ≤ 300 credits.
 * Called after every notification (with its balance) and hourly (balance
 * unknown → read it; the balance call is free). Never throws.
 */
export async function maybeTopUp(
  deps: { prisma: PrismaClient; redis: Redis; log: Log },
  knownCredits: number | null
): Promise<void> {
  const { prisma, redis, log } = deps;
  if (!alertsEnabled()) return;
  if (knownCredits !== null && knownCredits >= LOW_BALANCE_CREDITS) return;

  const lockKey = "flightalert:topup:lock";
  try {
    const lock = await redis.set(lockKey, "1", "EX", 120, "NX");
    if (!lock) return; // another notification is already handling it
    try {
      const open = await prisma.flightWatch.count({
        where: { endedAt: null, status: "WATCHING" },
      });
      if (open === 0) return;

      const bal = await getBalance();
      const credits = bal.data?.creditsRemaining;
      if (bal.status !== 200 || typeof credits !== "number") {
        log.warn(
          `[FlightAlert] top-up check: balance unreadable (HTTP ${bal.status})`
        );
        return;
      }
      if (credits >= LOW_BALANCE_CREDITS) return;

      const day = ukDate(new Date());
      const units = bal.unitsRemaining;
      if (units === null || units - TOPUP_CREDITS < TOPUP_MIN_UNITS) {
        return topUpBlocked(
          redis,
          log,
          day,
          "units",
          `OrangeRide ops: flight-alert credits low (${credits}), NOT topped up - API units left ${
            units ?? "unknown"
          } (min ${TOPUP_MIN_UNITS}). Polling still runs.`
        );
      }

      const dayKey = `flightalert:topup:day:${day}`;
      const used = Number(await redis.get(dayKey)) || 0;
      if (used + TOPUP_CREDITS > TOPUP_MAX_PER_DAY) {
        return topUpBlocked(
          redis,
          log,
          day,
          "daily",
          `OrangeRide ops: flight-alert credits low (${credits}), NOT topped up - daily auto limit ${TOPUP_MAX_PER_DAY} reached. Polling still runs.`
        );
      }

      const res = await refillBalance(TOPUP_CREDITS);
      if (res.status >= 300) {
        return topUpBlocked(
          redis,
          log,
          day,
          "failed",
          `OrangeRide ops: flight-alert auto top-up FAILED (HTTP ${res.status}), credits ${credits}. Polling still runs.`
        );
      }
      await redis.incrby(dayKey, TOPUP_CREDITS);
      await redis.expire(dayKey, 2 * 86_400);

      const after =
        typeof res.data?.creditsRemaining === "number"
          ? res.data.creditsRemaining
          : credits + TOPUP_CREDITS;
      const text = `OrangeRide ops: auto top-up +${TOPUP_CREDITS} flight-alert credits (${credits} -> ${after}). API units left ~${
        res.unitsRemaining ?? units - TOPUP_CREDITS
      }. Today ${used + TOPUP_CREDITS}/${TOPUP_MAX_PER_DAY}.`;
      log.warn(`[FlightAlert] ${text}`);
      await alertAdmin(log, text);
    } finally {
      await redis.del(lockKey);
    }
  } catch (err) {
    log.warn(`[FlightAlert] top-up check error: ${String(err)}`);
  }
}
