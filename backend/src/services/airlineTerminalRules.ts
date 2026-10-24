// backend/src/services/airlineTerminalRules.ts
//
// Website "Which Gatwick terminal?" pages (/gatwick/terminals, /gatwick/terminals/easyjet) —
// PURE logic, no I/O (tests: scripts/test-airline-terminals.ts).
//
//   airlineOf()        a board flight → the airline it's shown under (easyJet = U2, DS and EC)
//   observationsOf()   a board refresh → one small record per operating flight
//   mergeObservations() keep each flight once (the newest copy), drop anything older than 7 days
//   summarise()        records → one line per airline: flights, North/South counts, the answer
//                      ("NORTH" | "SOUTH" | "BOTH"), and a recent move between terminals
//
// Only terminals the provider actually sent are counted. A terminal we filled in from the
// airline's other flights (terminalInferred) would just repeat the answer back to itself.
import type { BoardFlight, Direction, Terminal } from "./flightBoardRules";
import { isFlightNumber, londonDate } from "./flightBoardRules";

export const WINDOW_DAYS = 7; // AeroDataBox caching limit in our plan terms
export const PAGE_MIN_FLIGHTS = 20; // an airline gets its own indexed page from this many flights
export const MAIN_SHARE = 0.9; // one terminal for ≥ 90% of stated flights → that's the answer
const DAY_MIN_STATED = 2; // a day counts towards "moved" only with ≥ 2 stated terminals
const DAY_MS = 86_400_000;

export type TerminalAnswer = Terminal | "BOTH";

export type Observation = {
  id: string; // the board flight id (direction|number|scheduled)
  slug: string;
  name: string;
  code: string | null; // IATA code as the provider sent it
  direction: Direction;
  scheduledUtc: string;
  terminal: Terminal | null; // stated by the provider (inferred terminals are left out)
  displayNumber: string;
};

export type TerminalMove = { from: Terminal; to: Terminal; since: string /* UK date */ };

export type AirlineTerminal = {
  slug: string;
  name: string;
  codes: string[];
  flights: number;
  arrivals: number;
  departures: number;
  north: number; // flights with a stated North terminal
  south: number;
  terminal: TerminalAnswer | null; // null = no terminal seen yet
  mainShare: number | null; // share of stated flights at the answer terminal (null for BOTH/none)
  moved: TerminalMove | null;
  firstDate: string; // UK date of the earliest flight counted
  lastDate: string;
  hasPage: boolean; // enough flights for its own indexed page
};

// ── Which airline a flight is shown under ───────────────────────────────────
// Brands that fly under several codes get one page. Everyone else: the provider's name.
const GROUPS: Record<string, { slug: string; name: string }> = {};
const group = (slug: string, name: string, codes: string[]) => codes.forEach((c) => (GROUPS[c] = { slug, name }));
group("easyjet", "easyJet", ["U2", "DS", "EC"]);
group("wizz-air", "Wizz Air", ["W6", "W4", "W9"]);
group("norwegian", "Norwegian", ["DY", "D8"]);
group("ryanair", "Ryanair", ["FR", "RK"]);
group("tui", "TUI", ["BY", "X3"]);
group("british-airways", "British Airways", ["BA"]);

/** "Aer Lingus" → "aer-lingus"; accents dropped; null if nothing usable is left. */
export function slugify(s: string): string | null {
  const out = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out || null;
}

/** The airline page a flight belongs to, or null when the provider gave no airline. */
export function airlineOf(a: { iata: string | null; icao?: string | null; name: string | null }): { slug: string; name: string } | null {
  const code = a.iata?.toUpperCase() ?? null;
  if (code && GROUPS[code]) return GROUPS[code];
  const name = a.name?.trim() || null;
  const slug = (name && slugify(name)) || (code && slugify(code)) || null;
  return slug ? { slug, name: name ?? code! } : null;
}

/** Slug only (for links on the flight pages). */
export const airlineSlug = (a: { iata: string | null; icao?: string | null; name: string | null }) => airlineOf(a)?.slug ?? null;

// ── Recording ───────────────────────────────────────────────────────────────
/** One record per operating flight on a board refresh (codeshare and call-sign entries left out). */
export function observationsOf(flights: BoardFlight[]): Observation[] {
  const out: Observation[] = [];
  for (const f of flights) {
    if (f.codeshare === "CODESHARE" || !isFlightNumber(f.number)) continue;
    const a = airlineOf(f.airline);
    if (!a) continue;
    out.push({
      id: f.id,
      slug: a.slug,
      name: a.name,
      code: f.airline.iata?.toUpperCase() ?? null,
      direction: f.direction,
      scheduledUtc: f.lgw.scheduledUtc,
      terminal: f.lgw.terminalInferred ? null : f.lgw.terminal,
      displayNumber: f.displayNumber,
    });
  }
  return out;
}

