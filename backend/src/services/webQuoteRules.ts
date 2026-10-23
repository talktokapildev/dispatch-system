// backend/src/services/webQuoteRules.ts
//
// Pure rules for the website quote calculator (no database, no network), so they can be
// tested on their own (scripts/test-web-quote-rules.ts).

export const GATWICK = { lat: 51.1537, lng: -0.1821 };
/** At least one end of the trip must be within this distance of Gatwick (straight line). */
export const SERVICE_RADIUS_MILES = 25;
/** Longest trip we quote on the website (road miles). Longer → "Ask us on WhatsApp". */
export const MAX_TRIP_MILES = 120;
/** Pre-booked only: pickups need this much notice. */
export const MIN_NOTICE_HOURS = 24;
/** How far ahead we quote (the pricing table knows bank holidays to the end of 2027). */
export const MAX_DAYS_AHEAD = 365;
export const MAX_PASSENGERS = 4;

const MILES_PER_KM = 0.621371;

export function straightLineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * MILES_PER_KM;
}

/** Before any Directions call: is either end close enough to Gatwick? */
export function nearGatwick(
  pickup: { lat: number; lng: number },
  dropoff: { lat: number; lng: number }
): boolean {
  return (
    straightLineMiles(pickup, GATWICK) <= SERVICE_RADIUS_MILES ||
    straightLineMiles(dropoff, GATWICK) <= SERVICE_RADIUS_MILES
  );
}

/** The "from" price: whole pounds, rounded DOWN, so the app's exact fare is never lower. */
export function fromPrice(total: number): number {
  return Math.floor(total + 1e-9);
}

/** Quote refs: "Q-" + 4 characters, no look-alikes (0/O, 1/I/L). */
const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export function makeQuoteRef(random: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += REF_ALPHABET[Math.floor(random() * REF_ALPHABET.length)];
  return `Q-${s}`;
}
export function isQuoteRef(v: string): boolean {
  return /^Q-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(v);
}

/** Minutes London is ahead of UTC at instant `d` (0 in winter, 60 in summer). */
export function londonOffsetMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const hour = get("hour") === 24 ? 0 : get("hour");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"));
  return Math.round((asUtc - Math.floor(d.getTime() / 60000) * 60000) / 60000);
}

/**
 * "2026-11-07" + "05:30" in UK time → the instant. Null if the date/time is not valid.
 * (In the autumn hour that happens twice, the first one is used; in the spring hour that
 * doesn't exist, the result lands an hour later — fine for a quote.)
 */
export function londonWallClockToUtc(date: string, time: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!dm || !tm) return null;
  const [y, mo, d] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
  const naive = Date.UTC(y, mo - 1, d, Number(tm[1]), Number(tm[2]));
  const check = new Date(naive);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d)
    return null; // e.g. 31 Feb
  let t = naive - londonOffsetMinutes(new Date(naive)) * 60000;
  t = naive - londonOffsetMinutes(new Date(t)) * 60000;
  return new Date(t);
}

export type TimeCheck =
  | { ok: true; pickupAt: Date | null; tooSoon: boolean }
  | { ok: false; error: string };

/** Optional date + time from the form. Both or neither. */
export function checkPickupTime(
  date: string | undefined,
  time: string | undefined,
  now: Date = new Date()
): TimeCheck {
  if (!date && !time) return { ok: true, pickupAt: null, tooSoon: false };
  if (!date || !time) return { ok: false, error: "Choose both a date and a time, or leave both empty." };
  const at = londonWallClockToUtc(date, time);
  if (!at) return { ok: false, error: "That date or time isn't valid." };
  if (at.getTime() <= now.getTime()) return { ok: false, error: "That time has already passed." };
  if (at.getTime() > now.getTime() + MAX_DAYS_AHEAD * 86_400_000)
    return { ok: false, error: "We can quote up to a year ahead." };
  return {
    ok: true,
    pickupAt: at,
    tooSoon: at.getTime() < now.getTime() + MIN_NOTICE_HOURS * 3_600_000,
  };
}

/**
 * The time we price at when the visitor gives none: midday UK time, tomorrow. The caller
 * moves on a day if that date carries a premium (bank holiday, Christmas), so the "from"
 * price is the everyday daytime price.
 */
export function defaultPricingTime(now: Date, daysAhead = 1): Date {
  const london = new Date(now.getTime() + londonOffsetMinutes(now) * 60000);
  const d0 = new Date(
    Date.UTC(london.getUTCFullYear(), london.getUTCMonth(), london.getUTCDate() + daysAhead)
  );
  const date = `${d0.getUTCFullYear()}-${String(d0.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d0.getUTCDate()
  ).padStart(2, "0")}`;
  return londonWallClockToUtc(date, "12:00")!;
}

/** Road distance in miles, to 1 decimal (what we store and show). */
export function kmToMiles(km: number): number {
  return Math.round(km * MILES_PER_KM * 10) / 10;
}
