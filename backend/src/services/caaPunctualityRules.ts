// backend/src/services/caaPunctualityRules.ts
//
// "How reliable is this route?" on the website — UK Civil Aviation Authority (CAA) monthly
// punctuality statistics, Gatwick rows only. PURE logic, no I/O
// (tests: scripts/test-caa-punctuality.ts).
//
//   parseCaaCsv()     the CAA "Full Analysis Arrival Departure" CSV → Gatwick rows (header checked)
//   matchAirport()    CAA airport name ("PARIS (CHARLES DE GAULLE)") → IATA, from airports seen on
//                     our Gatwick board + a small override list
//   matchAirline()    CAA operating airline ("EASYJET EUROPE AIRLINE GMBH") → our airline page slug
//   buildSummary()    rows of the last 12 months → per route / airline stats (what the pages read)
//   routeStats()      one flight page: its route's 12-month stats + the same month last year
//
// CAA facts this relies on (checked against the Aug 2026 file):
//   - one row per reporting airport, other airport, operating airline, A/D and S/C, per month
//   - the band percentages, unmatched % and cancelled % add up to 100 of
//     total = matched + unmatched + cancelled
//   - "on time" = from early to 15 min late (CAA's own definition); early flights count as
//     zero delay in the average
//   - monthly totals only: route + airline, never a single flight number
//
// Terms: CAA statistics may not be sold on, and the CAA must be credited wherever they're
// shown. We only show them on our own pages, always with the credit.

export const REPORTING_AIRPORT = "GATWICK";
export const WINDOW_MONTHS = 12; // stats cover the latest 12 months we hold
export const KEEP_MONTHS = 24; // older months are deleted on import
export const MIN_FLIGHTS = 30; // a 12-month figure needs this many timed flights
export const MIN_MONTH_FLIGHTS = 15; // the "same month last year" hint needs this many
export const RANK_MIN_FLIGHTS = 60; // an airline's best / worst routes need this many
export const RANK_SIZE = 3;

export type CaaDirection = "A" | "D"; // at Gatwick: arrival / departure

// ── CSV ─────────────────────────────────────────────────────────────────────
// Columns we read, as named in the CAA header (2026 layout, 26 columns in all).
const COLS = {
  period: "reporting_period",
  reporting: "reporting_airport",
  country: "origin_destination_country",
  airport: "origin_destination",
  airline: "airline_name",
  direction: "arrival_departure",
  charter: "scheduled_charter",
  matched: "number_flights_matched",
  unmatched: "actual_flights_unmatched",
  cancelled: "number_flights_cancelled",
  early15: "flights_more_than_15_minutes_early_percent",
  early1: "flights_15_minutes_early_to_1_minute_early_percent",
  late15: "flights_0_to_15_minutes_late_percent",
  late30: "flights_between_16_and_30_minutes_late_percent",
  late60: "flights_between_31_and_60_minutes_late_percent",
  late120: "flights_between_61_and_120_minutes_late_percent",
  late180: "flights_between_121_and_180_minutes_late_percent",
  late360: "flights_between_181_and_360_minutes_late_percent",
  lateMore: "flights_more_than_360_minutes_late_percent",
  unmatchedPct: "flights_unmatched_percent",
  cancelledPct: "flights_cancelled_percent",
  avgDelay: "average_delay_mins",
  runDate: "run_date",
} as const;

/** One Gatwick row, as stored (CaaPunctuality table). */
export type CaaRow = {
  period: number; // YYYYMM
  direction: CaaDirection;
  country: string;
  airport: string;
  airline: string;
  charter: string; // S | C
  matched: number;
  unmatched: number;
  cancelled: number;
  early15Pct: number;
  early1Pct: number;
  late15Pct: number;
  late30Pct: number;
  late60Pct: number;
  late120Pct: number;
  late180Pct: number;
  late360Pct: number;
  lateMorePct: number;
  unmatchedPct: number;
  cancelledPct: number;
  avgDelayMin: number;
  runDate: string | null;
};

