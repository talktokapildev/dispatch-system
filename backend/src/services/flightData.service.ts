// backend/src/services/flightData.service.ts
//
// Provider-neutral flight lookup. Everything AeroDataBox-specific (URL,
// headers, response parsing) lives in this file, so switching marketplace
// (RapidAPI → API.Market) or provider (→ FlightAware) touches nothing else.
//
// The leg parser (parseArrivalLegs) is shared by the lookup API and the
// Flight Alert web-hooks (step 5b). Web-hooks send enums as NUMBERS
// (status 2 = EnRoute, 9 = Arrived; quality [0,1]); the lookup API sends
// words. Both end up as the same words here.
//
// Data retention: AeroDataBox Pro allows caching for 7 days. Results here are
// cached in Redis for minutes only; what gets stored on bookings is handled
// as a snapshot that the daily job refreshes or deletes within 6 days.
import axios from "axios";
import Redis from "ioredis";

export type Terminal = "NORTH" | "SOUTH";

export type FlightArrival = {
  flightNumber: string; // normalised by provider, e.g. "U2 8004"
  airlineName: string | null;
  airlineIata: string | null;
  originIata: string | null;
  originName: string | null;
  scheduledArrivalUtc: string; // ISO 8601
  predictedArrivalUtc: string | null;
  revisedArrivalUtc: string | null;
  terminal: Terminal | null; // null = provider didn't say; passenger chooses
  status: string | null; // e.g. "Expected", "Arrived"
  quality: string[]; // e.g. ["Basic"] = timetable only; live data adds more
  fetchedAt: string; // ISO 8601 — drives the 6-day refresh/delete rule
  runwayArrivalUtc: string | null; // actual touchdown
  departureScheduledUtc: string | null;
  departureRevisedUtc: string | null; // estimated (or actual) off-block at origin
  departureRunwayUtc: string | null; // actual take-off
  providerUpdatedAt: string | null; // AeroDataBox "last updated" — newer data wins
};

export type LookupFailure =
  | "invalid_input"
  | "not_found"
  | "not_arriving"
  | "provider_error"
  | "daily_limit";
export type LookupResult =
  | { ok: true; flight: FlightArrival }
  | { ok: false; reason: LookupFailure };

const RAPIDAPI_HOST = "aerodatabox.p.rapidapi.com";
const BASE_URL = `https://${RAPIDAPI_HOST}`;
const REQUEST_TIMEOUT_MS = 8000;

const CACHE_TTL_FOUND_S = 600; // 10 min: passenger editing a booking doesn't re-spend units
const CACHE_TTL_NOT_FOUND_S = 300;
const MAX_DAYS_AHEAD = 180; // Pro plan future-schedule limit
const MAX_DAYS_BEHIND = 1;

// Safety valve against runaway usage (bug or abuse). Pro = 5,000 units/month
// at 2 units per call; normal use is well under 100 calls/day.
const DAILY_CALL_LIMIT = Number(process.env.FLIGHT_LOOKUP_DAILY_LIMIT ?? 300);

