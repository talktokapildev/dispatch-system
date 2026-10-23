// backend/src/services/flightBoard.service.ts
//
// Public flight status page (website). Visitors NEVER trigger a provider call
// just by loading a page:
//
//   1. refreshBoardIfDue() — on a timer, ONE AeroDataBox airport-board call for
//      Gatwick (arrivals + departures, 2 h back to ~10 h ahead, 2 units). The parsed
//      flights are kept in Redis only (no database), well inside the provider's
//      7-day caching limit. Every flight page and the board read from this.
//   2. lookupFlight() — a flight outside that window (e.g. tomorrow), only when a
//      PERSON presses "Check flight" (POST from the website). One /flights/number
//      call (2 units), cached 30 min, max FLIGHT_STATUS_LOOKUPS_PER_DAY per UK day.
//
// Booking tracking always comes first: both stop when the provider's monthly
// units left (Redis adb:units:remaining, written by every provider response) drop
// below FLIGHT_BOARD_UNITS_FLOOR (default 1,500), with one ops SMS per UK day.
//
// Env:
//   FLIGHT_BOARD_ENABLED=true          turn the timed refresh on (off by default)
//   FLIGHT_BOARD_REFRESH_MIN=30        30 on the Pro plan, 10 on Ultra (min 5)
//   FLIGHT_BOARD_UNITS_FLOOR=1500
//   FLIGHT_STATUS_LOOKUPS_PER_DAY=100
//
// Weather at each airport on the board (weather.service.ts, OpenWeather) is topped up on the
// same 1-minute tick, separately from AeroDataBox units.
import axios from "axios";
import Redis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { alertAdmin } from "./flightAlerts.service";
import { getFlightBuffers, BUFFER_DEFAULTS } from "../utils/airportPickup";
import { ensureWeather, LGW_PLACE, Place, refreshWeather } from "./weather.service";
import {
  AIRPORT_IATA,
  BoardFlight,
  boardWindow,
  londonDate,
  matchKey,
  parseBoard,
  parseLookupLegs,
} from "./flightBoardRules";

const RAPIDAPI_HOST = "aerodatabox.p.rapidapi.com";
const BASE_URL = `https://${RAPIDAPI_HOST}`;
const TIMEOUT_MS = 15_000; // the board response is larger than a single flight

const KEY_DATA = `flightboard:${AIRPORT_IATA}:data`;
const KEY_LOCK = `flightboard:${AIRPORT_IATA}:lock`;
const KEY_BACKOFF = `flightboard:${AIRPORT_IATA}:backoff`;
const KEY_UNITS = "adb:units:remaining"; // shared with flightData / 6b refresh
const KEY_BUFFERS = "flightboard:buffers";
const DATA_TTL_S = 6 * 3600; // stale data disappears after 6 h (provider allows 7 days)
const LOOKUP_TTL_S = 30 * 60;
const NIGHT_MIN_INTERVAL = 60; // 00:00–05:00 UK: few flights, refresh at most hourly

type Log = { warn: (msg: string) => void; error?: (obj: unknown, msg?: string) => void };
export type BoardDeps = { redis: Redis; prisma: PrismaClient; log: Log };

export type StoredBoard = {
  fetchedAt: string;
  fromLocal: string;
  toLocal: string;
  flights: BoardFlight[];
};

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const enabled = () => process.env.FLIGHT_BOARD_ENABLED === "true";
const refreshMin = () => Math.max(5, num(process.env.FLIGHT_BOARD_REFRESH_MIN, 30));
const unitsFloor = () => num(process.env.FLIGHT_BOARD_UNITS_FLOOR, 1500);
const lookupsPerDay = () => num(process.env.FLIGHT_STATUS_LOOKUPS_PER_DAY, 100);

// ── Provider call ─────────────────────────────────────────────────────────
type AdbResult = { status: number; body: unknown } | null;

async function adbGet(redis: Redis, path: string, params: Record<string, unknown>): Promise<AdbResult> {
  const key = process.env.AERODATABOX_API_KEY;
  if (!key) return null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res;
    try {
      res = await axios.get(`${BASE_URL}${path}`, {
        params,
        headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": RAPIDAPI_HOST },
        timeout: TIMEOUT_MS,
        validateStatus: () => true,
      });
    } catch {
      return null; // timeout / network
    }
    const raw = res.headers?.["x-ratelimit-api-units-remaining"];
    const units = Number(raw);
    if (raw != null && raw !== "" && Number.isFinite(units))
      await redis.set(KEY_UNITS, String(units), "EX", 2 * 86_400).catch(() => undefined);
    if (res.status !== 429 || attempt === 2) return { status: res.status, body: res.data };
    await new Promise((r) => setTimeout(r, 1100)); // Pro: 2 requests/second
  }
  return null;
}