/** One UK airport's month (CaaAirportMonth table): every row of that airport added up. */
export type AirportMonth = {
  period: number;
  airport: string; // CAA reporting airport, e.g. "HEATHROW"
  direction: CaaDirection;
  total: number; // matched + unmatched + cancelled
  matched: number;
  cancelled: number;
  onTime: number; // flights early to 15 min late (from the percentages, so not whole)
  overHour: number; // flights more than 60 min late
  delaySum: number; // average delay × matched, summed
};

export type ParsedCsv = {
  period: number; // the one month the file covers
  rows: CaaRow[]; // Gatwick only
  airports: AirportMonth[]; // every UK reporting airport (Gatwick included)
  allRows: number; // every data row in the file (all UK airports)
  duplicates: number; // repeated keys dropped (first kept)
};

/** Splits CSV text into records (quoted fields, "" escapes, CRLF, a leading BOM). */
export function splitCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) out.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) out.push(row);
  return out;
}

const num = (v: string | undefined): number => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
};
const clean = (v: string | undefined): string => String(v ?? "").trim().replace(/\s+/g, " ");

/**
 * The CAA CSV → Gatwick rows. Throws with a plain message when the file isn't the
 * "Full Analysis Arrival Departure" layout, or covers more than one month.
 */
export function parseCaaCsv(text: string): ParsedCsv {
  const records = splitCsv(text);
  if (records.length < 2) throw new Error("File is empty or not a CSV");
  const header = records[0].map((h) => h.trim().toLowerCase());
  const at: Record<string, number> = {};
  const missing: string[] = [];
  for (const [k, name] of Object.entries(COLS)) {
    const i = header.indexOf(name);
    if (i < 0 && k !== "runDate") missing.push(name);
    at[k] = i;
  }
  if (missing.length)
    throw new Error(
      `Not the CAA "Full Analysis Arrival Departure" CSV (missing: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? ", ..." : ""})`
    );
  const get = (r: string[], k: keyof typeof COLS) => (at[k] >= 0 ? r[at[k]] : undefined);

  const periods = new Set<number>();
  const byKey = new Map<string, CaaRow>();
  let duplicates = 0;
  const totals = new Map<string, AirportMonth>();
  const seenKeys = new Set<string>();
  for (const r of records.slice(1)) {
    const period = num(get(r, "period"));
    if (period) periods.add(period);
    const reporting = clean(get(r, "reporting")).toUpperCase();
    const dir = clean(get(r, "direction")).toUpperCase();
    if (dir !== "A" && dir !== "D") continue;
    const row: CaaRow = {
      period,
      direction: dir,
      country: clean(get(r, "country")).toUpperCase(),
      airport: clean(get(r, "airport")).toUpperCase(),
      airline: clean(get(r, "airline")).toUpperCase(),
      charter: clean(get(r, "charter")).toUpperCase() || "S",
      matched: Math.max(0, Math.round(num(get(r, "matched")))),
      unmatched: Math.max(0, Math.round(num(get(r, "unmatched")))),
      cancelled: Math.max(0, Math.round(num(get(r, "cancelled")))),
      early15Pct: num(get(r, "early15")),
      early1Pct: num(get(r, "early1")),
      late15Pct: num(get(r, "late15")),
      late30Pct: num(get(r, "late30")),
      late60Pct: num(get(r, "late60")),
      late120Pct: num(get(r, "late120")),
      late180Pct: num(get(r, "late180")),
      late360Pct: num(get(r, "late360")),
      lateMorePct: num(get(r, "lateMore")),
      unmatchedPct: num(get(r, "unmatchedPct")),
      cancelledPct: num(get(r, "cancelledPct")),
      avgDelayMin: Math.max(0, num(get(r, "avgDelay"))),
      runDate: clean(get(r, "runDate")) || null,
    };
    if (!row.airport || !row.airline || !reporting) continue;
    // A repeated row (same airport, route, airline, A/D, S/C) is dropped everywhere, first kept.
    const key = `${reporting}|${rowKey(row)}`;
    if (seenKeys.has(key)) {
      if (reporting === REPORTING_AIRPORT) duplicates++;
      continue;
    }
    seenKeys.add(key);
    const tk = `${reporting}|${dir}`;
    const t =
      totals.get(tk) ??
      totals
        .set(tk, { period, airport: reporting, direction: dir, total: 0, matched: 0, cancelled: 0, onTime: 0, overHour: 0, delaySum: 0 })
        .get(tk)!;
    add(t, row);
    if (reporting !== REPORTING_AIRPORT) continue;
    byKey.set(key, row);
  }
  if (periods.size !== 1)
    throw new Error(periods.size ? `File covers several months (${[...periods].join(", ")})` : "No reporting_period found");
  const period = [...periods][0];
  if (!/^20\d{2}(0[1-9]|1[0-2])$/.test(String(period))) throw new Error(`Odd reporting_period ${period}`);
  const airports = [...totals.values()].map((t) => ({ ...t, period }));
  return { period, rows: [...byKey.values()], airports, allRows: records.length - 1, duplicates };
}

