// backend/src/services/caaPunctuality.service.ts
//
// "How reliable is this route?" — CAA punctuality statistics on the website's flight and
// airline pages. Rules live in caaPunctualityRules.ts.
//
//   Database  CaaPunctuality   Gatwick rows of the CAA monthly CSV, up to 24 months.
//             CaaAirportMonth  one total per UK airport, direction and month (the /gatwick/delays
//                              comparison), from the same files.
//                              Written ONLY by scripts/caa-punctuality.ts (run by hand once a
//                              month, after the CAA publishes a new month — about 2 months' lag).
//   Redis     airports:seen    hash IATA → { city, airportName, municipality, country, seenAt },
//                              written on every flight board refresh; entries older than 30
//                              days are ignored. Lets CAA names ("MALAGA") be matched to IATA.
//             caa:summary      the built summary the pages read (no expiry; rebuilt hourly)
//
// The summary is rebuilt 3 minutes after start-up and every hour (cheap: one query of ~12 months
// of Gatwick rows). Airports/airlines that couldn't be matched are logged as
// "[CAA] unmatched ..." whenever that list changes — add them to CAA_AIRPORT_OVERRIDES.
import Redis from "ioredis";
import { PrismaClient } from "@prisma/client";
import type { BoardFlight } from "./flightBoardRules";
import { getTerminalSummary } from "./airlineTerminals.service";
import {
  addMonths,
  AirportMonth,
  buildSummary,
  CaaRow,
  CaaSummary,
  KnownAirline,
  SeenAirport,
  WINDOW_MONTHS,
} from "./caaPunctualityRules";

const KEY_SEEN = "airports:seen";
const KEY_SUMMARY = "caa:summary";
const SEEN_DAYS = 30;
const READ_CACHE_MS = 60_000;

type Log = { warn: (msg: string) => void };
export type CaaDeps = { redis: Redis; prisma: PrismaClient; log: Log };

type SeenValue = Omit<SeenAirport, "iata"> & { seenAt: string };

/** After each board refresh: remember the other-end airports (names only, no flight data). */
export async function recordAirportsSeen(redis: Redis, flights: BoardFlight[], now: Date = new Date()): Promise<number> {
  const fields: Record<string, string> = {};
  for (const f of flights) {
    const iata = f.other.iata?.toUpperCase();
    if (!iata || !/^[A-Z0-9]{3}$/.test(iata) || fields[iata]) continue;
    const v: SeenValue = {
      city: f.other.name ?? null,
      airportName: f.other.airportName ?? null,
      municipality: f.other.municipality ?? null,
      country: f.other.countryCode ?? null,
      seenAt: now.toISOString(),
    };
    fields[iata] = JSON.stringify(v);
  }
  const n = Object.keys(fields).length;
  if (!n) return 0;
  await redis.hset(KEY_SEEN, fields);
  await redis.expire(KEY_SEEN, (SEEN_DAYS + 1) * 86_400);
  return n;
}

async function readAirportsSeen(redis: Redis, now: Date): Promise<SeenAirport[]> {
  const all = await redis.hgetall(KEY_SEEN);
  const cutoff = now.getTime() - SEEN_DAYS * 86_400_000;
  const out: SeenAirport[] = [];
  const stale: string[] = [];
  for (const [iata, raw] of Object.entries(all ?? {})) {
    try {
      const v = JSON.parse(raw) as SeenValue;
      if (Date.parse(v.seenAt) < cutoff) {
        stale.push(iata);
        continue;
      }
      out.push({ iata, city: v.city, airportName: v.airportName, municipality: v.municipality, country: v.country });
    } catch {
      stale.push(iata);
    }
  }
  if (stale.length) await redis.hdel(KEY_SEEN, ...stale).catch(() => undefined);
  return out;
}

async function knownAirlines(redis: Redis): Promise<KnownAirline[]> {
  const t = await getTerminalSummary(redis);
  return (t?.airlines ?? []).map((a) => ({ slug: a.slug, name: a.name }));
}

let lastLogged = "";

/** Rebuilds caa:summary from the database. Returns the summary (also for scripts/tests). */
export async function rebuildCaaSummary(deps: CaaDeps, now: Date = new Date()): Promise<CaaSummary> {
  const { prisma, redis, log } = deps;
  const latest = await prisma.caaPunctuality.aggregate({ _max: { period: true } });
  const to = latest._max.period;
  const window = to ? { period: { gte: addMonths(to, -(WINDOW_MONTHS - 1)), lte: to } } : null;
  const rows: CaaRow[] = window
    ? ((await prisma.caaPunctuality.findMany({ where: window })) as unknown as CaaRow[])
    : [];
  // UK airport totals (CaaAirportMonth); empty until the months are imported with this version.
  // A database without the table yet (deploy before migration) just has no comparison.
  const airportMonths: AirportMonth[] = window
    ? ((await prisma.caaAirportMonth.findMany({ where: window }).catch((err: unknown) => {
        log.warn(`[CAA] UK airport totals unavailable: ${(err as Error)?.message?.split("\n")[0] ?? err}`);
        return [];
      })) as unknown as AirportMonth[])
    : [];
  const summary = buildSummary(rows, await readAirportsSeen(redis, now), await knownAirlines(redis), now, airportMonths);
  await redis.set(KEY_SUMMARY, JSON.stringify(summary));
  cache = { at: Date.now(), summary };

  const line =
    `[CAA] summary ${summary.from ?? "-"}..${summary.to ?? "-"} (${summary.months} months): ` +
    `${Object.keys(summary.routes).length} routes, ${Object.keys(summary.airlines).length} airlines, ` +
    `${summary.ukAirports?.length ?? 0} UK airports; ` +
    `unmatched airports ${summary.unmatchedAirports.length}, airlines ${summary.unmatchedAirlines.length}`;
  const detail = [
    ...summary.unmatchedAirports
      .slice(0, 15)
      .map((u) => `airport "${u.name}" (${u.country}, ${u.flights} flights${u.candidates?.length ? `, could be ${u.candidates.join("/")}` : ""})`),
    ...summary.unmatchedAirlines.slice(0, 10).map((u) => `airline "${u.name}" (${u.flights} flights)`),
  ];
  const fingerprint = line + detail.join("|");
  if (fingerprint !== lastLogged) {
    lastLogged = fingerprint;
    log.warn(line);
    if (detail.length) log.warn(`[CAA] unmatched (busiest first): ${detail.join("; ")}`);
  }
  return summary;
}

// Pages read the summary on every render; parse it at most once a minute per process.
let cache: { at: number; summary: CaaSummary | null } | null = null;

export async function getCaaSummary(redis: Redis): Promise<CaaSummary | null> {
  if (cache && Date.now() - cache.at < READ_CACHE_MS) return cache.summary;
  let summary: CaaSummary | null = null;
  try {
    const raw = await redis.get(KEY_SUMMARY);
    const s = raw ? (JSON.parse(raw) as CaaSummary) : null;
    summary = s && typeof s.routes === "object" ? s : null;
  } catch {
    summary = null;
  }
  cache = { at: Date.now(), summary };
  return summary;
}

/** Rebuild shortly after start-up (once the first board refresh has filled airports:seen) and hourly. */
export function startCaaPunctuality(deps: CaaDeps): void {
  const run = async () => {
    try {
      await rebuildCaaSummary(deps);
    } catch (err) {
      deps.log.warn(`[CAA] rebuild failed: ${(err as Error)?.message ?? err}`);
    }
  };
  setTimeout(run, 3 * 60_000);
  setInterval(run, 60 * 60_000);
}