/** False (and one ops SMS per UK day) when units left are below the floor. */
async function unitsOk(deps: BoardDeps, what: string): Promise<boolean> {
  const raw = await deps.redis.get(KEY_UNITS);
  if (raw == null) return true; // unknown yet: the first response will tell us
  const left = Number(raw);
  if (!Number.isFinite(left) || left >= unitsFloor()) return true;
  deps.log.warn(`[FlightBoard] ${what} skipped: ${left} units left (floor ${unitsFloor()})`);
  const first = await deps.redis.set(
    `flightboard:alerted:units:${londonDate(new Date())}`, "1", "EX", 2 * 86_400, "NX"
  );
  if (first)
    await alertAdmin(
      deps.log,
      `OrangeRide ops: flight status page paused - only ${left} AeroDataBox units left. Booking tracking still runs.`
    );
  return false;
}

// ── 1. Timed board refresh ────────────────────────────────────────────────
export async function getBoard(redis: Redis): Promise<StoredBoard | null> {
  const raw = await redis.get(KEY_DATA);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredBoard;
  } catch {
    return null;
  }
}

function isNightUk(now: Date): boolean {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(now)
  );
  return h < 5;
}

/** Called every minute; does nothing unless a refresh is due. Returns what happened (for logs/tests). */
export async function refreshBoardIfDue(deps: BoardDeps, now: Date = new Date()): Promise<string> {
  if (!enabled()) return "disabled";
  const { redis, log } = deps;

  const current = await getBoard(redis);
  const interval = isNightUk(now) ? Math.max(refreshMin(), NIGHT_MIN_INTERVAL) : refreshMin();
  if (current) {
    const ageMin = (now.getTime() - Date.parse(current.fetchedAt)) / 60_000;
    if (ageMin < interval - 0.5) return "fresh";
  }
  if (await redis.get(KEY_BACKOFF)) return "backoff";
  if (!(await unitsOk(deps, "board refresh"))) return "units_floor";
  const locked = await redis.set(KEY_LOCK, "1", "EX", 120, "NX");
  if (!locked) return "locked";

  try {
    const w = boardWindow(now);
    const r = await adbGet(redis, `/flights/airports/iata/${AIRPORT_IATA}/${w.fromLocal}/${w.toLocal}`, {
      direction: "Both",
      withLeg: true,
      withCancelled: true,
      withCodeshared: true,
      withCargo: false,
      withPrivate: false,
      withLocation: false,
    });
    if (!r || (r.status !== 200 && r.status !== 204)) {
      log.warn(`[FlightBoard] refresh failed (${r ? `HTTP ${r.status}` : "no response"}); retry in 5 min`);
      await redis.set(KEY_BACKOFF, "1", "EX", 5 * 60);
      return "provider_error";
    }
    const flights = r.status === 204 ? [] : parseBoard(r.body);
    const stored: StoredBoard = { fetchedAt: now.toISOString(), fromLocal: w.fromLocal, toLocal: w.toLocal, flights };
    await redis.set(KEY_DATA, JSON.stringify(stored), "EX", DATA_TTL_S);
    const arr = flights.filter((f) => f.direction === "ARRIVAL").length;
    log.warn(
      `[FlightBoard] refreshed ${w.fromLocal}..${w.toLocal}: ${arr} arrivals, ${flights.length - arr} departures; units left ${await redis.get(KEY_UNITS)}`
    );
    return "refreshed";
  } finally {
    await redis.del(KEY_LOCK).catch(() => undefined);
  }
}

/** Pickup buffers (Admin settings), cached 10 min — the board is read far more often than they change. */
export async function boardBuffers(deps: BoardDeps): Promise<{ hand: number; checked: number }> {
  const raw = await deps.redis.get(KEY_BUFFERS);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      /* fall through */
    }
  }
  try {
    const b = await getFlightBuffers(deps.prisma);
    await deps.redis.set(KEY_BUFFERS, JSON.stringify(b), "EX", 600);
    return b;
  } catch {
    return BUFFER_DEFAULTS;
  }
}

// ── 2. On-demand lookup (a person pressed "Check flight") ────────────────
export type LookupOutcome =
  | { status: "FOUND"; flights: BoardFlight[]; fetchedAt: string }
  | { status: "NOT_FOUND" }
  | { status: "INVALID" }
  | { status: "BUSY" }; // daily cap, units floor or provider trouble