export const rowKey = (r: Pick<CaaRow, "period" | "direction" | "airport" | "airline" | "charter">) =>
  `${r.period}|${r.direction}|${r.airport}|${r.airline}|${r.charter}`;

// ── Months ──────────────────────────────────────────────────────────────────
/** 202608 → 202508 (n = -12). */
export function addMonths(period: number, n: number): number {
  const y = Math.floor(period / 100);
  const m = (period % 100) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return yy * 100 + mm + 1;
}
/** 202608 → "2026-08". */
export const periodIso = (p: number) => `${Math.floor(p / 100)}-${String(p % 100).padStart(2, "0")}`;

// ── Names ───────────────────────────────────────────────────────────────────
/** Accents and punctuation out, upper case, single spaces: "Málaga-Costa del Sol" → "MALAGA COSTA DEL SOL". */
export function norm(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Words that don't tell two airports apart.
const AIRPORT_NOISE = new Set(["AIRPORT", "AEROPORT", "AEROPUERTO", "AEROPORTO", "FLUGHAFEN", "INTERNATIONAL", "INTL", "INT"]);
const airportWords = (s: string) => norm(s).split(" ").filter((w) => w && !AIRPORT_NOISE.has(w));
const airportForm = (s: string) => airportWords(s).join(" ");

/** An airport we've seen on the Gatwick board (Redis airports:seen). */
export type SeenAirport = {
  iata: string;
  city: string | null; // what our pages call it ("Malta", "Tenerife South")
  airportName: string | null; // provider's airport name ("Paris Charles de Gaulle")
  municipality: string | null; // provider's town ("Luqa")
  country: string | null; // ISO alpha-2
};

// CAA names the matching can't work out by itself. Add lines here when the import log lists an
// airport as "unmatched" (CAA name, upper case, exactly as in the file → IATA).
export const CAA_AIRPORT_OVERRIDES: Record<string, string> = {
  "TENERIFE (SURREINA SOFIA)": "TFS",
  "TENERIFE (SUR REINA SOFIA)": "TFS",
  "TENERIFE (NORTE LOS RODEOS)": "TFN",
  "NEW YORK (JF KENNEDY)": "JFK",
  "NEW YORK (NEWARK)": "EWR",
  "PARIS (CHARLES DE GAULLE)": "CDG",
  "PARIS (ORLY)": "ORY",
  "MILAN (MALPENSA)": "MXP",
  "MILAN (LINATE)": "LIN",
  "MILAN (BERGAMO)": "BGY",
  "ROME (FIUMICINO)": "FCO",
  "ROME (CIAMPINO)": "CIA",
  "VENICE (MARCO POLO)": "VCE",
  "VENICE (TREVISO)": "TSF",
  "ISTANBUL (SABIHA GOKCEN)": "SAW",
  "MALTA": "MLA",
  "LUQA": "MLA",
};

let regionNames: Intl.DisplayNames | null | undefined;
function countryName(code: string | null): string | null {
  if (!code) return null;
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames ? norm(regionNames.of(code.toUpperCase()) ?? "") || null : null;
  } catch {
    return null;
  }
}

export type AirportMatch = { iata: string; how: "override" | "name" } | { iata: null; candidates: string[] };

