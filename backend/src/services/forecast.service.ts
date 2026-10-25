// backend/src/services/forecast.service.ts
//
// Weather FORECAST at airports, for flight pages: "Gatwick at 07:15 Tue: 9°, light rain" and
// "Pisa when you land: 19°, sunny". OpenWeather "5 day / 3 hour Forecast" API — same key, plan and
// attribution as weather.service.ts (current weather), and the same daily call counter and cap.
//
// Never called while a page loads. topUpForecasts() runs on the flight board's 1-minute tick for
// Gatwick and the airports of flights that are still hours away; a "Check flight" lookup tops up
// its own airports. Pages only READ the cache (readForecasts) and pick the 3-hour slot nearest
// the time they care about (pickForecast).
//
// Budget: refresh every 3 h; ~100 airports → ~800 calls/day on top of current weather.
import axios from "axios";
import Redis from "ioredis";
import { parseWeather, Place, Weather } from "./weather.service";

const URL = "https://api.openweathermap.org/data/2.5/forecast";
const TTL_MIN = 180; // refresh after this
const KEEP_S = 12 * 3600; // keep (still useful) if refreshes fail
const PER_TICK = 10; // the current-weather top-up uses up to 40 of the free plan's 60/min
const MAX_GAP_MIN = 90; // slots are 3 h apart: use the nearest one within 90 min
export const FORECAST_MIN_AHEAD_MIN = 120; // nearer than this, current weather says more
const key = (iata: string) => `forecast:${iata.toUpperCase()}`;

type Log = { warn: (msg: string) => void };

/** A forecast for one moment (a 3-hour slot); `at` is the slot's time. */
export type ForecastSlot = Weather;

// ── Pure ────────────────────────────────────────────────────────────────────
/** OpenWeather forecast response → slots, earliest first (unusable entries dropped). */
export function parseForecast(body: any): ForecastSlot[] {
  const list = Array.isArray(body?.list) ? body.list : [];
  const out: ForecastSlot[] = [];
  for (const item of list) {
    const w = parseWeather(item); // a forecast entry has the same shape; `at` comes from its dt
    if (w && typeof item?.dt === "number") out.push(w);
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** The slot nearest `atIso`, if one is within 90 minutes of it; otherwise null. */
export function pickForecast(slots: ForecastSlot[] | undefined, atIso: string | null): ForecastSlot | null {
  if (!slots?.length || !atIso) return null;
  const t = Date.parse(atIso);
  if (!Number.isFinite(t)) return null;
  let best: ForecastSlot | null = null;
  let gap = Infinity;
  for (const s of slots) {
    const g = Math.abs(Date.parse(s.at) - t);
    if (g < gap) {
      gap = g;
      best = s;
    }
  }
  return best && gap <= MAX_GAP_MIN * 60_000 ? best : null;
}

/** Only worth showing for a moment at least 2 hours away (and within the 5-day forecast). */
export function wantsForecast(atIso: string | null, now: Date): boolean {
  if (!atIso) return false;
  const min = (Date.parse(atIso) - now.getTime()) / 60_000;
  return min >= FORECAST_MIN_AHEAD_MIN && min <= 5 * 24 * 60;
}

// ── Cache ───────────────────────────────────────────────────────────────────
/** Cached forecasts for these airports (missing ones left out). Never calls OpenWeather. */
export async function readForecasts(redis: Redis, iatas: (string | null | undefined)[]): Promise<Record<string, ForecastSlot[]>> {
  const list = [...new Set(iatas.filter((x): x is string => !!x).map((x) => x.toUpperCase()))];
  if (!list.length) return {};
  const raw = await redis.mget(...list.map(key));
  const out: Record<string, ForecastSlot[]> = {};
  raw.forEach((r, i) => {
    if (!r) return;
    try {
      const slots = (JSON.parse(r) as { slots: ForecastSlot[] }).slots;
      if (Array.isArray(slots)) out[list[i]] = slots;
    } catch {
      /* skip */
    }
  });
  return out;
}

async function due(redis: Redis, iata: string, now: Date): Promise<boolean> {
  const raw = await redis.get(key(iata));
  if (!raw) return true;
  try {
    const { fetchedAt } = JSON.parse(raw) as { fetchedAt: string };
    return now.getTime() - Date.parse(fetchedAt) >= TTL_MIN * 60_000;
  } catch {
    return true;
  }
}

function londonDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
}

/** Fetch and cache one airport's forecast. Shares the current-weather daily counter and cap. */
async function fetchOne(redis: Redis, log: Log, p: Place, now: Date): Promise<"ok" | "fail" | "stop"> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return "stop";
  const cap = Number(process.env.WEATHER_DAILY_CAP ?? 20000);
  const dayKey = `weather:calls:${londonDay(now)}`;
  const n = await redis.incr(dayKey);
  if (n === 1) await redis.expire(dayKey, 2 * 86_400);
  if (n > cap) return "stop";
  try {
    const res = await axios.get(URL, {
      params: { lat: p.lat.toFixed(4), lon: p.lon.toFixed(4), units: "metric", appid: apiKey },
      timeout: 8000,
      validateStatus: () => true,
    });
    if (res.status === 401 || res.status === 429) {
      log.warn(`[Forecast] OpenWeather ${res.status === 401 ? "refused the API key (401)" : "rate limit (429)"}`);
      return "stop";
    }
    if (res.status !== 200) {
      log.warn(`[Forecast] ${p.iata}: HTTP ${res.status}`);
      return "fail";
    }
    const slots = parseForecast(res.data);
    if (!slots.length) return "fail";
    await redis.set(key(p.iata), JSON.stringify({ slots, fetchedAt: now.toISOString() }), "EX", KEEP_S);
    return "ok";
  } catch {
    return "fail";
  }
}

/** Top up forecasts that are missing or older than 3 hours (at most `max` calls). */
export async function topUpForecasts(redis: Redis, log: Log, places: Place[], now: Date = new Date(), max = PER_TICK): Promise<number> {
  if (!process.env.OPENWEATHER_API_KEY) return 0;
  const lock = await redis.set("forecast:lock", "1", "EX", 55, "NX");
  if (!lock) return 0;
  let fetched = 0;
  try {
    const unique = new Map<string, Place>();
    for (const p of places) if (p.iata && !unique.has(p.iata.toUpperCase())) unique.set(p.iata.toUpperCase(), p);
    for (const p of unique.values()) {
      if (fetched >= max) break;
      if (!(await due(redis, p.iata, now))) continue;
      const r = await fetchOne(redis, log, p, now);
      if (r === "stop") break;
      if (r === "ok") fetched++;
    }
  } finally {
    await redis.del("forecast:lock").catch(() => undefined);
  }
  return fetched;
}
