// backend/src/services/trainBoardRules.ts
//
// Pure logic for the website's live train times pages (no network, no Redis):
//  - the stations we show (Three Bridges first; add more to STATIONS)
//  - National Rail "Live Arrival and Departure Boards" (Darwin LDBWS, JSON from the Rail Data
//    Marketplace) → our own compact shapes
//  - UK clock times ("23:42") → real instants, across midnight
//
// Darwin gives times as UK clock times without a date, and expected times as either a time
// ("23:50") or a word ("On time", "Delayed", "Cancelled", "No report").

export type Station = { slug: string; crs: string; name: string; town: string; lat: number; lon: number };

/** Stations with a live page at /trains/<slug>. */
export const STATIONS: Station[] = [
  { slug: "three-bridges", crs: "TBD", name: "Three Bridges", town: "Crawley", lat: 51.117, lon: -0.1614 },
];

export const stationBySlug = (slug: string) => STATIONS.find((s) => s.slug === slug.toLowerCase()) ?? null;
/** Key for the station's cached weather (kept apart from airport codes). */
export const weatherKey = (s: Station) => `RAIL-${s.crs}`;

export type TimeStatus = "ON_TIME" | "LATE" | "EARLY" | "DELAYED" | "CANCELLED" | "NO_REPORT";

/** One end of a stop at our station: arriving or leaving. */
export type StopTime = {
  sched: string; // ISO
  expected: string | null; // ISO, when Darwin gives a time (or "On time")
  status: TimeStatus;
  delayMin: number | null; // + late, − early
};

export type CallingPoint = {
  name: string;
  crs: string | null;
  sched: string | null; // ISO
  expected: string | null; // ISO
  actual: string | null; // ISO: the train has been there
  passed: boolean; // has an actual time (even "No report" after the fact)
  status: TimeStatus;
  delayMin: number | null;
  cancelled: boolean;
};

export type TrainService = {
  id: string; // Darwin serviceID (changes daily)
  kind: "TRAIN" | "BUS" | "FERRY";
  operator: string | null;
  operatorCode: string | null;
  origin: string;
  originVia: string | null;
  destination: string;
  destinationVia: string | null;
  arr: StopTime | null; // null when the train starts here
  dep: StopTime | null; // null when the train ends here
  platform: string | null;
  coaches: number | null;
  cancelled: boolean;
  cancelReason: string | null;
  delayReason: string | null;
  previous: CallingPoint[];
  subsequent: CallingPoint[];
};

export type TrainBoard = {
  crs: string;
  name: string;
  fetchedAt: string; // ISO, when we fetched it
  messages: string[]; // National Rail disruption messages, plain text
  services: TrainService[];
};

// ─── UK clock times ─────────────────────────────────────────────────────────────────────

const ukFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function ukParts(d: Date) {
  const p = Object.fromEntries(ukFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute };
}

/** UK wall-clock date and time → instant (handles BST/GMT). */
export function ukToInstant(y: number, m: number, d: number, h: number, min: number): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const offset = (t: number) => {
    const p = ukParts(new Date(t));
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return new Date(t);
}

const HM = /^(\d{1,2}):(\d{2})$/;

/** "23:42" → the instant nearest to `now` (yesterday, today or tomorrow, UK time). */
export function clockToIso(hm: string | null | undefined, now: Date): string | null {
  const m = typeof hm === "string" ? HM.exec(hm.trim()) : null;
  if (!m) return null;
  const h = +m[1];
  const min = +m[2];
  if (h > 23 || min > 59) return null;
  const today = ukParts(now);
  let best: Date | null = null;
  for (const shift of [-1, 0, 1]) {
    const base = new Date(Date.UTC(today.y, today.m - 1, today.d + shift));
    const cand = ukToInstant(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), h, min);
    if (!best || Math.abs(cand.getTime() - now.getTime()) < Math.abs(best.getTime() - now.getTime())) best = cand;
  }
  return best!.toISOString();
}

/** The expected time `et` relative to the scheduled instant (handles a delay over midnight). */
function expectedFrom(schedIso: string, et: string | null | undefined): { expected: string | null; status: TimeStatus; delayMin: number | null } {
  const word = typeof et === "string" ? et.trim().toLowerCase() : "";
  if (word === "on time") return { expected: schedIso, status: "ON_TIME", delayMin: 0 };
  if (word === "cancelled") return { expected: null, status: "CANCELLED", delayMin: null };
  if (word === "delayed") return { expected: null, status: "DELAYED", delayMin: null };
  const iso = clockToIso(et, new Date(schedIso));
  if (!iso) return { expected: null, status: "NO_REPORT", delayMin: null };
  const delay = Math.round((Date.parse(iso) - Date.parse(schedIso)) / 60_000);
  return { expected: iso, status: delay > 0 ? "LATE" : delay < 0 ? "EARLY" : "ON_TIME", delayMin: delay };
}

function stopTime(st: unknown, et: unknown, now: Date): StopTime | null {
  const sched = clockToIso(typeof st === "string" ? st : null, now);
  if (!sched) return null;
  return { sched, ...expectedFrom(sched, typeof et === "string" ? et : null) };
}

// ─── Darwin JSON → our shapes ───────────────────────────────────────────────────────────

const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);
const arr = (x: unknown): any[] => (Array.isArray(x) ? x : x && typeof x === "object" ? [x] : []);