/**
 * CAA airport name (+ CAA country) → IATA code.
 *   1. the override list
 *   2. "CITY (AIRPORT)": the city is the airport's town or our name for it, and every word in
 *      brackets is in the airport's full name ("PARIS (CHARLES DE GAULLE)" → CDG, not ORY)
 *      "CITY": the town or our name for it, or the airport's full name
 *   3. several left → the one in the same country; still several → no match (listed in the log)
 */
export function matchAirport(caaName: string, caaCountry: string, seen: SeenAirport[]): AirportMatch {
  const name = clean(caaName).toUpperCase();
  const ov = CAA_AIRPORT_OVERRIDES[name];
  if (ov) return { iata: ov, how: "override" };

  const m = name.match(/^(.*?)\s*\((.*)\)\s*$/);
  const base = airportForm(m ? m[1] : name);
  const paren = m ? airportWords(m[2]) : [];
  if (!base) return { iata: null, candidates: [] };

  const hits = seen.filter((a) => {
    const forms = [a.city, a.municipality, a.airportName].filter((x): x is string => !!x).map(airportForm);
    const words = new Set(forms.flatMap((f) => f.split(" ")));
    if (paren.length) return forms.includes(base) && paren.every((w) => words.has(w));
    return forms.includes(base) || (a.airportName ? airportForm(a.airportName) === airportForm(name) : false);
  });
  let list = [...new Map(hits.map((a) => [a.iata.toUpperCase(), a])).values()];
  if (list.length > 1) {
    const want = norm(caaCountry);
    const same = list.filter((a) => countryName(a.country) === want);
    if (same.length) list = same;
  }
  if (list.length === 1) return { iata: list[0].iata.toUpperCase(), how: "name" };
  return { iata: null, candidates: list.map((a) => a.iata.toUpperCase()).sort() };
}

// ── Airlines ────────────────────────────────────────────────────────────────
/** An airline page we have (from the terminal summary: slug + the provider's name). */
export type KnownAirline = { slug: string; name: string };

// The CAA names the OPERATING company. Brands with several companies → one of our pages, the
// same grouping as airlineTerminalRules.ts (easyJet = U2/DS/EC etc.).
const AIRLINE_GROUPS: Array<[RegExp, string]> = [
  [/^EASYJET\b/, "easyjet"],
  [/^WIZZ ?AIR\b/, "wizz-air"],
  [/^NORWEGIAN\b/, "norwegian"],
  [/^(RYANAIR|MALTA AIR|LAUDA EUROPE|BUZZ)\b/, "ryanair"],
  [/^TUI (AIRWAYS|AIRLINES)\b|^TUI$/, "tui"],
  [/^(BRITISH AIRWAYS|BA EUROFLYER|BA CITYFLYER)\b/, "british-airways"],
];

// Company-form and filler words, dropped before comparing names. "AIR" is kept: it tells
// "Air China" from "China Eastern".
const AIRLINE_NOISE = new Set([
  "LTD", "LIMITED", "PLC", "SA", "S", "A", "SPA", "SAU", "SL", "SRL", "GMBH", "AG", "AS", "ASA", "AB", "BV", "NV",
  "INC", "CO", "COMPANY", "CORP", "CORPORATION", "DAC", "PJSC", "JSC", "LLC", "KFT", "OY", "OYJ", "SE", "THE",
  "AIRLINE", "AIRLINES", "AIRWAYS", "AVIATION", "SERVICES", "GROUP", "UK", "EUROPE",
]);
const airlineWords = (s: string) => norm(s).split(" ").filter((w) => w && !AIRLINE_NOISE.has(w));

// CAA names the matching can't work out by itself (CAA name → the name our board uses).
// Add lines here when the log lists a CURRENT Gatwick airline as unmatched.
export const CAA_AIRLINE_ALIASES: Record<string, string> = {
  "AIR PORTUGAL": "TAP AIR PORTUGAL",
};

/**
 * CAA airline → our page slug, or null. Group rules first; then the only known airline with the
 * same words (company words dropped, spaces ignored: "WEST JET" = "WestJet"); else the known
 * airline whose words are ALL in the CAA name, the most words winning ("THY TURKISH AIRLINES" →
 * "Turkish Airlines", "CHINA EASTERN AIRLINES" → "China Eastern" over "China"). A CAA name
 * shorter than ours never matches by itself ("AIR CHINA" ≠ "Air China Cargo"): use an alias.
 */
