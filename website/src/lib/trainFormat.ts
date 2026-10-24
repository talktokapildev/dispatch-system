// Live train times pages: the data shapes the backend sends, and every piece of wording.
// Pure functions only (no fetch), so both server and client components can import it.
// All times are UK time.

import type { Tone, Weather } from "./flightFormat";
import { ukTime } from "./flightFormat";

export type TimeStatus = "ON_TIME" | "LATE" | "EARLY" | "DELAYED" | "CANCELLED" | "NO_REPORT";
export type StopTime = { sched: string; expected: string | null; status: TimeStatus; delayMin: number | null };
export type CallingPoint = {
  name: string;
  crs: string | null;
  sched: string | null;
  expected: string | null;
  actual: string | null;
  passed: boolean;
  status: TimeStatus;
  delayMin: number | null;
  cancelled: boolean;
};
export type TrainService = {
  id: string;
  kind: "TRAIN" | "BUS" | "FERRY";
  operator: string | null;
  operatorCode: string | null;
  origin: string;
  originVia: string | null;
  destination: string;
  destinationVia: string | null;
  arr: StopTime | null;
  dep: StopTime | null;
  platform: string | null;
  coaches: number | null;
  cancelled: boolean;
  cancelReason: string | null;
  delayReason: string | null;
  previous: CallingPoint[];
  subsequent: CallingPoint[];
};
export type StationInfo = { slug: string; crs: string; name: string; town: string };
export type TrainBoardData = {
  station: StationInfo;
  fetchedAt: string | null;
  stale: boolean;
  messages: string[];
  services: TrainService[];
  weather: Weather | null;
};
export type TrainResult =
  | { status: "FOUND"; live: boolean; fetchedAt: string; service: TrainService; messages: string[]; station: StationInfo }
  | { status: "NOT_FOUND"; station: StationInfo }
  | { status: "ERROR" };

export type Way = "ARRIVALS" | "DEPARTURES";

/** Stations with a page (must match the backend's STATIONS). */
export const TRAIN_STATIONS: StationInfo[] = [{ slug: "three-bridges", crs: "TBD", name: "Three Bridges", town: "Crawley" }];
export const trainStation = (slug: string) => TRAIN_STATIONS.find((s) => s.slug === slug) ?? null;

export const NR_CREDIT = "Train information from National Rail Enquiries";
/** National Rail's own live board for the station (fallback when ours isn't available). */
export const nationalRailBoard = (crs: string) => `https://www.nationalrail.co.uk/live-trains/departures/${crs}/`;

export const boardPath = (slug: string, way: Way) => (way === "DEPARTURES" ? `/trains/${slug}/departures` : `/trains/${slug}`);

// Darwin service IDs are usually letters and digits; anything else is base64url'd so the URL stays clean.
export function trainSlug(id: string): string {
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : `b64-${Buffer.from(id, "utf8").toString("base64url")}`;
}
export function trainIdFromSlug(slug: string): string {
  if (!slug.startsWith("b64-")) return slug;
  try {
    return Buffer.from(slug.slice(4), "base64url").toString("utf8");
  } catch {
    return slug;
  }
}
export const trainPath = (station: string, id: string) => `/trains/${station}/train/${trainSlug(id)}`;

export const stopFor = (s: TrainService, way: Way) => (way === "ARRIVALS" ? s.arr : s.dep);

/** When it really happens: expected time, else scheduled. */
const effective = (t: StopTime) => Date.parse(t.expected ?? t.sched);

/**
 * Rows for one tab: services that arrive (or leave) here, still to come or just gone (2 min),
 * cancelled ones for 10 min after their time, and "Delayed" (no estimate) for an hour.
 * `q` keeps only trains that come from / go to / call at a matching place.
 */
export function boardRows(services: TrainService[], way: Way, now: Date, q = ""): TrainService[] {
  const t = now.getTime();
  const needle = q.trim().toLowerCase();
  return services
    .filter((s) => {
      const st = stopFor(s, way);
      if (!st) return false;
      if (st.status === "CANCELLED" || s.cancelled) return Date.parse(st.sched) >= t - 10 * 60_000;
      if (st.status === "DELAYED" || st.status === "NO_REPORT") return Date.parse(st.sched) >= t - 60 * 60_000;
      return effective(st) >= t - 2 * 60_000;
    })
    .filter((s) => !needle || placesOf(s).some((p) => p.toLowerCase().includes(needle)))
    .sort((a, b) => Date.parse(stopFor(a, way)!.sched) - Date.parse(stopFor(b, way)!.sched));
}

function placesOf(s: TrainService): string[] {
  return [s.origin, s.destination, ...s.previous.map((c) => c.name), ...s.subsequent.map((c) => c.name)];
}

/** "On time", "8 min late", "Cancelled"… */
export function statusText(t: StopTime, cancelled = false): string {
  if (cancelled || t.status === "CANCELLED") return "Cancelled";
  switch (t.status) {
    case "LATE":
      return `${t.delayMin} min late`;
    case "EARLY":
      return `${-(t.delayMin ?? 0)} min early`;
    case "DELAYED":
      return "Delayed";
    case "NO_REPORT":
      return "No report";
    default:
      return "On time";
  }
}

