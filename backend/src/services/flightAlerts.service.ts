// backend/src/services/flightAlerts.service.ts
//
// AeroDataBox Flight Alert API (web-hooks) — Phase 2a step 5a: CAPTURE ONLY.
//
//   - One subscription per FLIGHT NUMBER (AeroDataBox subscribes by number, not
//     date), shared by every open watch with that number.
//   - Created when a watch is open, deleted when the last open watch using it
//     ends; an hourly reconcile deletes anything we no longer need.
//   - Subscriptions never expire and each notification costs 1 credit per
//     flight item (1 credit = 1 API unit). Credits are topped up MANUALLY with
//     scripts/flight-alerts.ts; a low-balance warning fires below 50.
//   - Incoming notifications are only STORED (FlightWebhookEvent) for now.
//     Step 5b will apply them via applyFlightUpdate once we've seen real payloads.
//
// Switches:
//   FLIGHT_WEBHOOKS_ENABLED=true  create subscriptions (off → reconcile deletes them)
//   FLIGHT_WEBHOOK_SECRET         random string, part of the callback URL
//   BACKEND_URL                   public base URL (already used by Tesla)
import axios from "axios";
import { timingSafeEqual } from "crypto";

const RAPIDAPI_HOST = "aerodatabox.p.rapidapi.com";
const BASE_URL = `https://${RAPIDAPI_HOST}`;
const TIMEOUT_MS = 8000;
export const LOW_BALANCE_CREDITS = 50;

type Log = { warn: (msg: string) => void };

const apiKey = () => process.env.AERODATABOX_API_KEY;
const secret = () => process.env.FLIGHT_WEBHOOK_SECRET ?? "";

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

async function adb(
  method: "GET" | "POST" | "DELETE",
  path: string,
  data?: unknown
): Promise<{ status: number; data: any }> {
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
  return { status: res.status, data: res.data };
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
        } ${JSON.stringify(res.data).slice(0, 300)}`
      );
      return null;
    }
    // Shape not documented yet — log it so we can see it in Railway.
    log.warn(
      `[FlightAlert] subscribed ${flightNumber} → ${id} ${JSON.stringify(
        res.data
      ).slice(0, 300)}`
    );
    return String(id);
  } catch (err) {
    log.warn(`[FlightAlert] subscribe ${flightNumber} error: ${String(err)}`);
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

export async function getBalance(): Promise<{ status: number; data: any }> {
  return adb("GET", "/subscriptions/balance");
}

export async function refillBalance(
  credits: number
): Promise<{ status: number; data: any }> {
  return adb("POST", "/subscriptions/balance/refill", { credits });
}

// ── Notification parsing (best effort until we've seen real payloads) ──────

/** Finds a numeric credit balance anywhere in the top two levels of the payload. */
function findBalance(body: any, depth = 0): number | null {
  if (!body || typeof body !== "object" || depth > 2) return null;
  for (const [k, v] of Object.entries(body)) {
    if (/credit|balance/i.test(k) && typeof v === "number") return v;
  }
  for (const v of Object.values(body)) {
    const found = findBalance(v, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

export type NotificationSummary = {
  subscriptionId: string | null;
  flightNumber: string | null;
  flightCount: number;
  balance: number | null;
  topLevelKeys: string[];
};

export function summariseNotification(body: any): NotificationSummary {
  const flights: any[] = Array.isArray(body?.flights)
    ? body.flights
    : Array.isArray(body)
    ? body
    : [];
  const sub = body?.subscription;
  return {
    subscriptionId: sub?.id ?? body?.subscriptionId ?? null,
    flightNumber:
      sub?.subject?.id ?? flights[0]?.number ?? body?.flightNumber ?? null,
    flightCount: flights.length,
    balance: findBalance(body),
    topLevelKeys:
      body && typeof body === "object" ? Object.keys(body).slice(0, 20) : [],
  };
}
