// backend/src/services/airlineTerminals.service.ts
//
// "Which Gatwick terminal?" pages on the website. After every flight board refresh (no extra
// provider calls) each operating flight is remembered for 7 days in Redis, and one small
// per-airline summary is rebuilt for the pages to read:
//
//   airlineterm:obs       compact records of the last 7 days' flights (expires after 8 days)
//   airlineterm:summary   { updatedAt, airlines: AirlineTerminal[] }  (what the pages read)
//
// Rules (which terminal, moves between terminals, which airlines get a page) live in
// airlineTerminalRules.ts.
import Redis from "ioredis";
import type { BoardFlight } from "./flightBoardRules";
import {
  AirlineTerminal,
  mergeObservations,
  Observation,
  observationsOf,
  summarise,
  WINDOW_DAYS,
} from "./airlineTerminalRules";

const KEY_OBS = "airlineterm:obs";
const KEY_SUMMARY = "airlineterm:summary";
const TTL_S = (WINDOW_DAYS + 1) * 86_400;

export type TerminalSummary = { updatedAt: string; airlines: AirlineTerminal[] };

// Stored as arrays to keep the 7-day record small (a few thousand flights).
type Packed = [string, string, string, string | null, "A" | "D", string, "N" | "S" | null, string];
const pack = (o: Observation): Packed => [
  o.id, o.slug, o.name, o.code, o.direction === "ARRIVAL" ? "A" : "D", o.scheduledUtc,
  o.terminal === "NORTH" ? "N" : o.terminal === "SOUTH" ? "S" : null, o.displayNumber,
];
const unpack = (p: Packed): Observation => ({
  id: p[0], slug: p[1], name: p[2], code: p[3], direction: p[4] === "A" ? "ARRIVAL" : "DEPARTURE",
  scheduledUtc: p[5], terminal: p[6] === "N" ? "NORTH" : p[6] === "S" ? "SOUTH" : null, displayNumber: p[7],
});

async function readObservations(redis: Redis): Promise<Observation[]> {
  const raw = await redis.get(KEY_OBS);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((p) => Array.isArray(p) && p.length === 8).map(unpack) : [];
  } catch {
    return [];
  }
}

/** After each board refresh: add this board's flights and rebuild the per-airline summary. */
export async function recordAirlineTerminals(redis: Redis, flights: BoardFlight[], now: Date = new Date()): Promise<number> {
  const merged = mergeObservations(await readObservations(redis), observationsOf(flights), now);
  const summary: TerminalSummary = { updatedAt: now.toISOString(), airlines: summarise(merged) };
  await redis.set(KEY_OBS, JSON.stringify(merged.map(pack)), "EX", TTL_S);
  await redis.set(KEY_SUMMARY, JSON.stringify(summary), "EX", TTL_S);
  return merged.length;
}

export async function getTerminalSummary(redis: Redis): Promise<TerminalSummary | null> {
  const raw = await redis.get(KEY_SUMMARY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as TerminalSummary;
    return Array.isArray(s?.airlines) ? s : null;
  } catch {
    return null;
  }
}
