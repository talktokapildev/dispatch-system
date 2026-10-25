// backend/src/services/driveTime.service.ts
//
// "When to leave home" on departure flight pages: driving time from where the visitor leaves to
// the Gatwick terminal. The website then works out "leave by" = be-at-the-airport time − drive −
// spare time. Same Google Directions call (and daily cap) as the quote calculator, no live
// traffic: the early-morning drives this is for are close to free-flow times.
//
// The visitor either taps a nearby town (fixed point, no Places call) or picks an address from
// our autocomplete (a Google place ID). Results cached 30 days per start point and terminal.
import type Redis from "ioredis";
import { MapsService } from "./maps.service";
import { DIRECTIONS_DAILY_CAP, QuoteDeps, QuoteError, resolvePlace, withinDailyCap } from "./webQuote.service";
import { GATWICK, SERVICE_RADIUS_MILES, kmToMiles, straightLineMiles } from "./webQuoteRules";

const ROUTE_TTL_S = 30 * 86_400;

/** Where cars drop off at each terminal (approximate forecourt positions). */
export const TERMINALS = {
  NORTH: { lat: 51.162, lng: -0.1777 },
  SOUTH: { lat: 51.1564, lng: -0.161 },
} as const;
export type TerminalKey = keyof typeof TERMINALS;

/** Quick-pick towns on the website (town centres). */
export const TOWNS: Record<string, { name: string; lat: number; lng: number }> = {
  crawley: { name: "Crawley", lat: 51.1124, lng: -0.1831 },
  horley: { name: "Horley", lat: 51.1741, lng: -0.1631 },
  horsham: { name: "Horsham", lat: 51.0629, lng: -0.3259 },
  redhill: { name: "Redhill", lat: 51.24, lng: -0.1703 },
  reigate: { name: "Reigate", lat: 51.237, lng: -0.2059 },
  "east-grinstead": { name: "East Grinstead", lat: 51.126, lng: -0.0074 },
  "haywards-heath": { name: "Haywards Heath", lat: 50.999, lng: -0.1063 },
  brighton: { name: "Brighton", lat: 50.8225, lng: -0.1372 },
};

export type DriveTimeInput = { terminal: TerminalKey } & ({ town: string } | { placeId: string; session?: string });
export type DriveTimeResult =
  | { status: "OK"; from: string; minutes: number; miles: number }
  | { status: "OUT_OF_AREA"; from: string }
  | { status: "BUSY" };

type Deps = Pick<QuoteDeps, "prisma" | "redis" | "log" | "now"> & {
  maps?: Pick<MapsService, "getPlaceDetails" | "getDirections">;
};

export async function driveTime(deps: Deps, input: DriveTimeInput): Promise<DriveTimeResult> {
  const now = (deps.now ?? (() => new Date()))();
  const maps = deps.maps ?? new MapsService();
  const redis = deps.redis as Redis;

  let from: { address: string; lat: number; lng: number };
  let startKey: string;
  if ("town" in input) {
    const t = TOWNS[input.town];
    if (!t) throw new QuoteError("Please choose a town from the list.");
    from = { address: t.name, lat: t.lat, lng: t.lng };
    startKey = `town:${input.town}`;
  } else {
    from = await resolvePlace(deps as QuoteDeps, maps as any, input.placeId, input.session);
    startKey = `place:${input.placeId}`;
  }

  // We only drive people from places near Gatwick.
  if (straightLineMiles(from, GATWICK) > SERVICE_RADIUS_MILES) return { status: "OUT_OF_AREA", from: from.address };

  const cacheKey = `drivetime:${startKey}:${input.terminal}`;
  const hit = await redis.get(cacheKey).catch(() => null);
  if (hit) {
    const r = JSON.parse(hit) as { minutes: number; miles: number };
    return { status: "OK", from: from.address, ...r };
  }
  if (!(await withinDailyCap(redis, "directions", DIRECTIONS_DAILY_CAP, now, deps.log))) return { status: "BUSY" };
  try {
    const d = await maps.getDirections({ lat: from.lat, lng: from.lng }, TERMINALS[input.terminal]);
    const r = { minutes: d.durationMinutes, miles: Math.round(kmToMiles(d.distanceKm) * 10) / 10 };
    await redis.set(cacheKey, JSON.stringify(r), "EX", ROUTE_TTL_S).catch(() => undefined);
    return { status: "OK", from: from.address, ...r };
  } catch {
    throw new QuoteError("We couldn't find a road route from there.");
  }
}
