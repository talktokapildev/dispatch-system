// backend/src/utils/airportPickup.ts
//
// Shared helpers for airport pickups (flight capture):
//   - pickup buffer settings (minutes after landing), stored in SystemSetting
//   - surcharge-zone containment check, mirroring PricingService's matching
//     rule (polygon takes priority, otherwise radius), so "is this an airport
//     pickup" and "does it get the airport charge" can never disagree.
import { PrismaClient } from "@prisma/client";

export type LatLng = { lat: number; lng: number };

export const BUFFER_KEYS = {
  hand: "flightBufferHandMinutes",
  checked: "flightBufferCheckedMinutes",
} as const;

export const BUFFER_DEFAULTS = { hand: 30, checked: 45 };
export const BUFFER_MIN = 10;
export const BUFFER_MAX = 180;

export type FlightBuffers = { hand: number; checked: number };

/** Reads buffer minutes from SystemSetting, falling back to defaults if unset or invalid. */
export async function getFlightBuffers(
  prisma: PrismaClient
): Promise<FlightBuffers> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [BUFFER_KEYS.hand, BUFFER_KEYS.checked] } },
  });
  const read = (key: string, fallback: number) => {
    const v = Number(rows.find((r) => r.key === key)?.value);
    return Number.isFinite(v) && v >= BUFFER_MIN && v <= BUFFER_MAX
      ? Math.round(v)
      : fallback;
  };
  return {
    hand: read(BUFFER_KEYS.hand, BUFFER_DEFAULTS.hand),
    checked: read(BUFFER_KEYS.checked, BUFFER_DEFAULTS.checked),
  };
}

// ── Geometry ─────────────────────────────────────────────────────────────
export function pointInPolygon(
  lat: number,
  lng: number,
  poly: LatLng[]
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const crosses = a.lat > lat !== b.lat > lat;
    if (
      crosses &&
      lng < ((b.lng - a.lng) * (lat - a.lat)) / (b.lat - a.lat) + a.lng
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

type ZoneLike = {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  polygon: unknown;
};

/** Same rule as PricingService zone matching: polygon (3+ points) first, else radius. */
export function isInsideZone(
  lat: number,
  lng: number,
  zone: ZoneLike
): boolean {
  const poly = Array.isArray(zone.polygon) ? (zone.polygon as LatLng[]) : null;
  if (poly && poly.length >= 3) return pointInPolygon(lat, lng, poly);
  return (
    haversineMeters(lat, lng, zone.latitude, zone.longitude) <=
    zone.radiusMeters
  );
}

// ── Pickup timing ────────────────────────────────────────────────────────
export type LuggageType = "HAND" | "CHECKED";

/** Round up to the next 5 minutes: 15:57 → 16:00. */
export function roundUpTo5Min(date: Date): Date {
  const step = 5 * 60_000;
  return new Date(Math.ceil(date.getTime() / step) * step);
}

/** Earliest allowed pickup: scheduled landing + luggage buffer, rounded up to 5 minutes. */
export function earliestPickupAfterLanding(
  landingUtcIso: string,
  buffers: FlightBuffers,
  luggage: LuggageType
): Date {
  const minutes = luggage === "HAND" ? buffers.hand : buffers.checked;
  return roundUpTo5Min(
    new Date(new Date(landingUtcIso).getTime() + minutes * 60_000)
  );
}