export function matchAirline(caaAirline: string, known: KnownAirline[]): string | null {
  const raw = norm(caaAirline);
  const name = norm(CAA_AIRLINE_ALIASES[raw] ?? raw);
  for (const [re, slug] of AIRLINE_GROUPS) if (re.test(name)) return slug;
  const mine = airlineWords(name);
  if (!mine.length) return null;
  const mineSet = new Set(mine);
  const squash = mine.join("");
  const one = (list: KnownAirline[]) => {
    const slugs = [...new Set(list.map((k) => k.slug))];
    return slugs.length === 1 ? slugs[0] : null;
  };

  const same = known.filter((k) => {
    const theirs = airlineWords(k.name);
    return theirs.join("") === squash || (theirs.length === mine.length && theirs.every((w) => mineSet.has(w)));
  });
  if (same.length) return one(same);

  let best = 0;
  let hits: KnownAirline[] = [];
  for (const k of known) {
    const theirs = airlineWords(k.name);
    if (!theirs.length || !theirs.every((w) => mineSet.has(w))) continue;
    if (theirs.length > best) {
      best = theirs.length;
      hits = [k];
    } else if (theirs.length === best) hits.push(k);
  }
  return hits.length ? one(hits) : null;
}

// ── Stats ───────────────────────────────────────────────────────────────────
type Acc = { total: number; matched: number; cancelled: number; onTime: number; overHour: number; delaySum: number };
const addAcc = (a: Acc, b: Acc) => {
  a.total += b.total;
  a.matched += b.matched;
  a.cancelled += b.cancelled;
  a.onTime += b.onTime;
  a.overHour += b.overHour;
  a.delaySum += b.delaySum;
};
const emptyAcc = (): Acc => ({ total: 0, matched: 0, cancelled: 0, onTime: 0, overHour: 0, delaySum: 0 });

function add(acc: Acc, r: CaaRow): void {
  const total = r.matched + r.unmatched + r.cancelled;
  acc.total += total;
  acc.matched += r.matched;
  acc.cancelled += r.cancelled;
  acc.onTime += ((r.early15Pct + r.early1Pct + r.late15Pct) / 100) * total;
  acc.overHour += ((r.late120Pct + r.late180Pct + r.late360Pct + r.lateMorePct) / 100) * total;
  acc.delaySum += r.avgDelayMin * r.matched;
}

export type Stats = {
  flights: number; // timed (matched) flights behind the figures
  onTimePct: number; // early to 15 min late, whole %
  avgDelayMin: number; // whole minutes; early flights count as 0
  overHourPct: number; // more than 60 min late, 1 decimal
  cancelledPct: number; // of all planned flights, 1 decimal
};

function toStats(acc: Acc, min: number): Stats | null {
  if (acc.matched < min) return null;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    flights: acc.matched,
    onTimePct: Math.round((acc.onTime / acc.matched) * 100),
    avgDelayMin: Math.round(acc.delaySum / acc.matched),
    overHourPct: r1((acc.overHour / acc.matched) * 100),
    cancelledPct: acc.total ? r1((acc.cancelled / acc.total) * 100) : 0,
  };
}

export type MonthStats = Stats & { period: string /* "2025-10" */ };

export type RouteEntry = {
  direction: CaaDirection;
  iata: string;
  slug: string;
  name: string; // other airport as our pages call it
  year: Stats | null; // latest 12 months (null = too few flights)
  months: Record<string, MonthStats>; // "01".."12" → that calendar month in the window
};

export type RouteRef = { iata: string; name: string; onTimePct: number; avgDelayMin: number; flights: number };

export type AirlineEntry = {
  slug: string;
  arrivals: Stats | null;
  departures: Stats | null;
  best: RouteRef[]; // most punctual routes (both directions combined)
  worst: RouteRef[];
};

export type Unmatched = { name: string; country?: string; flights: number; candidates?: string[] };

