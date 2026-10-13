// backend/src/services/jobDistance.service.ts
//
// Driver job board — distance + drive time shown on job cards / job detail:
//   trip      pickup → dropoff          (fixed per job; cached 24h)
//   toPickup  driver's location → pickup (now, no live traffic; cached 10 min
//             per job and ~500 m location cell, so pull-to-refresh is free)
// Google Directions (same API the app already uses). Failures → null (cached
// 5 min so a Maps outage doesn't turn every refresh into N failing calls).
import Redis from "ioredis";
import { MapsService } from "./maps.service";

export type Leg = { miles: number; minutes: number };
export type JobDistances = { toPickup: Leg | null; trip: Leg | null };

type JobLoc = {
  id: string;
  pickupLatitude: number;
  pickupLongitude: number;
  dropoffLatitude: number;
  dropoffLongitude: number;
};

const KM_PER_MILE = 1.609344;
const TRIP_TTL_S = 24 * 3600;
const TO_PICKUP_TTL_S = 10 * 60;
const FAIL_TTL_S = 5 * 60;
const MAX_JOBS = 30; // a busy board: don't fan out unbounded Google calls
const CONCURRENCY = 5;

/** ~500 m grid cell, so small GPS jitter reuses the cached value. */
const cell = (v: number) => (Math.round(v * 200) / 200).toFixed(3);

export function parseCoords(q: {
  lat?: string;
  lng?: string;
}): { lat: number; lng: number } | null {
  const lat = Number(q.lat);
  const lng = Number(q.lng);
  if (!q.lat || !q.lng || !Number.isFinite(lat) || !Number.isFinite(lng))
    return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

async function cachedLeg(
  redis: Redis,
  maps: MapsService,
  key: string,
  ttl: number,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): Promise<Leg | null> {
  const hit = await redis.get(key).catch(() => null);
  if (hit) return hit === "x" ? null : (JSON.parse(hit) as Leg);
  try {
    const r = await maps.getDirections(from, to);
    const leg = {
      miles: Math.round((r.distanceKm / KM_PER_MILE) * 10) / 10,
      minutes: r.durationMinutes,
    };
    await redis.set(key, JSON.stringify(leg), "EX", ttl).catch(() => {});
    return leg;
  } catch {
    await redis.set(key, "x", "EX", FAIL_TTL_S).catch(() => {});
    return null;
  }
}

export async function jobDistances(
  redis: Redis,
  jobs: JobLoc[],
  driver: { lat: number; lng: number } | null,
  maps: MapsService = new MapsService()
): Promise<Map<string, JobDistances>> {
  const out = new Map<string, JobDistances>();
  const list = jobs.slice(0, MAX_JOBS);
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    await Promise.all(
      list.slice(i, i + CONCURRENCY).map(async (j) => {
        const pickup = { lat: j.pickupLatitude, lng: j.pickupLongitude };
        const [trip, toPickup] = await Promise.all([
          cachedLeg(redis, maps, `jobdist:trip:${j.id}`, TRIP_TTL_S, pickup, {
            lat: j.dropoffLatitude,
            lng: j.dropoffLongitude,
          }),
          driver
            ? cachedLeg(
                redis,
                maps,
                `jobdist:to:${j.id}:${cell(driver.lat)}:${cell(driver.lng)}`,
                TO_PICKUP_TTL_S,
                driver,
                pickup
              )
            : Promise.resolve(null),
        ]);
        out.set(j.id, { trip, toPickup });
      })
    );
  }
  return out;
}