// ── Parsing helpers ───────────────────────────────────────────────────────
/** "EZY 8004" / "ezy-8004" / "U28004" → "EZY8004" / "U28004"; null if implausible. */
export function normaliseFlightNumber(input: string): string | null {
  const s = (input ?? "").toUpperCase().replace(/[\s-]/g, "");
  // Airline code (2–3 chars, at least one letter) + 1–4 digits + optional suffix letter.
  return /^(?=[A-Z0-9]{0,2}[A-Z])[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(s)
    ? s
    : null;
}

/** AeroDataBox times look like "2026-10-29 15:15Z" (space, not "T"). */
function parseProviderTime(t: unknown): string | null {
  const raw = typeof t === "string" ? t : (t as { utc?: string } | null)?.utc;
  if (!raw) return null;
  const d = new Date(raw.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseTerminal(t: unknown): Terminal | null {
  const s = typeof t === "string" ? t.trim().toUpperCase() : "";
  if (s === "N" || s === "NORTH") return "NORTH";
  if (s === "S" || s === "SOUTH") return "SOUTH";
  return null;
}

// Web-hook enums arrive as numbers. 2 = EnRoute and 9 = Arrived are confirmed
// live; the rest follow AeroDataBox's documented order (an unmapped number
// becomes "Unknown(<n>)" so it shows up in logs instead of being guessed).
const STATUS_NAMES = [
  "Unknown",
  "Expected",
  "EnRoute",
  "CheckIn",
  "Boarding",
  "GateClosed",
  "Departed",
  "Delayed",
  "Approaching",
  "Arrived",
  "Canceled",
  "Diverted",
];
const QUALITY_NAMES = ["Basic", "Live", "Approximate"];

function parseStatus(s: unknown): string | null {
  if (typeof s === "string") return s;
  if (typeof s === "number") return STATUS_NAMES[s] ?? `Unknown(${s})`;
  return null;
}

function parseQuality(q: unknown): string[] {
  if (!Array.isArray(q)) return [];
  return q.map((v) =>
    typeof v === "number" ? QUALITY_NAMES[v] ?? `Unknown(${v})` : String(v)
  );
}

function parseLeg(f: any, scheduled: string): FlightArrival {
  const a = f.arrival ?? {};
  return {
    flightNumber: typeof f.number === "string" ? f.number : "",
    airlineName: f.airline?.name ?? null,
    airlineIata: f.airline?.iata ?? null,
    originIata: f.departure?.airport?.iata ?? null,
    originName:
      f.departure?.airport?.municipalityName ??
      f.departure?.airport?.shortName ??
      f.departure?.airport?.name ??
      null,
    scheduledArrivalUtc: scheduled,
    predictedArrivalUtc: parseProviderTime(a.predictedTime),
    revisedArrivalUtc: parseProviderTime(a.revisedTime),
    runwayArrivalUtc: parseProviderTime(a.runwayTime),
    providerUpdatedAt: parseProviderTime(f.lastUpdatedUtc),
    departureScheduledUtc: parseProviderTime(f.departure?.scheduledTime),
    departureRevisedUtc: parseProviderTime(f.departure?.revisedTime),
    departureRunwayUtc: parseProviderTime(f.departure?.runwayTime),
    terminal: parseTerminal(a.terminal),
    status: parseStatus(f.status),
    quality: parseQuality(a.quality),
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Every leg landing at `airportIata`, parsed, earliest scheduled arrival first.
 * Used by lookups (one date) and web-hooks (may contain several dates — the
 * caller picks the leg whose scheduled London date matches its watch).
 */
export function parseArrivalLegs(
  legs: unknown,
  airportIata: string
): FlightArrival[] {
  if (!Array.isArray(legs)) return [];
  return legs
    .filter((f) => f?.arrival?.airport?.iata === airportIata)
    .map((f) => ({ f, scheduled: parseProviderTime(f.arrival?.scheduledTime) }))
    .filter((x): x is { f: any; scheduled: string } => !!x.scheduled)
    .sort((a, b) => a.scheduled.localeCompare(b.scheduled))
    .map(({ f, scheduled }) => parseLeg(f, scheduled));
}

function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const days = (d.getTime() - Date.now()) / 86_400_000;
  return days <= MAX_DAYS_AHEAD && days >= -MAX_DAYS_BEHIND - 1;
}

// ── Service ───────────────────────────────────────────────────────────────
export class FlightDataService {
  private readonly apiKey = process.env.AERODATABOX_API_KEY;

  constructor(private readonly redis: Redis) {}

  /**
   * Find a flight arriving at `airportIata` on `dateLocal` (YYYY-MM-DD, the
   * arrival date in the airport's local time).
   */
  async lookupArrival(
    flightNumberInput: string,
    dateLocal: string,
    airportIata = "LGW",
    opts: { fresh?: boolean } = {}
  ): Promise<LookupResult> {
    const number = normaliseFlightNumber(flightNumberInput);
    if (!number || !isValidDate(dateLocal))
      return { ok: false, reason: "invalid_input" };

    const cacheKey = `flight:arrival:${airportIata}:${number}:${dateLocal}`;
    const cached = opts.fresh ? null : await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as LookupResult;

    if (!this.apiKey) return { ok: false, reason: "provider_error" };

    const dayKey = `flight:lookups:${new Date().toISOString().slice(0, 10)}`;
    const calls = await this.redis.incr(dayKey);
    if (calls === 1) await this.redis.expire(dayKey, 2 * 86_400);
    if (calls > DAILY_CALL_LIMIT) return { ok: false, reason: "daily_limit" };

    let status = 0;
    let body: unknown;
    // Pro plan allows 2 requests/second; on 429 (rate limited) wait and retry once.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await axios.get(
          `${BASE_URL}/flights/number/${encodeURIComponent(
            number
          )}/${dateLocal}`,
          {
            params: {
              dateLocalRole: "Arrival",
              withAircraftImage: false,
              withLocation: false,
            },
            headers: {
              "X-RapidAPI-Key": this.apiKey,
              "X-RapidAPI-Host": RAPIDAPI_HOST,
            },
            timeout: REQUEST_TIMEOUT_MS,
            validateStatus: () => true, // handle 204/404/429 ourselves
          }
        );
        status = res.status;
        body = res.data;
        // Monthly quota left — read by the step-6b refresh guard (units floor).
        const rawUnits = res.headers?.["x-ratelimit-api-units-remaining"];
        const units = Number(rawUnits);
        if (rawUnits != null && rawUnits !== "" && Number.isFinite(units))
          await this.redis
            .set("adb:units:remaining", String(units), "EX", 2 * 86_400)
            .catch(() => undefined);
      } catch {
        return { ok: false, reason: "provider_error" }; // timeout / network
      }
      if (status !== 429) break;
      if (attempt === 1) await new Promise((r) => setTimeout(r, 1100));
    }

    let result: LookupResult;
    if (
      status === 204 ||
      status === 404 ||
      (status === 200 && Array.isArray(body) && body.length === 0)
    ) {
      result = { ok: false, reason: "not_found" };
    } else if (status !== 200 || !Array.isArray(body)) {
      return { ok: false, reason: "provider_error" }; // don't cache provider failures
    } else {
      // A flight number can have several legs; take the earliest landing here.
      const legs = parseArrivalLegs(body, airportIata);
      result = legs.length
        ? { ok: true, flight: legs[0] }
        : { ok: false, reason: "not_arriving" };
    }

    await this.redis.set(
      cacheKey,
      JSON.stringify(result),
      "EX",
      result.ok ? CACHE_TTL_FOUND_S : CACHE_TTL_NOT_FOUND_S
    );
    return result;
  }
}