export type CaaSummary = {
  builtAt: string;
  from: string | null; // first month covered, "2025-09"
  to: string | null; // last month covered, "2026-08"
  months: number; // months with data in the window
  routes: Record<string, RouteEntry>; // routeKey(direction, iata, slug)
  airlines: Record<string, AirlineEntry>;
  unmatchedAirports: Unmatched[]; // busiest first (for the log)
  unmatchedAirlines: Unmatched[];
  gatwick?: GatwickPunctuality | null; // all Gatwick flights (summaries built before Oct 26: absent)
  ukAirports?: UkAirport[]; // busiest UK airports, best on-time arrivals first (Gatwick always in)
};

export type GatwickMonth = { period: string; arrivals: Stats | null; departures: Stats | null };
export type GatwickPunctuality = { arrivals: Stats | null; departures: Stats | null; months: GatwickMonth[] };
export type UkAirport = { name: string; gatwick: boolean; arrivals: Stats | null; departures: Stats | null };

export const UK_AIRPORTS_SHOWN = 8; // the busiest by arrivals (Gatwick always included)
export const RANK_MIN_AIRLINE_FLIGHTS = 300; // an airline is ranked from this many flights in 12 months

export const routeKey = (direction: CaaDirection, iata: string, slug: string) => `${direction}|${iata.toUpperCase()}|${slug}`;

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

/** CAA reporting airport → how we write it: "BELFAST CITY (GEORGE BEST)" → "Belfast City (George Best)". */
export function airportTitle(caa: string): string {
  return titleCase(caa);
}

/**
 * Rows (any months) → summary of the latest 12 months held. Rows older than the window are
 * ignored. Airports and airlines we can't match still count towards the airline's totals
 * (airport unknown) but get no route entry.
 */
