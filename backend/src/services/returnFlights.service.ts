// backend/src/services/returnFlights.service.ts
//
// "Coming back through Gatwick?" on departure flight pages: which flights from that airport
// landed at Gatwick in the last 7 days (the caching limit in our AeroDataBox plan terms), the
// same airline first. Written after every board refresh (no extra provider calls). Redis only:
//
//   returns:<ORIGIN IATA>   JSON list of compact records, one per arrival flight number,
//                           newest copy wins; entries not seen for 7 days are dropped.
import Redis from "ioredis";
import { BoardFlight, isFlightNumber, londonDate } from "./flightBoardRules";
import { airlineSlug } from "./airlineTerminalRules";

const DAYS = 7;
const TTL_S = (DAYS + 1) * 86_400;
const key = (iata: string) => `returns:${iata.toUpperCase()}`;

export type ReturnFlight = {
  displayNumber: string; // "EZY8316"
  airline: { name: string | null; iata: string | null; slug: string | null };
  usualTimeUk: string; // scheduled at Gatwick, "13:40"
  terminal: "NORTH" | "SOUTH" | null;
  lastDate: string; // UK date last scheduled
  seenAt: string; // ISO
};

function ukHm(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** Board refresh → arrivals grouped by origin airport (operating flights only). */
export function returnsByOrigin(flights: BoardFlight[], now: Date): Map<string, ReturnFlight[]> {
  const by = new Map<string, ReturnFlight[]>();
  for (const f of flights) {
    if (f.direction !== "ARRIVAL" || f.codeshare === "CODESHARE" || !isFlightNumber(f.number) || !f.other.iata) continue;
    const r: ReturnFlight = {
      displayNumber: f.displayNumber,
      airline: { name: f.airline.name, iata: f.airline.iata, slug: airlineSlug(f.airline) },
      usualTimeUk: ukHm(f.lgw.scheduledUtc),
      terminal: f.lgw.terminal,
      lastDate: londonDate(new Date(f.lgw.scheduledUtc)),
      seenAt: now.toISOString(),
    };
    const k = f.other.iata.toUpperCase();
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return by;
}

/** Old list + new records → one per flight number (newest wins), nothing older than 7 days. */
export function mergeReturns(old: ReturnFlight[], fresh: ReturnFlight[], now: Date): ReturnFlight[] {
  const cutoff = now.getTime() - DAYS * 86_400_000;
  const m = new Map<string, ReturnFlight>();
  for (const r of [...old, ...fresh]) {
    const prev = m.get(r.displayNumber);
    // Keep a stated terminal if the newer copy has none.
    m.set(r.displayNumber, prev && !r.terminal && prev.terminal ? { ...r, terminal: prev.terminal } : r);
  }
  return [...m.values()].filter((r) => Date.parse(r.seenAt) >= cutoff);
}

/** Same airline first, then by usual time; at most `limit`. */
export function rankReturns(list: ReturnFlight[], slug: string | null, limit = 3): ReturnFlight[] {
  return [...list]
    .sort((a, b) => {
      const sa = slug && a.airline.slug === slug ? 0 : 1;
      const sb = slug && b.airline.slug === slug ? 0 : 1;
      return sa - sb || a.usualTimeUk.localeCompare(b.usualTimeUk);
    })
    .slice(0, limit);
}

async function readList(redis: Redis, iata: string): Promise<ReturnFlight[]> {
  const raw = await redis.get(key(iata));
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** After each board refresh. Returns how many origin airports were updated. */
export async function recordReturns(redis: Redis, flights: BoardFlight[], now: Date = new Date()): Promise<number> {
  const by = returnsByOrigin(flights, now);
  for (const [iata, fresh] of by) {
    const merged = mergeReturns(await readList(redis, iata), fresh, now);
    await redis.set(key(iata), JSON.stringify(merged), "EX", TTL_S);
  }
  return by.size;
}

/** Flights from `iata` that landed at Gatwick in the last 7 days, best matches first. */
export async function readReturns(redis: Redis, iata: string | null, slug: string | null, now: Date = new Date()): Promise<ReturnFlight[]> {
  if (!iata) return [];
  return rankReturns(mergeReturns(await readList(redis, iata), [], now), slug);
}
