// backend/src/services/webQuote.service.ts
//
// Website quote calculator (orangeride.co.uk).
//   - The browser sends Google place IDs (from our autocomplete proxy) + optional UK date/time.
//   - WE resolve the places and get the road distance/time (Google Directions, same call the
//     passenger app makes, no live traffic), then price with PricingService.estimateFare —
//     the same rules the app uses. The browser never sends miles or a price.
//   - Shown as "From £X" (rounded down). Exact fare is confirmed on WhatsApp.
//   - Every answer gets a ref (Q-7K3M) stored in WebQuote for 30 days (route, time, price;
//     no name or phone), so a WhatsApp message quoting the ref can be looked up.
// Cost guards: places + routes cached 24h in Redis; a daily cap on Directions calls
// (WEB_QUOTE_DAILY_CAP, default 500) and on autocomplete calls (WEB_QUOTE_AUTOCOMPLETE_DAILY_CAP,
// default 3000). Over a cap → "BUSY" (the website falls back to WhatsApp).
import { PrismaClient, Prisma } from "@prisma/client";
import type Redis from "ioredis";
import { MapsService } from "./maps.service";
import { PricingService } from "./pricing.service";
import {
  MAX_TRIP_MILES,
  checkPickupTime,
  defaultPricingTime,
  fromPrice,
  kmToMiles,
  makeQuoteRef,
  nearGatwick,
} from "./webQuoteRules";

const PLACE_TTL_S = 24 * 3600;
const ROUTE_TTL_S = 24 * 3600;
const COUNTER_TTL_S = 2 * 24 * 3600;
const MILES_PER_KM = 0.621371;

export const DIRECTIONS_DAILY_CAP = Number(process.env.WEB_QUOTE_DAILY_CAP ?? 500);
export const AUTOCOMPLETE_DAILY_CAP = Number(process.env.WEB_QUOTE_AUTOCOMPLETE_DAILY_CAP ?? 3000);

export class QuoteError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

export type QuoteInput = {
  pickupPlaceId: string;
  dropoffPlaceId: string;
  date?: string; // "YYYY-MM-DD", UK
  time?: string; // "HH:MM", UK
  passengers: number;
  bags: number;
  sessionToken?: string;
};

type Place = { address: string; lat: number; lng: number };

export type QuoteResult =
  | {
      status: "QUOTED";
      ref: string;
      pickupAddress: string;
      dropoffAddress: string;
      miles: number;
      minutes: number;
      fromPrice: number;
      pickupAt: string | null; // ISO, when the visitor chose a time
      premiumLabel: string | null; // e.g. "Night rate premium (25%)"
      tooSoon: boolean; // less than 24h notice
    }
  | { status: "OUT_OF_AREA"; ref: string; pickupAddress: string; dropoffAddress: string }
  | { status: "BUSY" };

export type QuoteDeps = {
  prisma: PrismaClient;
  redis: Redis;
  maps?: Pick<MapsService, "getPlaceDetails" | "getDirections" | "autocomplete">;
  pricing?: Pick<PricingService, "estimateFare">;
  now?: () => Date;
  log?: { warn: (...a: any[]) => void };
};

/** "2026-10-22" in London (the daily counters reset at UK midnight). */
function londonDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
}