export function buildSummary(
  rows: CaaRow[],
  seen: SeenAirport[],
  known: KnownAirline[],
  now: Date,
  airportMonths: AirportMonth[] = []
): CaaSummary {
  const latest = rows.reduce((m, r) => Math.max(m, r.period), 0);
  const empty: CaaSummary = {
    builtAt: now.toISOString(), from: null, to: null, months: 0, routes: {}, airlines: {},
    unmatchedAirports: [], unmatchedAirlines: [], gatwick: null, ukAirports: [],
  };
  if (!latest) return empty;
  const first = addMonths(latest, -(WINDOW_MONTHS - 1));
  const inWindow = rows.filter((r) => r.period >= first && r.period <= latest);
  const periods = [...new Set(inWindow.map((r) => r.period))].sort((a, b) => a - b);

  const seenBy = new Map(seen.map((a) => [a.iata.toUpperCase(), a]));
  const airportMemo = new Map<string, AirportMatch>();
  const airlineMemo = new Map<string, string | null>();
  const badAirports = new Map<string, Unmatched>();
  const badAirlines = new Map<string, Unmatched>();

  const routeYear = new Map<string, Acc>();
  const routeMonth = new Map<string, Map<number, Acc>>();
  const routeMeta = new Map<string, { direction: CaaDirection; iata: string; slug: string }>();
  const airlineDir = new Map<string, Acc>(); // slug|A
  const airlineRoute = new Map<string, Acc>(); // slug|IATA (both directions)

  for (const r of inWindow) {
    const n = r.matched;
    let slug = airlineMemo.get(r.airline);
    if (slug === undefined) {
      slug = matchAirline(r.airline, known);
      airlineMemo.set(r.airline, slug);
    }
    if (!slug) {
      const u = badAirlines.get(r.airline) ?? { name: r.airline, flights: 0 };
      u.flights += n;
      badAirlines.set(r.airline, u);
      continue;
    }
    const ad = `${slug}|${r.direction}`;
    add(airlineDir.get(ad) ?? airlineDir.set(ad, emptyAcc()).get(ad)!, r);

    const ak = `${r.airport}|${r.country}`;
    let am = airportMemo.get(ak);
    if (!am) {
      am = matchAirport(r.airport, r.country, seen);
      airportMemo.set(ak, am);
    }
    if (!am.iata) {
      const u = badAirports.get(ak) ?? { name: r.airport, country: r.country, flights: 0, candidates: "candidates" in am ? am.candidates : [] };
      u.flights += n;
      badAirports.set(ak, u);
      continue;
    }
    const key = routeKey(r.direction, am.iata, slug);
    routeMeta.set(key, { direction: r.direction, iata: am.iata, slug });
    add(routeYear.get(key) ?? routeYear.set(key, emptyAcc()).get(key)!, r);
    const months = routeMonth.get(key) ?? routeMonth.set(key, new Map()).get(key)!;
    add(months.get(r.period) ?? months.set(r.period, emptyAcc()).get(r.period)!, r);
    const ar = `${slug}|${am.iata}`;
    add(airlineRoute.get(ar) ?? airlineRoute.set(ar, emptyAcc()).get(ar)!, r);
  }

  const nameOf = (iata: string): string => {
    const a = seenBy.get(iata);
    if (a?.city) return a.city;
    const raw = rows.find((r) => {
      const m = airportMemo.get(`${r.airport}|${r.country}`);
      return m?.iata === iata;
    })?.airport;
    return raw ? titleCase(raw.replace(/\s*\(.*\)\s*$/, "")) : iata;
  };

  const routes: Record<string, RouteEntry> = {};
  for (const [key, meta] of routeMeta) {
    const months: Record<string, MonthStats> = {};
    for (const [p, acc] of routeMonth.get(key) ?? []) {
      const s = toStats(acc, MIN_MONTH_FLIGHTS);
      if (s) months[String(p % 100).padStart(2, "0")] = { ...s, period: periodIso(p) };
    }
    routes[key] = { ...meta, name: nameOf(meta.iata), year: toStats(routeYear.get(key)!, MIN_FLIGHTS), months };
  }

  const airlines: Record<string, AirlineEntry> = {};
  const slugs = new Set([...airlineDir.keys()].map((k) => k.split("|")[0]));
  for (const slug of slugs) {
    const refs: RouteRef[] = [];
    for (const [k, acc] of airlineRoute) {
      const [s, iata] = k.split("|");
      if (s !== slug) continue;
      const st = toStats(acc, RANK_MIN_FLIGHTS);
      if (st) refs.push({ iata, name: nameOf(iata), onTimePct: st.onTimePct, avgDelayMin: st.avgDelayMin, flights: st.flights });
    }
    const byBest = [...refs].sort((a, b) => b.onTimePct - a.onTimePct || a.avgDelayMin - b.avgDelayMin || b.flights - a.flights);
    const best = byBest.slice(0, RANK_SIZE);
    // Worst only when there are enough routes for "best" and "worst" not to overlap.
    const worst = refs.length >= RANK_SIZE * 2 ? byBest.slice(-RANK_SIZE).reverse() : [];
    airlines[slug] = {
      slug,
      arrivals: toStats(airlineDir.get(`${slug}|A`) ?? emptyAcc(), MIN_FLIGHTS),
      departures: toStats(airlineDir.get(`${slug}|D`) ?? emptyAcc(), MIN_FLIGHTS),
      best,
      worst,
    };
  }

  // Gatwick as a whole: every row, matched to a route or not.
  const gw = { A: emptyAcc(), D: emptyAcc() };
  const gwMonths = new Map<number, { A: Acc; D: Acc }>();
  for (const r of inWindow) {
    add(gw[r.direction], r);
    const m = gwMonths.get(r.period) ?? gwMonths.set(r.period, { A: emptyAcc(), D: emptyAcc() }).get(r.period)!;
    add(m[r.direction], r);
  }
  const gatwick: GatwickPunctuality = {
    arrivals: toStats(gw.A, MIN_FLIGHTS),
    departures: toStats(gw.D, MIN_FLIGHTS),
    months: [...gwMonths.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([p, m]) => ({ period: periodIso(p), arrivals: toStats(m.A, 1), departures: toStats(m.D, 1) })),
  };

  // UK airports over the same months (CaaAirportMonth). Gatwick comes from the same file, so it
  // agrees with the figures above.
  const ap = new Map<string, { A: Acc; D: Acc }>();
  for (const t of airportMonths) {
    if (t.period < first || t.period > latest || (t.direction !== "A" && t.direction !== "D")) continue;
    const e = ap.get(t.airport) ?? ap.set(t.airport, { A: emptyAcc(), D: emptyAcc() }).get(t.airport)!;
    addAcc(e[t.direction], t);
  }
  const byArrivals = [...ap.entries()].sort((a, b) => b[1].A.matched - a[1].A.matched);
  const shown = byArrivals.slice(0, UK_AIRPORTS_SHOWN);
  if (!shown.some(([n]) => n === REPORTING_AIRPORT)) {
    const g = byArrivals.find(([n]) => n === REPORTING_AIRPORT);
    if (g) shown.splice(shown.length - 1, 1, g);
  }
  const ukAirports: UkAirport[] = shown
    .map(([n, e]) => ({
      name: airportTitle(n),
      gatwick: n === REPORTING_AIRPORT,
      arrivals: toStats(e.A, MIN_FLIGHTS),
      departures: toStats(e.D, MIN_FLIGHTS),
    }))
    .filter((a) => a.arrivals)
    .sort((a, b) => b.arrivals!.onTimePct - a.arrivals!.onTimePct || a.arrivals!.avgDelayMin - b.arrivals!.avgDelayMin);

  const busiest = (m: Map<string, Unmatched>) => [...m.values()].sort((a, b) => b.flights - a.flights);
  return {
    builtAt: now.toISOString(),
    from: periods.length ? periodIso(periods[0]) : null,
    to: periods.length ? periodIso(periods[periods.length - 1]) : null,
    months: periods.length,
    routes,
    airlines,
    unmatchedAirports: busiest(badAirports),
    unmatchedAirlines: busiest(badAirlines),
    gatwick,
    ukAirports,
  };
}