export function toneFor(t: StopTime, cancelled = false): Tone {
  if (cancelled || t.status === "CANCELLED") return "bad";
  if (t.status === "LATE" || t.status === "DELAYED") return "late";
  if (t.status === "EARLY") return "early";
  return "info";
}

/** Was the time moved enough to show the old one crossed out? */
export const moved = (t: StopTime) => !!t.expected && (t.status === "LATE" || t.status === "EARLY");

/** Train company label colours (text contrast checked AA). */
const OPERATOR: Record<string, { bg: string; fg: string }> = {
  SN: { bg: "#8CC63E", fg: "#1F2328" }, // Southern
  TL: { bg: "#C2185B", fg: "#ffffff" }, // Thameslink
  GX: { bg: "#D70428", fg: "#ffffff" }, // Gatwick Express
  GW: { bg: "#0A493E", fg: "#ffffff" }, // Great Western Railway
};
export function operatorStyle(code: string | null | undefined): { bg: string; fg: string } {
  return OPERATOR[(code ?? "").toUpperCase()] ?? { bg: "#e2e8f0", fg: "#2e3238" };
}
export const operatorName = (s: TrainService) => (s.kind === "BUS" ? "Bus" : s.operator ?? "Train");

/** Where it's coming from / going to on this tab. */
export const otherEnd = (s: TrainService, way: Way) =>
  way === "ARRIVALS" ? { name: s.origin, via: s.originVia } : { name: s.destination, via: s.destinationVia };

/** When the train left its first station (or leaves/arrives here if it starts here). */
export function startTime(s: TrainService): string {
  return s.previous[0]?.sched ?? (s.dep ?? s.arr)!.sched;
}

/** "The 23:42 London Victoria to Brighton". */
export function trainTitle(s: TrainService): string {
  const what = s.kind === "BUS" ? "bus" : "";
  return `${ukTime(startTime(s))} ${s.origin} to ${s.destination}${what ? ` ${what}` : ""}`;
}

export const coachesText = (n: number | null) => (n ? `${n} coach${n === 1 ? "" : "es"}` : null);

/** Every stop in order, with our station marked. */
export type Stop = CallingPoint & { here: boolean };
export function allStops(s: TrainService, station: StationInfo): Stop[] {
  const at = s.arr ?? s.dep!;
  const here: Stop = {
    name: station.name,
    crs: station.crs,
    sched: at.sched,
    expected: at.expected,
    actual: null,
    passed: false,
    status: at.status,
    delayMin: at.delayMin,
    cancelled: s.cancelled,
    here: true,
  };
  return [...s.previous.map((c) => ({ ...c, here: false })), here, ...s.subsequent.map((c) => ({ ...c, here: false }))];
}

/** Index of the last stop the train has been to (−1: hasn't started). */
export function lastPassed(stops: Stop[]): number {
  let i = -1;
  stops.forEach((s, k) => {
    if (s.passed) i = k;
  });
  return i;
}

/** One sentence: where it is and when it gets here. */
export function trainSentence(s: TrainService, station: StationInfo): string {
  const stops = allStops(s, station);
  const hereIdx = stops.findIndex((x) => x.here);
  const lp = lastPassed(stops);
  const a = s.arr;
  const d = s.dep;
  if (s.cancelled) return `This ${s.kind === "BUS" ? "bus" : "train"} is cancelled at ${station.name}.`;
  const t = a ?? d!;
  const when = t.expected ? ukTime(t.expected) : ukTime(t.sched);
  const verb = a ? "Due at" : "Leaves";
  let lateness = "";
  if (t.status === "LATE") lateness = `, ${t.delayMin} min late`;
  else if (t.status === "EARLY") lateness = `, ${-(t.delayMin ?? 0)} min early`;
  else if (t.status === "DELAYED") lateness = ", delayed (no estimate yet)";
  else if (t.status === "ON_TIME") lateness = ", on time";
  let where = "";
  if (lp >= hereIdx && lp >= 0) where = ` It has left ${station.name}.`;
  else if (lp >= 0 && lp < hereIdx - 1) where = ` It's between ${stops[lp].name} and ${stops[lp + 1].name}.`;
  else if (lp >= 0 && lp === hereIdx - 1) where = ` It has left ${stops[lp].name}, the stop before ${station.name}.`;
  else if (!s.previous.length && a === null) where = ` It starts here.`;
  return `${verb} ${station.name} ${when}${lateness}.${where}`;
}

/** Disruption summary for the next two hours, both ways (each train counted once). */
export function disruptionCounts(services: TrainService[], now: Date) {
  const seen = new Set<string>();
  let cancelled = 0;
  let late = 0;
  for (const way of ["ARRIVALS", "DEPARTURES"] as Way[])
    for (const s of boardRows(services, way, now)) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      const t = stopFor(s, way)!;
      if (s.cancelled || t.status === "CANCELLED") cancelled++;
      else if ((t.status === "LATE" && (t.delayMin ?? 0) >= 5) || t.status === "DELAYED") late++;
    }
  return { cancelled, late };
}