const MAX_DAYS_AHEAD = 180;

function validDate(date: string, now: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = Date.parse(`${date}T12:00:00Z`);
  if (Number.isNaN(d)) return false;
  const days = (d - now.getTime()) / 86_400_000;
  return days >= -2 && days <= MAX_DAYS_AHEAD;
}

/**
 * A "Check flight" result already in the 30-minute cache, or null. Never calls the
 * provider: the flight page uses it so a shared link for a looked-up flight still works.
 */
export async function cachedLookup(
  redis: Redis,
  input: string,
  date: string
): Promise<Extract<LookupOutcome, { status: "FOUND" }> | null> {
  const key = matchKey(input);
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const raw = await redis.get(`flightstatus:lookup:${key}:${date}`);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as LookupOutcome;
    return o.status === "FOUND" ? o : null;
  } catch {
    return null;
  }
}

export async function lookupFlight(
  deps: BoardDeps,
  input: string,
  date: string,
  now: Date = new Date()
): Promise<LookupOutcome> {
  const key = matchKey(input);
  if (!key || !validDate(date, now)) return { status: "INVALID" };
  const { redis, log } = deps;

  const cacheKey = `flightstatus:lookup:${key}:${date}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as LookupOutcome;
    } catch {
      /* refetch */
    }
  }

  if (!(await unitsOk(deps, "lookup"))) return { status: "BUSY" };
  const dayKey = `flightstatus:lookups:${londonDate(now)}`;
  const count = await redis.incr(dayKey);
  if (count === 1) await redis.expire(dayKey, 2 * 86_400);
  if (count > lookupsPerDay()) {
    if (count === lookupsPerDay() + 1) log.warn(`[FlightBoard] daily lookup cap (${lookupsPerDay()}) reached`);
    return { status: "BUSY" };
  }

  const r = await adbGet(redis, `/flights/number/${encodeURIComponent(key)}/${date}`, {
    dateLocalRole: "Both",
    withAircraftImage: false,
    withLocation: false,
  });
  if (!r || ![200, 204, 404].includes(r.status)) {
    log.warn(`[FlightBoard] lookup ${key} ${date} failed (${r ? `HTTP ${r.status}` : "no response"})`);
    return { status: "BUSY" }; // not cached: try again later
  }
  const legs = r.status === 200 ? parseLookupLegs(r.body) : [];
  // dateLocalRole=Both can return a neighbouring day's leg; keep the asked-for UK date.
  const onDate = legs.filter((f) => londonDate(new Date(f.lgw.scheduledUtc)) === date);
  const outcome: LookupOutcome = onDate.length
    ? { status: "FOUND", flights: onDate, fetchedAt: now.toISOString() }
    : { status: "NOT_FOUND" };
  await redis.set(cacheKey, JSON.stringify(outcome), "EX", LOOKUP_TTL_S);
  if (outcome.status === "FOUND")
    await ensureWeather(redis, log, [LGW_PLACE, ...placesOf(outcome.flights)], now).catch(() => undefined);
  return outcome;
}

/** The other-end airports with a known position (for weather). */
export function placesOf(flights: BoardFlight[]): Place[] {
  const out: Place[] = [];
  for (const f of flights)
    if (f.other.iata && f.other.lat != null && f.other.lon != null)
      out.push({ iata: f.other.iata, lat: f.other.lat, lon: f.other.lon });
  return out;
}

/** Starts the once-a-minute refresh check (only refreshes when due; see refreshBoardIfDue). */
export function startFlightBoardRefresh(deps: BoardDeps): void {
  const tick = async () => {
    try {
      await refreshBoardIfDue(deps);
    } catch (err) {
      deps.log.warn(`[FlightBoard] refresh error: ${(err as Error)?.message ?? err}`);
    }
    if (!enabled()) return;
    try {
      // Soonest flights first, so the rows people look at get weather first after a restart.
      const board = await getBoard(deps.redis);
      const now = Date.now();
      const soonest = [...(board?.flights ?? [])].sort(
        (a, b) => Math.abs(Date.parse(a.lgw.scheduledUtc) - now) - Math.abs(Date.parse(b.lgw.scheduledUtc) - now)
      );
      await refreshWeather(deps.redis, deps.log, placesOf(soonest));
    } catch (err) {
      deps.log.warn(`[Weather] refresh error: ${(err as Error)?.message ?? err}`);
    }
  };
  setTimeout(tick, 20_000); // shortly after start-up
  setInterval(tick, 60_000);
}