// ── Reading (flight pages) ──────────────────────────────────────────────────
export type RoutePunctuality = {
  from: string; // "2025-09"
  to: string; // "2026-08"
  name: string; // the other airport
  year: Stats;
  sameMonth: MonthStats | null; // that calendar month in the window (about a year ago)
};

/** The UK calendar month ("10") of a flight's Gatwick time. */
export function ukMonth(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", month: "2-digit" }).format(new Date(iso));
}

/** One flight page → its route's figures, or null (unknown route / too few flights). */
export function routeStats(
  summary: CaaSummary | null,
  direction: "ARRIVAL" | "DEPARTURE",
  iata: string | null,
  slug: string | null,
  scheduledUtc: string | null
): RoutePunctuality | null {
  if (!summary?.from || !summary.to || !iata || !slug) return null;
  const r = summary.routes[routeKey(direction === "ARRIVAL" ? "A" : "D", iata, slug)];
  if (!r?.year) return null;
  const month = scheduledUtc ? ukMonth(scheduledUtc) : null;
  return { from: summary.from, to: summary.to, name: r.name, year: r.year, sameMonth: (month && r.months[month]) || null };
}

/** Airline page → its Gatwick figures, or null. */
export function airlineStats(summary: CaaSummary | null, slug: string) {
  const a = summary?.airlines[slug];
  if (!summary?.from || !summary.to || !a || (!a.arrivals && !a.departures)) return null;
  return { from: summary.from, to: summary.to, ...a };
}

/** Terminals hub: each airline's arrivals / departures figures (ranked on the website from 300 flights). */
export function airlineScores(summary: CaaSummary | null) {
  if (!summary?.from || !summary.to) return null;
  const airlines: Record<string, { arrivals: Stats | null; departures: Stats | null }> = {};
  for (const [slug, a] of Object.entries(summary.airlines)) airlines[slug] = { arrivals: a.arrivals, departures: a.departures };
  return { from: summary.from, to: summary.to, minFlights: RANK_MIN_AIRLINE_FLIGHTS, airlines };
}

/** /gatwick/delays page: Gatwick overall, month by month, and the UK airports compared. */
export function gatwickDelays(summary: CaaSummary | null) {
  const g = summary?.gatwick;
  if (!summary?.from || !summary.to || !g || (!g.arrivals && !g.departures)) return null;
  return { from: summary.from, to: summary.to, gatwick: g, airports: summary.ukAirports ?? [] };
}
