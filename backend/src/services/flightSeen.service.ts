// backend/src/services/flightSeen.service.ts
//
// "Seen recently": every flight on the Gatwick board is remembered for 7 days (the caching
// limit in our AeroDataBox plan terms), so its page (/flight-status/EZY8687) stays useful
// when today's flight isn't in the live 12-hour window: "EZY8687 from Amsterdam usually lands
// at North Terminal around 21:10". Google then sees one steady page per regular flight instead
// of a page that comes and goes.
//
// Written on every board refresh (no extra provider calls). Redis only:
//   flightseen:<KEY>:A | :D    one record per searchable form of the number (EZY8687, U28687)
//                              and direction, expires 7 days after the flight was last seen
//   flightseen:index           sorted set of operating flights' page numbers by last seen
//                              (the website's sitemap)
import Redis from "ioredis";
import { BoardFlight, Direction, isFlightNumber, matchKey } from "./flightBoardRules";

export const SEEN_DAYS = 7;
const TTL_S = SEEN_DAYS * 86_400;
const INDEX = "flightseen:index";
const SITEMAP_MAX = 3000;

export type SeenFlight = {
  number: string; // provider form, "U2 8687"
  displayNumber: string; // page/ticket form, "EZY8687"
  direction: Direction;
  airline: { name: string | null; iata: string | null };
  other: { iata: string | null; name: string | null; countryCode: string | null; timeZone: string | null };
  terminal: "NORTH" | "SOUTH" | null;
  terminalInferred: boolean;
  usualTimeUk: string; // scheduled at Gatwick, UK clock, "21:10"
  aircraft: string | null;
  lastDate: string; // UK date it was last scheduled, "2026-10-23"
  seenAt: string; // ISO
};

const key = (k: string, d: Direction) => `flightseen:${k}:${d === "ARRIVAL" ? "A" : "D"}`;

function ukParts(iso: string): { date: string; hm: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "00";
  return { date: `${p("year")}-${p("month")}-${p("day")}`, hm: `${p("hour")}:${p("minute")}` };
}

export function toSeen(f: BoardFlight, now: Date): SeenFlight {
  const uk = ukParts(f.lgw.scheduledUtc);
  return {
    number: f.number,
    displayNumber: f.displayNumber,
    direction: f.direction,
    airline: { name: f.airline.name, iata: f.airline.iata },
    other: { iata: f.other.iata, name: f.other.name, countryCode: f.other.countryCode, timeZone: f.other.timeZone },
    terminal: f.lgw.terminal,
    terminalInferred: f.lgw.terminalInferred,
    usualTimeUk: uk.hm,
    aircraft: f.aircraft,
    lastDate: uk.date,
    seenAt: now.toISOString(),
  };
}

/** After each board refresh: remember every real flight on it (codeshare numbers too, so they're searchable). */
export async function recordSeen(redis: Redis, flights: BoardFlight[], now: Date = new Date()): Promise<number> {
  const writes: [string, string][] = [];
  const index: [number, string][] = [];
  for (const f of flights) {
    if (!isFlightNumber(f.number)) continue;
    const rec = JSON.stringify(toSeen(f, now));
    for (const k of new Set(f.keys)) writes.push([key(k, f.direction), rec]);
    if (f.codeshare !== "CODESHARE") index.push([now.getTime(), f.displayNumber]);
  }
  const pipe = (redis as any).pipeline?.();
  if (pipe) {
    for (const [k, v] of writes) pipe.set(k, v, "EX", TTL_S);
    for (const [score, member] of index) pipe.zadd(INDEX, score, member);
    pipe.zremrangebyscore(INDEX, 0, now.getTime() - TTL_S * 1000);
    await pipe.exec();
  } else {
    for (const [k, v] of writes) await redis.set(k, v, "EX", TTL_S);
    for (const [score, member] of index) await redis.zadd(INDEX, score, member);
    await redis.zremrangebyscore(INDEX, 0, now.getTime() - TTL_S * 1000);
  }
  return writes.length;
}

/** What we remember about a flight number (arrival and/or departure), most recent first. */
export async function readSeen(redis: Redis, input: string): Promise<SeenFlight[]> {
  const k = matchKey(input);
  if (!k) return [];
  const raw = await redis.mget(key(k, "ARRIVAL"), key(k, "DEPARTURE"));
  const out: SeenFlight[] = [];
  for (const r of raw) {
    if (!r) continue;
    try {
      out.push(JSON.parse(r) as SeenFlight);
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => b.seenAt.localeCompare(a.seenAt));
}

/** Page numbers of flights seen in the last 7 days (for the website sitemap). */
export async function listSeen(redis: Redis, now: Date = new Date()): Promise<string[]> {
  const from = now.getTime() - TTL_S * 1000;
  const list = await redis.zrangebyscore(INDEX, from, "+inf");
  return list.slice(-SITEMAP_MAX);
}
