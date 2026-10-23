// backend/src/services/weather.service.ts
//
// Current weather at airports, for the website flight status page (OpenWeather "Current
// Weather" API, free plan: commercial use allowed, 60 calls/min, 1,000,000/month, visible
// attribution required: the website shows "Weather data © OpenWeather" wherever it's used).
//
// Never called while a page loads. refreshWeatherForBoard() runs on the board's 1-minute tick
// and tops up airports whose cached weather is older than WEATHER_TTL_MIN; a "Check flight"
// lookup tops up its own two airports. Pages only READ the Redis cache (readWeather).
//
// Budget: ~150 airports on the board × every 30 min ≈ 7,200 calls/day ≈ 220,000/month.
//
// Env:
//   OPENWEATHER_API_KEY            (none → weather simply isn't shown)
//   WEATHER_DAILY_CAP=20000        hard stop per UK day
import axios from "axios";
import Redis from "ioredis";

export type WeatherKind = "clear" | "partly" | "cloudy" | "rain" | "drizzle" | "snow" | "thunder" | "fog";
export type Weather = {
  tempC: number; // rounded
  kind: WeatherKind;
  night: boolean;
  text: string; // "Light rain"
  windMph: number;
  at: string; // ISO, when OpenWeather measured it
};
export type Place = { iata: string; lat: number; lon: number };

export const LGW_PLACE: Place = { iata: "LGW", lat: 51.1481, lon: -0.1903 };

const URL = "https://api.openweathermap.org/data/2.5/weather";
const TTL_MIN = 30; // refresh after this
const KEEP_S = 3 * 3600; // keep in Redis (shown with its age) if refreshes fail
const PER_TICK = 40; // calls per 1-minute tick (free plan: 60/min)
const key = (iata: string) => `weather:${iata.toUpperCase()}`;

type Log = { warn: (msg: string) => void };

/** OpenWeather condition id → our icon kind. https://openweathermap.org/weather-conditions */
export function kindFor(id: number): WeatherKind {
  if (id >= 200 && id < 300) return "thunder";
  if (id >= 300 && id < 400) return "drizzle";
  if (id >= 500 && id < 600) return "rain";
  if (id >= 600 && id < 700) return "snow";
  if (id >= 700 && id < 800) return "fog";
  if (id === 800) return "clear";
  if (id === 801 || id === 802) return "partly";
  return "cloudy";
}

/** OpenWeather response → Weather, or null if it isn't usable. */
export function parseWeather(body: any): Weather | null {
  const w = Array.isArray(body?.weather) ? body.weather[0] : null;
  const temp = body?.main?.temp;
  if (!w || typeof w.id !== "number" || typeof temp !== "number") return null;
  const desc = typeof w.description === "string" && w.description ? w.description : String(w.main ?? "");
  const speed = typeof body?.wind?.speed === "number" ? body.wind.speed : 0; // m/s (units=metric)
  return {
    tempC: Math.round(temp),
    kind: kindFor(w.id),
    night: typeof w.icon === "string" && w.icon.endsWith("n"),
    text: desc.charAt(0).toUpperCase() + desc.slice(1),
    windMph: Math.round(speed * 2.23694),
    at: typeof body?.dt === "number" ? new Date(body.dt * 1000).toISOString() : new Date().toISOString(),
  };
}

/** Cached weather for these airports (missing ones left out). Never calls OpenWeather. */
export async function readWeather(redis: Redis, iatas: (string | null | undefined)[]): Promise<Record<string, Weather>> {
  const list = [...new Set(iatas.filter((x): x is string => !!x).map((x) => x.toUpperCase()))];
  if (!list.length) return {};
  const raw = await redis.mget(...list.map(key));
  const out: Record<string, Weather> = {};
  raw.forEach((r, i) => {
    if (!r) return;
    try {
      out[list[i]] = (JSON.parse(r) as { w: Weather }).w;
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

/** Fetch and cache one airport. "stop" = no key, cap reached or key refused: don't try more now. */
async function fetchOne(redis: Redis, log: Log, p: Place, now: Date): Promise<"ok" | "fail" | "stop"> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return "stop";
  const cap = Number(process.env.WEATHER_DAILY_CAP ?? 20000);
  const dayKey = `weather:calls:${londonDay(now)}`;
  const n = await redis.incr(dayKey);
  if (n === 1) await redis.expire(dayKey, 2 * 86_400);
  if (n > cap) {
    if (n === cap + 1) log.warn(`[Weather] daily cap (${cap}) reached`);
    return "stop";
  }
  try {
    const res = await axios.get(URL, {
      params: { lat: p.lat.toFixed(4), lon: p.lon.toFixed(4), units: "metric", appid: apiKey },
      timeout: 8000,
      validateStatus: () => true,
    });
    if (res.status === 401 || res.status === 429) {
      log.warn(
        res.status === 401
          ? "[Weather] OpenWeather refused the API key (401) - new keys can take a couple of hours to activate"
          : "[Weather] OpenWeather rate limit (429)"
      );
      return "stop";
    }
    if (res.status !== 200) {
      log.warn(`[Weather] ${p.iata}: HTTP ${res.status}`);
      return "fail";
    }
    const w = parseWeather(res.data);
    if (!w) return "fail";
    await redis.set(key(p.iata), JSON.stringify({ w, fetchedAt: now.toISOString() }), "EX", KEEP_S);
    return "ok";
  } catch {
    return "fail";
  }
}

/**
 * Called on the board's 1-minute tick: fetch up to PER_TICK airports whose weather is missing or
 * older than TTL_MIN (Gatwick first). Returns how many were fetched.
 */
export async function refreshWeather(redis: Redis, log: Log, places: Place[], now: Date = new Date()): Promise<number> {
  if (!process.env.OPENWEATHER_API_KEY) return 0;
  const lock = await redis.set("weather:lock", "1", "EX", 55, "NX");
  if (!lock) return 0;
  let fetched = 0;
  try {
    const unique = new Map<string, Place>();
    for (const p of [LGW_PLACE, ...places]) if (p.iata && !unique.has(p.iata)) unique.set(p.iata, p);
    for (const p of unique.values()) {
      if (fetched >= PER_TICK) break;
      if (!(await due(redis, p.iata, now))) continue;
      const r = await fetchOne(redis, log, p, now);
      if (r === "stop") break;
      if (r === "ok") fetched++;
    }
  } finally {
    await redis.del("weather:lock").catch(() => undefined);
  }
  return fetched;
}

/** A "Check flight" lookup: make sure its airports have weather (at most 2 calls). */
export async function ensureWeather(redis: Redis, log: Log, places: Place[], now: Date = new Date()): Promise<void> {
  for (const p of places.slice(0, 3)) {
    if (!(await due(redis, p.iata, now))) continue;
    if ((await fetchOne(redis, log, p, now)) === "stop") return;
  }
}