/** National Rail messages can contain <p> and <a> tags: plain text only. */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function locations(x: unknown): { name: string; via: string | null } {
  const list = arr(x).filter((l) => str(l?.locationName));
  if (!list.length) return { name: "Unknown", via: null };
  return {
    name: list.map((l) => str(l.locationName)).join(" & "),
    via: list.map((l) => str(l.via)).find(Boolean) ?? null,
  };
}

/** Darwin's previous/subsequentCallingPoints: [{ callingPoint: [ ... ] }] (one list per portion). */
function callingPoints(x: unknown, now: Date): CallingPoint[] {
  const first = arr(x)[0];
  const list = arr(first?.callingPoint ?? first?.callingPoints ?? []);
  return list
    .filter((c) => str(c?.locationName))
    .map((c) => {
      const sched = clockToIso(str(c.st), now);
      const at = str(c.at);
      const atIso = at && sched ? clockToIso(at, new Date(sched)) : null;
      const isCancelled = c.isCancelled === true || String(c.et ?? "").toLowerCase() === "cancelled";
      const e = sched
        ? atIso
          ? (() => {
              const d = Math.round((Date.parse(atIso) - Date.parse(sched)) / 60_000);
              return { expected: atIso, status: (d > 0 ? "LATE" : d < 0 ? "EARLY" : "ON_TIME") as TimeStatus, delayMin: d };
            })()
          : at && at.toLowerCase() === "on time"
            ? { expected: sched, status: "ON_TIME" as TimeStatus, delayMin: 0 }
            : expectedFrom(sched, isCancelled ? "Cancelled" : str(c.et))
        : { expected: null, status: "NO_REPORT" as TimeStatus, delayMin: null };
      return {
        name: str(c.locationName)!,
        crs: str(c.crs),
        sched,
        expected: e.expected,
        actual: atIso ?? (at && at.toLowerCase() === "on time" ? sched : null),
        passed: !!at,
        status: e.status,
        delayMin: e.delayMin,
        cancelled: isCancelled,
      };
    });
}

function parseService(s: any, kind: TrainService["kind"], now: Date): TrainService | null {
  const id = str(s?.serviceID ?? s?.serviceId);
  if (!id) return null;
  const arrT = stopTime(s.sta, s.eta, now);
  const depT = stopTime(s.std, s.etd, now);
  if (!arrT && !depT) return null;
  const origin = locations(s.origin);
  const destination = locations(s.destination);
  const len = Number(s.length);
  return {
    id,
    kind,
    operator: str(s.operator),
    operatorCode: str(s.operatorCode),
    origin: origin.name,
    originVia: origin.via,
    destination: destination.name,
    destinationVia: destination.via,
    arr: arrT,
    dep: depT,
    platform: str(s.platform),
    coaches: Number.isFinite(len) && len > 0 ? len : null,
    cancelled: s.isCancelled === true || arrT?.status === "CANCELLED" || depT?.status === "CANCELLED",
    cancelReason: str(s.cancelReason),
    delayReason: str(s.delayReason),
    previous: callingPoints(s.previousCallingPoints, now),
    subsequent: callingPoints(s.subsequentCallingPoints, now),
  };
}

/** One Darwin board response → messages + services (trains, then replacement buses). */
export function parseDarwinBoard(body: any, now: Date): { messages: string[]; services: TrainService[] } {
  const messages = arr(body?.nrccMessages)
    .map((m) => (typeof m === "string" ? m : str(m?.Value) ?? str(m?.value) ?? str(m?.message) ?? ""))
    .map(plainText)
    .filter(Boolean);
  const services = [
    ...arr(body?.trainServices).map((s) => parseService(s, "TRAIN", now)),
    ...arr(body?.busServices).map((s) => parseService(s, "BUS", now)),
    ...arr(body?.ferryServices).map((s) => parseService(s, "FERRY", now)),
  ].filter((s): s is TrainService => !!s);
  return { messages, services };
}

/** When a service calls here: arrival if it has one, else departure. */
export const serviceTime = (s: TrainService) => Date.parse((s.arr ?? s.dep)!.sched);

/** Several board pages → one list: no duplicates (latest copy wins), in time order. */
export function mergeServices(pages: TrainService[][]): TrainService[] {
  const byId = new Map<string, TrainService>();
  for (const page of pages) for (const s of page) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => serviceTime(a) - serviceTime(b));
}

/** Unique messages, in order. */
export const mergeMessages = (pages: string[][]) => [...new Set(pages.flat())];

/**
 * The next board page to ask for, in minutes from now, or null when we've covered `endMin`.
 * Darwin may return fewer rows than asked (the "with details" boards stop at 10): when a page
 * comes back full, carry on from its last train; otherwise from the end of its window.
 */
export function nextOffset(
  page: TrainService[],
  offset: number,
  window: number,
  rowsCap: number,
  now: Date,
  endMin: number
): number | null {
  let next = offset + window;
  if (page.length >= rowsCap && page.length) {
    const lastMin = Math.floor((Math.max(...page.map(serviceTime)) - now.getTime()) / 60_000);
    next = lastMin > offset ? lastMin : offset + 5; // always move forward
  }
  return next >= endMin ? null : next;
}

/** Is it the quiet part of the night (UK), when we refresh less often? */
export function quietHours(now: Date): boolean {
  const p = ukParts(now);
  const m = p.h * 60 + p.min;
  return m >= 90 && m < 270; // 01:30–04:30
}