/** Count one call against a daily cap; false (and one log line) once it's exceeded. */
async function withinDailyCap(
  redis: Redis,
  name: string,
  cap: number,
  now: Date,
  log?: QuoteDeps["log"]
): Promise<boolean> {
  const key = `webquote:cap:${name}:${londonDay(now)}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, COUNTER_TTL_S);
  if (n === cap + 1) log?.warn(`[WebQuote] daily ${name} cap (${cap}) reached`);
  return n <= cap;
}

export async function autocompletePlaces(
  deps: QuoteDeps,
  q: string,
  sessionToken: string
): Promise<{ placeId: string; mainText: string; secondaryText: string }[] | "BUSY"> {
  const now = (deps.now ?? (() => new Date()))();
  const maps = deps.maps ?? new MapsService();
  if (!(await withinDailyCap(deps.redis, "autocomplete", AUTOCOMPLETE_DAILY_CAP, now, deps.log)))
    return "BUSY";
  const list = await maps.autocomplete(q, sessionToken);
  return list.slice(0, 5).map((p) => ({
    placeId: p.placeId,
    mainText: p.mainText,
    secondaryText: p.secondaryText ?? "",
  }));
}

async function resolvePlace(
  deps: QuoteDeps,
  maps: NonNullable<QuoteDeps["maps"]>,
  placeId: string,
  sessionToken?: string
): Promise<Place> {
  const key = `webquote:place:${placeId}`;
  const hit = await deps.redis.get(key).catch(() => null);
  if (hit) return JSON.parse(hit) as Place;
  try {
    const r = await maps.getPlaceDetails(placeId, sessionToken);
    const place = { address: r.address, lat: r.latitude, lng: r.longitude };
    await deps.redis.set(key, JSON.stringify(place), "EX", PLACE_TTL_S).catch(() => {});
    return place;
  } catch {
    throw new QuoteError("We couldn't find that address. Please pick it from the list.");
  }
}

async function routeBetween(
  deps: QuoteDeps,
  maps: NonNullable<QuoteDeps["maps"]>,
  ids: [string, string],
  a: Place,
  b: Place,
  now: Date
): Promise<{ km: number; minutes: number } | "BUSY"> {
  const key = `webquote:route:${ids[0]}:${ids[1]}`;
  const hit = await deps.redis.get(key).catch(() => null);
  if (hit) return JSON.parse(hit);
  if (!(await withinDailyCap(deps.redis, "directions", DIRECTIONS_DAILY_CAP, now, deps.log)))
    return "BUSY";
  try {
    const r = await maps.getDirections({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
    const route = { km: r.distanceKm, minutes: r.durationMinutes };
    await deps.redis.set(key, JSON.stringify(route), "EX", ROUTE_TTL_S).catch(() => {});
    return route;
  } catch {
    throw new QuoteError("We couldn't find a road route between those places.");
  }
}

/** Create the WebQuote row with a fresh ref (retry on the rare clash). */
async function saveQuote(
  prisma: PrismaClient,
  data: Omit<Prisma.WebQuoteCreateInput, "ref">
): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const ref = makeQuoteRef();
    try {
      await prisma.webQuote.create({ data: { ...data, ref } });
      return ref;
    } catch (e: any) {
      if (e?.code !== "P2002") throw e;
    }
  }
  throw new QuoteError("Please try again.", 503);
}

export async function quoteTrip(deps: QuoteDeps, input: QuoteInput): Promise<QuoteResult> {
  const now = (deps.now ?? (() => new Date()))();
  const maps = deps.maps ?? new MapsService();
  const pricing = deps.pricing ?? new PricingService(deps.prisma, deps.redis);

  const time = checkPickupTime(input.date, input.time, now);
  if (!time.ok) throw new QuoteError(time.error);
  if (input.pickupPlaceId === input.dropoffPlaceId)
    throw new QuoteError("Pickup and drop-off are the same place.");

  const [pickup, dropoff] = await Promise.all([
    resolvePlace(deps, maps, input.pickupPlaceId, input.sessionToken),
    resolvePlace(deps, maps, input.dropoffPlaceId, input.sessionToken),
  ]);

  const base = {
    pickupPlaceId: input.pickupPlaceId,
    pickupAddress: pickup.address,
    pickupLat: pickup.lat,
    pickupLng: pickup.lng,
    dropoffPlaceId: input.dropoffPlaceId,
    dropoffAddress: dropoff.address,
    dropoffLat: dropoff.lat,
    dropoffLng: dropoff.lng,
    pickupAt: time.pickupAt,
    passengers: input.passengers,
    bags: input.bags,
  };
  const outOfArea = async (miles?: number, minutes?: number): Promise<QuoteResult> => {
    const ref = await saveQuote(deps.prisma, {
      ...base,
      miles: miles ?? null,
      minutes: minutes ?? null,
      status: "OUT_OF_AREA",
    });
    return {
      status: "OUT_OF_AREA",
      ref,
      pickupAddress: pickup.address,
      dropoffAddress: dropoff.address,
    };
  };

  // Straight-line check first: no Directions call for trips nowhere near us.
  if (!nearGatwick(pickup, dropoff)) return outOfArea();

  const route = await routeBetween(
    deps,
    maps,
    [input.pickupPlaceId, input.dropoffPlaceId],
    pickup,
    dropoff,
    now
  );
  if (route === "BUSY") return { status: "BUSY" };
  const miles = kmToMiles(route.km);
  if (miles > MAX_TRIP_MILES) return outOfArea(miles, route.minutes);

  const fareAt = (at: Date) =>
    pricing.estimateFare({
      distanceMiles: route.km * MILES_PER_KM, // unrounded, exactly as the app sends it
      durationMinutes: route.minutes,
      scheduledAt: at,
      pickupLatitude: pickup.lat,
      pickupLongitude: pickup.lng,
      dropoffLatitude: dropoff.lat,
      dropoffLongitude: dropoff.lng,
    });

  let estimate;
  if (time.pickupAt) {
    estimate = await fareAt(time.pickupAt);
  } else {
    // Everyday daytime price: midday tomorrow, or the next day without a holiday premium.
    for (let day = 1; day <= 7; day++) {
      estimate = await fareAt(defaultPricingTime(now, day));
      if (estimate.timePremiumAmount <= 0) break;
    }
  }
  const total = estimate!.total;
  const price = fromPrice(total);
  const premiumLabel =
    time.pickupAt && estimate!.timePremiumAmount > 0 ? estimate!.timePremiumLabel : null;

  const ref = await saveQuote(deps.prisma, {
    ...base,
    miles,
    minutes: route.minutes,
    fareTotal: total,
    fromPrice: price,
    premiumLabel,
    status: "QUOTED",
  });
  return {
    status: "QUOTED",
    ref,
    pickupAddress: pickup.address,
    dropoffAddress: dropoff.address,
    miles,
    minutes: route.minutes,
    fromPrice: price,
    pickupAt: time.pickupAt ? time.pickupAt.toISOString() : null,
    premiumLabel,
    tooSoon: time.tooSoon,
  };
}
