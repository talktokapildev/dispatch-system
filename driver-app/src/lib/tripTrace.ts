// driver-app/src/lib/tripTrace.ts
//
// Single source of truth for an in-progress trip's distance and route.
// Fed by BOTH the foreground watcher and the background location task, so
// distance keeps accumulating while the app is backgrounded (Tesla nav,
// phone locked). Persisted to AsyncStorage so an app kill mid-trip doesn't
// lose the distance or route already recorded.
//
// The route is stored as a Google encoded polyline built incrementally
// (append-only), so memory and storage stay small even on long trips.
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "orangeride:tripTrace:v1";
const MIN_STEP_MILES = 10 / 1609.344; // accept a point only after ~10 m of movement
const MAX_ACCURACY_M = 50; // ignore poor GPS fixes (avoids phantom jumps)
const SAVE_EVERY_POINTS = 20;
const SAVE_EVERY_MS = 30_000;
const MAX_TRIP_AGE_MS = 12 * 60 * 60 * 1000; // discard abandoned traces
const MAX_ENCODED_CHARS = 180_000; // backend accepts up to 200k

export type TracePoint = {
  latitude: number;
  longitude: number;
  timestamp?: number;
  accuracy?: number | null;
};

export type TraceSnapshot = {
  bookingId: string;
  distanceMiles: number;
  durationMinutes: number;
  encodedRoute: string | null;
};

type TraceState = {
  bookingId: string;
  startedAt: number;
  distanceMiles: number;
  encoded: string;
  lastLatE5: number;
  lastLngE5: number;
  lastLat: number | null;
  lastLng: number | null;
  lastTs: number;
  pointCount: number;
};

let state: TraceState | null = null;
let loaded: Promise<void> | null = null;
let unsavedPoints = 0;
let lastSaveAt = 0;

// ── Persistence ──────────────────────────────────────────────────────────
function ensureLoaded(): Promise<void> {
  if (!loaded) {
    loaded = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw || state) return;
        const parsed = JSON.parse(raw) as TraceState;
        if (Date.now() - parsed.startedAt > MAX_TRIP_AGE_MS) {
          AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
          return;
        }
        state = parsed;
      })
      .catch(() => {});
  }
  return loaded;
}

function save(): void {
  unsavedPoints = 0;
  lastSaveAt = Date.now();
  if (!state) {
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    return;
  }
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
}

function maybeSave(): void {
  if (
    unsavedPoints >= SAVE_EVERY_POINTS ||
    Date.now() - lastSaveAt >= SAVE_EVERY_MS
  )
    save();
}

// ── Geometry / encoding ──────────────────────────────────────────────────
function haversineMiles(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

function freshState(bookingId: string, startedAt: number): TraceState {
  return {
    bookingId,
    startedAt,
    distanceMiles: 0,
    encoded: "",
    lastLatE5: 0,
    lastLngE5: 0,
    lastLat: null,
    lastLng: null,
    lastTs: 0,
    pointCount: 0,
  };
}

function appendPoint(
  s: TraceState,
  lat: number,
  lng: number,
  ts: number
): void {
  if (s.encoded.length < MAX_ENCODED_CHARS) {
    const latE5 = Math.round(lat * 1e5);
    const lngE5 = Math.round(lng * 1e5);
    s.encoded +=
      encodeValue(latE5 - s.lastLatE5) + encodeValue(lngE5 - s.lastLngE5);
    s.lastLatE5 = latE5;
    s.lastLngE5 = lngE5;
    s.pointCount += 1;
  }
  s.lastLat = lat;
  s.lastLng = lng;
  s.lastTs = ts;
}

// ── Public API ───────────────────────────────────────────────────────────

/** Start a NEW trip (driver tapped "Start trip"). Replaces any saved trace. */
export async function startTrip(
  bookingId: string,
  startPoint?: TracePoint | null
): Promise<void> {
  await ensureLoaded();
  state = freshState(bookingId, Date.now());
  if (startPoint)
    appendPoint(
      state,
      startPoint.latitude,
      startPoint.longitude,
      startPoint.timestamp ?? Date.now()
    );
  save();
}

/**
 * Continue the saved trace for this booking after an app restart. If nothing
 * matching is saved, start fresh from the booking's real start time so the
 * duration is still correct.
 */
export async function resumeTrip(
  bookingId: string,
  tripStartedAt?: string | null
): Promise<void> {
  await ensureLoaded();
  if (state?.bookingId === bookingId) return;
  const startedAt = tripStartedAt ? Date.parse(tripStartedAt) : Date.now();
  state = freshState(
    bookingId,
    Number.isNaN(startedAt) ? Date.now() : startedAt
  );
  save();
}

/** Feed GPS fixes from any source. No-op when no trip is active. */
export async function addPoints(points: TracePoint[]): Promise<void> {
  await ensureLoaded();
  const s = state;
  if (!s) return;

  const sorted = [...points].sort(
    (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
  );
  for (const p of sorted) {
    if (p.accuracy != null && p.accuracy > MAX_ACCURACY_M) continue;
    const ts = p.timestamp ?? Date.now();
    if (ts <= s.lastTs) continue; // duplicate / out-of-order (both sources report in foreground)

    if (s.lastLat === null || s.lastLng === null) {
      appendPoint(s, p.latitude, p.longitude, ts);
      unsavedPoints += 1;
      continue;
    }
    const d = haversineMiles(s.lastLat, s.lastLng, p.latitude, p.longitude);
    if (d < MIN_STEP_MILES) continue;
    s.distanceMiles += d;
    appendPoint(s, p.latitude, p.longitude, ts);
    unsavedPoints += 1;
  }
  maybeSave();
}

/** Current totals for the completion payload (and dev display). */
export function getSnapshot(): TraceSnapshot | null {
  if (!state) return null;
  return {
    bookingId: state.bookingId,
    distanceMiles: state.distanceMiles,
    durationMinutes: Math.round((Date.now() - state.startedAt) / 60000),
    encodedRoute: state.pointCount >= 2 ? state.encoded : null,
  };
}

export function isTracking(bookingId: string): boolean {
  return state?.bookingId === bookingId;
}

/** Clear after the server has confirmed completion, or on cancellation. */
export async function clearTrip(): Promise<void> {
  await ensureLoaded();
  state = null;
  save();
}

// ── DEV ONLY: fare testing without driving ──────────────────────────────
export function devAddMiles(miles: number): number {
  if (!state) return 0;
  state.distanceMiles += miles;
  save();
  return state.distanceMiles;
}

export function devResetMiles(): void {
  if (!state) return;
  state.distanceMiles = 0;
  save();
}