/**
 * Old records + this refresh → each flight once. A newer copy replaces an older one, except
 * that a terminal once stated is kept if the newer copy has none (the provider sometimes
 * drops it near departure). Flights scheduled more than 7 days ago are dropped.
 */
export function mergeObservations(old: Observation[], fresh: Observation[], now: Date): Observation[] {
  const cutoff = now.getTime() - WINDOW_DAYS * DAY_MS;
  const byId = new Map<string, Observation>();
  for (const o of old) byId.set(o.id, o);
  for (const o of fresh) {
    const prev = byId.get(o.id);
    byId.set(o.id, prev && !o.terminal && prev.terminal ? { ...o, terminal: prev.terminal } : o);
  }
  return [...byId.values()]
    .filter((o) => Date.parse(o.scheduledUtc) >= cutoff)
    .sort((a, b) => a.scheduledUtc.localeCompare(b.scheduledUtc));
}

// ── Summarising ─────────────────────────────────────────────────────────────
function answerFor(north: number, south: number): { terminal: TerminalAnswer | null; share: number | null } {
  const stated = north + south;
  if (!stated) return { terminal: null, share: null };
  const top: Terminal = north >= south ? "NORTH" : "SOUTH";
  const share = Math.max(north, south) / stated;
  return share >= MAIN_SHARE ? { terminal: top, share } : { terminal: "BOTH", share: null };
}

/**
 * A move between terminals: the most recent run of days (each with ≥ 2 stated terminals and one
 * clear terminal) follows at least 2 days at the OTHER terminal. Days with both terminals in use
 * break the pattern, so an airline that simply uses both is never reported as moving.
 */
export function findMove(obs: Observation[]): TerminalMove | null {
  const days = new Map<string, { n: number; s: number }>();
  for (const o of obs) {
    if (!o.terminal) continue;
    const d = londonDate(new Date(o.scheduledUtc));
    const c = days.get(d) ?? { n: 0, s: 0 };
    if (o.terminal === "NORTH") c.n++;
    else c.s++;
    days.set(d, c);
  }
  const daily = [...days.entries()]
    .filter(([, c]) => c.n + c.s >= DAY_MIN_STATED)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, c]) => ({ date, t: answerFor(c.n, c.s).terminal }));
  if (daily.length < 3) return null;
  const last = daily[daily.length - 1].t;
  if (last !== "NORTH" && last !== "SOUTH") return null;
  let i = daily.length - 1;
  while (i > 0 && daily[i - 1].t === last) i--;
  const before = daily.slice(0, i);
  if (before.length < 2) return null;
  const from = before[before.length - 1].t;
  if ((from !== "NORTH" && from !== "SOUTH") || from === last) return null;
  if (before.slice(-2).some((d) => d.t !== from)) return null;
  return { from, to: last, since: daily[i].date };
}

/** One line per airline, busiest first. */
export function summarise(obs: Observation[]): AirlineTerminal[] {
  const by = new Map<string, Observation[]>();
  for (const o of obs) by.set(o.slug, [...(by.get(o.slug) ?? []), o]);
  const out: AirlineTerminal[] = [];
  for (const [slug, list] of by) {
    const north = list.filter((o) => o.terminal === "NORTH").length;
    const south = list.filter((o) => o.terminal === "SOUTH").length;
    const moved = findMove(list);
    // After a move, the answer is where the airline is NOW, from the move onwards.
    const since = moved ? list.filter((o) => londonDate(new Date(o.scheduledUtc)) >= moved.since) : list;
    const a = moved
      ? answerFor(
          since.filter((o) => o.terminal === "NORTH").length,
          since.filter((o) => o.terminal === "SOUTH").length
        )
      : answerFor(north, south);
    const dates = list.map((o) => londonDate(new Date(o.scheduledUtc))).sort();
    out.push({
      slug,
      name: mostCommon(list.map((o) => o.name)),
      codes: [...new Set(list.map((o) => o.code).filter((c): c is string => !!c))].sort(),
      flights: list.length,
      arrivals: list.filter((o) => o.direction === "ARRIVAL").length,
      departures: list.filter((o) => o.direction === "DEPARTURE").length,
      north,
      south,
      terminal: a.terminal,
      mainShare: a.share,
      moved,
      firstDate: dates[0],
      lastDate: dates[dates.length - 1],
      hasPage: list.length >= PAGE_MIN_FLIGHTS,
    });
  }
  return out.sort((a, b) => b.flights - a.flights || a.name.localeCompare(b.name));
}

function mostCommon(xs: string[]): string {
  const count = new Map<string, number>();
  for (const x of xs) count.set(x, (count.get(x) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

/** Days covered by the records, 1–7 (the pages say "in the last N days"). */
export function daysCovered(firstDate: string, now: Date): number {
  const first = Date.parse(`${firstDate}T12:00:00Z`);
  const today = Date.parse(`${londonDate(now)}T12:00:00Z`);
  return Math.min(WINDOW_DAYS, Math.max(1, Math.round((today - first) / DAY_MS) + 1));
}
