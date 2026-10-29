// backend/src/services/flightBoardRules.ts
//
// Public flight status page (website) — PURE logic, no I/O, so every case can
// be tested in isolation (scripts/test-flight-board-rules.ts).
//
//   parseBoard()      AeroDataBox airport board (FIDS, withLeg=true) → BoardFlight[]
//   parseLookupLegs() one flight from /flights/number → BoardFlight[] (LGW legs only)
//   matchKey()        "EZY8687" / "U2 8687" / "ezy 08687" → one comparable key
//   findInBoard()     flights matching what a visitor typed (+ optional date)
//   describe()        BoardFlight → FlightView: state, colour, and every time the
//                     page shows. Arrivals use the SAME gate-arrival rule as booking
//                     tracking (flightRules.interpretFlight), so the public page never
//                     disagrees with a passenger's SMS.
//   boardWindow()     the 12-hour local-time window for the board request
//
// Wording lives on the website; this file only returns states and times.
import { interpretFlight, TAXI_MIN } from "./flightRules";
import { normaliseFlightNumber } from "./flightData.service";

export const AIRPORT_IATA = "LGW";
const MIN = 60_000;

// Departures: how early to be at the airport (airline rules vary; the page says so).
export const BE_THERE_SHORT_MIN = 120;
export const BE_THERE_LONG_MIN = 180;
const LONG_HAUL_MIN = 270; // scheduled flight time ≥ 4h30 → long-haul advice
// Gatwick usually shows the gate ~40 min and starts boarding ~30 min before departure.
export const GATE_SHOWN_BEFORE_MIN = 40;
export const BOARDING_BEFORE_MIN = 30;
// Arrivals with no take-off reported: how long after the expected departure before we say it
// should be flying (taxi out + some slack).
export const TAKE_OFF_GRACE_MIN = 15;
// "Running late / early" thresholds, same as booking messages.
export const LATE_MIN = 15;
export const EARLY_MIN = 10;

// ── Types ─────────────────────────────────────────────────────────────────
export type Direction = "ARRIVAL" | "DEPARTURE";
export type Terminal = "NORTH" | "SOUTH";
export type Codeshare = "OPERATOR" | "CODESHARE" | "UNKNOWN";

/** The other end of the trip (origin for arrivals, destination for departures). */
export type OtherEnd = {
  iata: string | null;
  name: string | null; // city where known, e.g. "Amsterdam"
  // Provider's own names (matching CAA punctuality names to IATA); absent on boards cached before Oct 2026.
  airportName?: string | null; // e.g. "Paris Charles de Gaulle"
  municipality?: string | null; // e.g. "Luqa"
  scheduledUtc: string | null;
  revisedUtc: string | null;
  runwayUtc: string | null; // actual take-off (arrivals) / touchdown (departures)
  scheduledLocal: string | null; // "HH:MM" in that airport's own time
  revisedLocal: string | null;
  runwayLocal: string | null;
  countryCode: string | null; // ISO 3166 alpha-2, e.g. "CH" (flags)
  lat: number | null; // airport position (weather)
  lon: number | null;
  timeZone: string | null; // IANA, e.g. "Europe/Zurich" (local time there)
};

/** The Gatwick side of the trip. */
export type GatwickEnd = {
  scheduledUtc: string;
  revisedUtc: string | null;
  predictedUtc: string | null;
  runwayUtc: string | null;
  terminal: Terminal | null;
  // True when the provider didn't say and we filled it from the same airline's other flights
  // on today's board (only when they ALL use one terminal).
  terminalInferred: boolean;
  gate: string | null;
  baggageBelt: string | null; // arrivals only
  checkInDesk: string | null; // departures only
  live: boolean; // provider has live tracking for this movement
};

export type BoardFlight = {
  id: string; // stable per flight: direction|number|scheduled
  direction: Direction;
  number: string; // provider format, e.g. "U2 8687"
  displayNumber: string; // as on the ticket and Gatwick's screens, e.g. "EZY8687"
  keys: string[]; // every way a visitor might type it, as matchKey() values
  airline: { name: string | null; iata: string | null; icao: string | null };
  codeshare: Codeshare;
  operatedBy: string | null; // codeshares: the operating flight's number, when found
  status: string | null; // provider word, e.g. "EnRoute"
  aircraft: string | null; // e.g. "Airbus A320neo"
  other: OtherEnd;
  lgw: GatwickEnd;
};

export type FlightState =
  | "SCHEDULED"
  | "DELAYED"
  | "CHECK_IN"
  | "BOARDING"
  | "GATE_CLOSED"
  | "EN_ROUTE"
  | "LANDED"
  | "DEPARTED"
  | "CANCELLED"
  | "MAYBE_CANCELLED"
  | "DIVERTED";
export type Tone = "info" | "late" | "early" | "good" | "bad";
/**
 * Arrivals: how sure we are that the plane is flying (no take-off is ever reported from some
 * origins — Split, Hurghada, Athens, Gran Canaria…).
 *  REPORTED     take-off time or an in-flight status from the provider
 *  TRACKED      no take-off reported, but the provider has live tracking / a predicted landing,
 *               and the departure time is 15+ min ago → shown as in the air
 *  UNCONFIRMED  departure time 15+ min ago, no take-off and no tracking: it may be flying or
 *               stuck on the ground → never shown as in the air ("not confirmed"). Its time is
 *               the airline's latest, not the booking rule's "can't leave before now" floor (that
 *               invented hours of delay on long flights, e.g. Sharm +115 min).
 *  The provider sometimes sends no origin details at all (seen: XQ3690 "Mugla", no airport code,
 *  no times) → `departureUnknown`; then we can't tell either way.
 *  null         not due to have left yet, landed, cancelled, diverted, or a departure
 */
export type InAir = "REPORTED" | "TRACKED" | "UNCONFIRMED" | null;

export type FlightView = {
  state: FlightState;
  tone: Tone;
  scheduledAt: string; // at Gatwick: gate arrival (arrivals) / leaving the gate (departures)
  expectedAt: string | null; // same basis; null when cancelled
  delayMin: number | null; // + late, − early
  // Arrivals
  takeOffAt: string | null; // from the origin
  landsAt: string | null; // touchdown: actual, or estimate (gate − taxi)
  landed: boolean;
  arrivedTimeIsGate: boolean; // "Arrived" with no touchdown time: landsAt is the gate time
  gateAt: string | null; // at the gate (arrivals)
  outHandAt: string | null; // out of arrivals, hand luggage only
  outBagsAt: string | null; // out of arrivals, with checked bags
  progress: number | null; // 0–1 while in the air
  minutesToGo: number | null; // until landing
  inAir: InAir;
  departureUnknown: boolean; // arrivals: no departure time from the origin at all
  overdueMin: number | null; // minutes past the expected touchdown while not yet landed
  // Departures
  departedAt: string | null;
  beThereBy: string | null;
  gateShownAt: string | null; // estimate, only while the gate isn't known
  boardingAt: string | null; // estimate
  longHaul: boolean;
};

// ── Parsing ───────────────────────────────────────────────────────────────
type Raw = Record<string, any>;

/** "2026-10-29 15:15Z" (space, not "T") → ISO, or null. */
function utc(t: unknown): string | null {
  const raw = (t as { utc?: string } | null)?.utc;
  if (typeof raw !== "string" || !raw) return null;
  const d = new Date(raw.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "2026-10-29 16:15+01:00" → "16:15" (the airport's own clock). */
function localHm(t: unknown): string | null {
  const raw = (t as { local?: string } | null)?.local;
  const m = typeof raw === "string" ? raw.match(/[ T](\d{2}:\d{2})/) : null;
  return m ? m[1] : null;
}

function terminal(t: unknown): Terminal | null {
  const s = typeof t === "string" ? t.trim().toUpperCase() : "";
  if (s === "N" || s === "NORTH") return "NORTH";
  if (s === "S" || s === "SOUTH") return "SOUTH";
  return null;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function codeshare(v: unknown): Codeshare {
  if (v === "IsOperator" || v === 1) return "OPERATOR";
  if (v === "IsCodeshared" || v === 2) return "CODESHARE";
  return "UNKNOWN";
}

// Enum words; the numeric form (web-hooks) follows the provider's documented order.
const STATUS_NAMES = [
  "Unknown", "Expected", "EnRoute", "CheckIn", "Boarding", "GateClosed", "Departed",
  "Delayed", "Approaching", "Arrived", "Canceled", "Diverted", "CanceledUncertain",
];
function statusWord(s: unknown): string | null {
  if (typeof s === "string") return s;
  if (typeof s === "number") return STATUS_NAMES[s] ?? null;
  return null;
}

/** Split "U2 8687" / "EZY8687" → { code, num } (num without leading zeros). */
function splitNumber(n: string): { code: string; num: string } | null {
  const s = n.toUpperCase().replace(/[\s-]/g, "");
  const m = s.match(/^([A-Z0-9]{2}[A-Z]?)(\d{1,5})([A-Z]?)$/);
  if (!m || !/[A-Z]/.test(m[1])) return null;
  return { code: m[1], num: String(parseInt(m[2], 10)) + m[3] };
}

/** One comparable key for anything a visitor might type; null if it isn't a flight number. */
export function matchKey(input: string): string | null {
  const n = normaliseFlightNumber(input ?? "");
  if (!n) return null;
  const p = splitNumber(n);
  return p ? p.code + p.num : null;
}

// Airlines whose tickets and Gatwick's screens use a different code from the IATA one the
// provider sends (seen on Gatwick's board: easyJet = EZY). Everyone else: IATA, no space.
// TUI's UK flights are shown as TOM (e.g. TOM627), not BY.
const TICKET_CODE: Record<string, string> = { U2: "EZY", DS: "EZS", EC: "EJU", BY: "TOM" };

// The provider names an airport by the town it's in ("Luqa", "Arrecife", "Kerkyra"). People know
// the destination, so common Gatwick routes get the familiar name. Others: the provider's name,
// cut at a "/" ("Montpellier/Méditerranée" → "Montpellier").
const CITY_NAME: Record<string, string> = {
  MLA: "Malta", ACE: "Lanzarote", FUE: "Fuerteventura", LPA: "Gran Canaria", TFS: "Tenerife South",
  TFN: "Tenerife North", IBZ: "Ibiza", MAH: "Menorca", PMI: "Palma de Mallorca", CFU: "Corfu",
  JTR: "Santorini", JMK: "Mykonos", HER: "Heraklion", CHQ: "Chania", KGS: "Kos", ZTH: "Zakynthos",
  RHO: "Rhodes", EFL: "Kefalonia", PVK: "Preveza", SKG: "Thessaloniki", BJV: "Bodrum",
  DLM: "Dalaman", SPU: "Split", DBV: "Dubrovnik", TIV: "Tivat", FNC: "Madeira", PDL: "Azores",
  SID: "Sal", BVC: "Boa Vista", MRU: "Mauritius", BGI: "Barbados", ANU: "Antigua", UVF: "St Lucia",
  GND: "Grenada", PUJ: "Punta Cana", KEF: "Reykjavik", GRO: "Girona", REU: "Reus",
  TSF: "Venice Treviso", BGY: "Milan Bergamo", MXP: "Milan Malpensa", LIN: "Milan Linate",
  CIA: "Rome Ciampino", FCO: "Rome", ORY: "Paris Orly", CDG: "Paris", BVA: "Paris Beauvais",
  GCI: "Guernsey", IOM: "Isle of Man", MPL: "Montpellier", SSH: "Sharm el-Sheikh",
  OLB: "Olbia", BOJ: "Burgas", VAR: "Varna", LCA: "Larnaca", PFO: "Paphos", BFS: "Belfast",
};

function cityName(airport: Raw | undefined): string | null {
  const iata = text(airport?.iata)?.toUpperCase();
  if (iata && CITY_NAME[iata]) return CITY_NAME[iata];
  const raw = text(airport?.municipalityName) ?? text(airport?.shortName) ?? text(airport?.name);
  return raw ? raw.split("/")[0].trim() || raw : null;
}

/** "U2 8687" → "EZY8687"; "BA 2525" → "BA2525". */
export function displayNumberFor(number: string, airlineIata: string | null): string {
  const p = splitNumber(number);
  if (!p) return number.replace(/\s/g, "");
  const code = TICKET_CODE[(airlineIata ?? p.code).toUpperCase()] ?? TICKET_CODE[p.code] ?? p.code;
  return code + p.num;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function keysFor(number: string, iata: string | null, icao: string | null): string[] {
  const p = splitNumber(number);
  if (!p) return [];
  const codes = new Set([p.code, iata, icao].filter((c): c is string => !!c).map((c) => c.toUpperCase()));
  return [...codes].map((c) => c + p.num);
}

function movementOf(m: Raw | undefined) {
  return {
    airport: m?.airport ?? {},
    scheduledUtc: utc(m?.scheduledTime),
    revisedUtc: utc(m?.revisedTime),
    predictedUtc: utc(m?.predictedTime),
    runwayUtc: utc(m?.runwayTime),
    scheduledLocal: localHm(m?.scheduledTime),
    revisedLocal: localHm(m?.revisedTime),
    runwayLocal: localHm(m?.runwayTime),
    terminal: terminal(m?.terminal),
    gate: text(m?.gate),
    baggageBelt: text(m?.baggageBelt),
    checkInDesk: text(m?.checkInDesk),
    live: Array.isArray(m?.quality) && m!.quality.some((q: unknown) => q === "Live" || q === 1),
  };
}

/**
 * One provider flight → BoardFlight, from the Gatwick point of view.
 * Accepts board items with withLeg=true (departure + arrival) or without
 * (movement only: the other airport's details, Gatwick's times).
 */
function toBoardFlight(item: Raw, direction: Direction): BoardFlight | null {
  const number = text(item?.number);
  if (!number) return null;
  let lgwRaw: Raw | undefined;
  let otherRaw: Raw | undefined;
  if (item.movement && !item.departure && !item.arrival) {
    lgwRaw = item.movement; // times at Gatwick…
    otherRaw = { airport: item.movement.airport }; // …airport = the other end
  } else {
    lgwRaw = direction === "ARRIVAL" ? item.arrival : item.departure;
    otherRaw = direction === "ARRIVAL" ? item.departure : item.arrival;
  }
  const g = movementOf(lgwRaw);
  const o = movementOf(otherRaw);
  if (!g.scheduledUtc) return null;
  const airline = {
    name: text(item.airline?.name),
    iata: text(item.airline?.iata),
    icao: text(item.airline?.icao),
  };
  return {
    id: `${direction}|${number.replace(/\s/g, "")}|${g.scheduledUtc}`,
    direction,
    number,
    displayNumber: displayNumberFor(number, airline.iata),
    keys: keysFor(number, airline.iata, airline.icao),
    airline,
    codeshare: codeshare(item.codeshareStatus),
    operatedBy: null,
    status: statusWord(item.status),
    aircraft: text(item.aircraft?.model),
    other: {
      iata: text(o.airport?.iata),
      name: cityName(o.airport),
      airportName: text(o.airport?.name),
      municipality: text(o.airport?.municipalityName),
      scheduledUtc: o.scheduledUtc,
      revisedUtc: o.revisedUtc,
      runwayUtc: o.runwayUtc,
      scheduledLocal: o.scheduledLocal,
      revisedLocal: o.revisedLocal,
      runwayLocal: o.runwayLocal,
      countryCode: (text(o.airport?.countryCode) ?? "").toUpperCase().slice(0, 2) || null,
      lat: num(o.airport?.location?.lat),
      lon: num(o.airport?.location?.lon),
      timeZone: text(o.airport?.timeZone),
    },
    lgw: {
      scheduledUtc: g.scheduledUtc,
      revisedUtc: g.revisedUtc,
      predictedUtc: g.predictedUtc,
      runwayUtc: g.runwayUtc,
      terminal: g.terminal,
      terminalInferred: false,
      gate: g.gate,
      baggageBelt: direction === "ARRIVAL" ? g.baggageBelt : null,
      checkInDesk: direction === "DEPARTURE" ? g.checkInDesk : null,
      live: g.live,
    },
  };
}

/** Codeshares → the operating flight (same direction, Gatwick time and other airport). */
function linkCodeshares(flights: BoardFlight[]): BoardFlight[] {
  const operators = new Map<string, string>();
  const slot = (f: BoardFlight) => `${f.direction}|${f.lgw.scheduledUtc}|${f.other.iata ?? ""}`;
  for (const f of flights) if (f.codeshare !== "CODESHARE") operators.set(slot(f), f.number);
  return flights.map((f) =>
    f.codeshare === "CODESHARE" ? { ...f, operatedBy: operators.get(slot(f)) ?? null } : f
  );
}

/** AeroDataBox airport board response ({ arrivals, departures }) → flights, earliest first. */
export function parseBoard(body: unknown): BoardFlight[] {
  const b = (body ?? {}) as Raw;
  const list = (arr: unknown, dir: Direction) =>
    (Array.isArray(arr) ? arr : [])
      .filter((i) => !i?.isCargo)
      .map((i) => toBoardFlight(i, dir))
      .filter((f): f is BoardFlight => !!f);
  const all = [...list(b.arrivals, "ARRIVAL"), ...list(b.departures, "DEPARTURE")];
  const seen = new Set<string>();
  const unique = all.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
  unique.sort((a, b2) => a.lgw.scheduledUtc.localeCompare(b2.lgw.scheduledUtc));
  return fillTerminals(linkCodeshares(dropCallsignDuplicates(unique)));
}

/** A real flight number: airline code + digits + optional letter ("BA 2683", "U2 8687A"). */
export function isFlightNumber(n: string): boolean {
  return splitNumber(n) !== null;
}

/**
 * The provider sometimes lists a flight a second time under an air-traffic call sign instead of
 * its flight number (seen live: "A0 42YR" Ibiza 21:24 next to BA2683 Ibiza 21:25). Drop such an
 * entry when a proper flight in the same direction, to/from the same airport, is within 20 min.
 * A call-sign entry with no such twin stays (it may be the only record of that flight).
 */
export function dropCallsignDuplicates(flights: BoardFlight[]): BoardFlight[] {
  const proper = flights.filter((f) => isFlightNumber(f.number));
  return flights.filter((f) => {
    if (isFlightNumber(f.number)) return true;
    const t = Date.parse(f.lgw.scheduledUtc);
    return !proper.some(
      (p) =>
        p.direction === f.direction &&
        p.other.iata === f.other.iata &&
        Math.abs(Date.parse(p.lgw.scheduledUtc) - t) <= 20 * MIN
    );
  });
}

/**
 * The provider often leaves Gatwick's terminal blank (seen: many easyJet flights that Gatwick's
 * own board lists as North). Terminals at Gatwick go by airline, so when an airline's flights
 * that DO have a terminal on today's board all use the same one (and there are at least 2 of
 * them), fill its blanks with that terminal. An airline seen at both terminals stays blank.
 */
export function fillTerminals(flights: BoardFlight[]): BoardFlight[] {
  const seen = new Map<string, { terms: Set<Terminal>; count: number }>();
  const airlineKey = (f: BoardFlight) => (f.airline.iata ?? f.airline.icao ?? f.number.slice(0, 2)).toUpperCase();
  for (const f of flights) {
    if (!f.lgw.terminal || f.codeshare === "CODESHARE") continue;
    const k = airlineKey(f);
    const s = seen.get(k) ?? { terms: new Set<Terminal>(), count: 0 };
    s.terms.add(f.lgw.terminal);
    s.count++;
    seen.set(k, s);
  }
  return flights.map((f) => {
    if (f.lgw.terminal) return f;
    const s = seen.get(airlineKey(f));
    if (!s || s.terms.size !== 1 || s.count < 2) return f;
    return { ...f, lgw: { ...f.lgw, terminal: [...s.terms][0], terminalInferred: true } };
  });
}

/** /flights/number response → only the legs that land at or leave from Gatwick. */
export function parseLookupLegs(body: unknown): BoardFlight[] {
  if (!Array.isArray(body)) return [];
  const out: BoardFlight[] = [];
  for (const item of body) {
    if (item?.arrival?.airport?.iata === AIRPORT_IATA) {
      const f = toBoardFlight(item, "ARRIVAL");
      if (f) out.push(f);
    }
    if (item?.departure?.airport?.iata === AIRPORT_IATA) {
      const f = toBoardFlight(item, "DEPARTURE");
      if (f) out.push(f);
    }
  }
  return out.sort((a, b) => a.lgw.scheduledUtc.localeCompare(b.lgw.scheduledUtc));
}

// ── Finding a flight ──────────────────────────────────────────────────────
/** UK calendar date (YYYY-MM-DD) of an instant. */
export function londonDate(d: Date): string {
  return londonParts(d).date;
}

function londonParts(d: Date): { date: string; hm: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "00";
  return { date: `${p("year")}-${p("month")}-${p("day")}`, hm: `${p("hour")}:${p("minute")}` };
}

/**
 * Flights matching what the visitor typed; with a date, only those scheduled at
 * Gatwick on that UK date. Codeshares included (searching any number works).
 * Nearest to `now` first.
 */
export function findInBoard(
  flights: BoardFlight[],
  input: string,
  dateLocal: string | null,
  now: Date = new Date()
): BoardFlight[] {
  const key = matchKey(input);
  if (!key) return [];
  return flights
    .filter((f) => f.keys.includes(key))
    .filter((f) => !dateLocal || londonDate(new Date(f.lgw.scheduledUtc)) === dateLocal)
    .sort(
      (a, b) =>
        Math.abs(Date.parse(a.lgw.scheduledUtc) - now.getTime()) -
        Math.abs(Date.parse(b.lgw.scheduledUtc) - now.getTime())
    );
}

/** The board as shown on the page: operating flights only (codeshares are searchable, not listed). */
export function boardList(flights: BoardFlight[], direction: Direction): BoardFlight[] {
  return flights.filter((f) => f.direction === direction && f.codeshare !== "CODESHARE");
}

// ── Describing a flight ───────────────────────────────────────────────────
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const at = (s: string | null) => (s ? new Date(s) : null);
const addMin = (d: Date, m: number) => new Date(d.getTime() + m * MIN);
const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / MIN);

function toneFor(delay: number | null): Tone {
  if (delay != null && delay >= LATE_MIN) return "late";
  if (delay != null && delay <= -EARLY_MIN) return "early";
  return "info";
}

const EMPTY = {
  takeOffAt: null,
  landsAt: null,
  landed: false,
  arrivedTimeIsGate: false,
  gateAt: null,
  outHandAt: null,
  outBagsAt: null,
  progress: null,
  minutesToGo: null,
  inAir: null as InAir,
  departureUnknown: false,
  overdueMin: null,
  departedAt: null,
  beThereBy: null,
  gateShownAt: null,
  boardingAt: null,
  longHaul: false,
};

export function describe(
  f: BoardFlight,
  now: Date = new Date(),
  buffers: { hand: number; checked: number } = { hand: 30, checked: 45 }
): FlightView {
  return f.direction === "ARRIVAL" ? describeArrival(f, now, buffers) : describeDeparture(f, now);
}

function describeArrival(
  f: BoardFlight,
  now: Date,
  buffers: { hand: number; checked: number }
): FlightView {
  const status = (f.status ?? "").toLowerCase();
  const scheduled = new Date(f.lgw.scheduledUtc);
  if (status === "canceleduncertain")
    return { ...EMPTY, state: "MAYBE_CANCELLED", tone: "bad", scheduledAt: f.lgw.scheduledUtc, expectedAt: null, delayMin: null };

  const facts = (status: string | null) => ({
    status,
    scheduledArrivalUtc: f.lgw.scheduledUtc,
    revisedArrivalUtc: f.lgw.revisedUtc,
    predictedArrivalUtc: f.lgw.predictedUtc,
    runwayArrivalUtc: f.lgw.runwayUtc,
    departureScheduledUtc: f.other.scheduledUtc,
    departureRevisedUtc: f.other.revisedUtc,
    departureRunwayUtc: f.other.runwayUtc,
  });
  let it = interpretFlight(facts(f.status), now);

  // No take-off reported. Past the expected departure (+ grace) it's either flying unseen or
  // stuck on the ground. Only call it "in the air" with evidence the provider is tracking it
  // (live quality or a predicted landing); then use the shared rule's "in flight, no take-off
  // time" estimate (latest of revised / predicted / scheduled) instead of the on-the-ground
  // time floor, which would push the landing later every minute. interpretFlight itself is
  // unchanged (booking tracking uses it), we only ask it with an in-flight status.
  const depExpected = at(f.other.revisedUtc) ?? at(f.other.scheduledUtc);
  const dueToHaveLeft = !!depExpected && now >= addMin(depExpected, TAKE_OFF_GRACE_MIN);
  const tracked = f.lgw.live || !!f.lgw.predictedUtc;
  let inAir: InAir = null;
  if (it.phase === "SCHEDULED") {
    if (it.departed) inAir = "REPORTED";
    else if (dueToHaveLeft && tracked) {
      it = interpretFlight(facts("EnRoute"), now);
      inAir = "TRACKED";
    } else if (dueToHaveLeft) {
      // Airline's latest time; never the on-the-ground floor (no fake delays on the public page).
      it = interpretFlight(facts("EnRoute"), now);
      inAir = "UNCONFIRMED";
    }
  }
  // Only near the time (as the page's "Scheduled" label): days ahead, a missing departure means nothing yet.
  const departureUnknown =
    !depExpected && !f.other.runwayUtc && inAir === null && scheduled.getTime() - now.getTime() <= 6 * 60 * MIN;

  if (it.phase === "CANCELLED" || it.phase === "DIVERTED")
    return {
      ...EMPTY,
      state: it.phase,
      tone: "bad",
      scheduledAt: f.lgw.scheduledUtc,
      expectedAt: null,
      delayMin: null,
      takeOffAt: f.other.runwayUtc,
    };

  const gate = it.gateArrival;
  const delay = minutesBetween(scheduled, gate);
  const landed = it.phase === "ARRIVED";
  const arrivedTimeIsGate = landed && !f.lgw.runwayUtc;
  const lands = landed ? it.landedAt ?? gate : addMin(gate, -TAXI_MIN);
  // Shown as "Took off": a reported take-off only. TRACKED flights use the expected departure
  // just for the progress bar.
  const takeOff = at(f.other.runwayUtc) ?? (inAir === "REPORTED" ? at(f.other.revisedUtc) : null);
  const barFrom = takeOff ?? (inAir === "TRACKED" ? depExpected : null);

  let state: FlightState;
  if (landed) state = "LANDED";
  else if (inAir === "REPORTED" || inAir === "TRACKED") state = "EN_ROUTE";
  else if (delay >= LATE_MIN || status === "delayed") state = "DELAYED";
  else state = "SCHEDULED";

  let progress: number | null = null;
  let minutesToGo: number | null = null;
  if (state === "EN_ROUTE") {
    minutesToGo = Math.max(0, minutesBetween(now, lands));
    if (barFrom && lands > barFrom)
      progress = Math.min(0.97, Math.max(0.03, (now.getTime() - barFrom.getTime()) / (lands.getTime() - barFrom.getTime())));
  }
  const overdueMin =
    !landed && (inAir || departureUnknown) && now > lands ? minutesBetween(lands, now) : null;

  return {
    ...EMPTY,
    state,
    tone: landed ? "good" : toneFor(delay),
    scheduledAt: f.lgw.scheduledUtc,
    expectedAt: iso(gate),
    delayMin: delay,
    takeOffAt: iso(takeOff),
    landsAt: iso(lands),
    landed,
    arrivedTimeIsGate,
    gateAt: iso(gate),
    outHandAt: iso(addMin(gate, buffers.hand)),
    outBagsAt: iso(addMin(gate, buffers.checked)),
    progress,
    minutesToGo,
    inAir,
    departureUnknown,
    overdueMin,
  };
}

function describeDeparture(f: BoardFlight, now: Date): FlightView {
  const status = (f.status ?? "").toLowerCase();
  const scheduled = new Date(f.lgw.scheduledUtc);
  const revised = at(f.lgw.revisedUtc);
  const runway = at(f.lgw.runwayUtc);
  const otherScheduled = at(f.other.scheduledUtc);
  const longHaul = !!otherScheduled && minutesBetween(scheduled, otherScheduled) >= LONG_HAUL_MIN;
  const beThereBy = iso(addMin(scheduled, -(longHaul ? BE_THERE_LONG_MIN : BE_THERE_SHORT_MIN)));
  const base = { ...EMPTY, scheduledAt: f.lgw.scheduledUtc, longHaul, beThereBy };

  if (status === "canceled" || status === "cancelled")
    return { ...base, state: "CANCELLED", tone: "bad", expectedAt: null, delayMin: null };
  if (status === "canceleduncertain")
    return { ...base, state: "MAYBE_CANCELLED", tone: "bad", expectedAt: null, delayMin: null };

  const expected = revised ?? scheduled;
  const delay = minutesBetween(scheduled, expected);
  const departed =
    (!!runway && runway <= now) ||
    ["departed", "enroute", "approaching", "arrived", "landed"].includes(status);

  if (status === "diverted")
    return { ...base, state: "DIVERTED", tone: "bad", expectedAt: iso(expected), delayMin: delay, departedAt: iso(runway ?? revised) };

  if (departed)
    return {
      ...base,
      state: "DEPARTED",
      tone: "good",
      expectedAt: iso(expected),
      delayMin: delay,
      departedAt: iso(runway ?? revised ?? scheduled),
    };

  let state: FlightState;
  if (status === "gateclosed") state = "GATE_CLOSED";
  else if (status === "boarding") state = "BOARDING";
  else if (delay >= LATE_MIN || status === "delayed") state = "DELAYED";
  else if (status === "checkin") state = "CHECK_IN";
  else state = "SCHEDULED";

  return {
    ...base,
    state,
    tone: toneFor(delay),
    expectedAt: iso(expected),
    delayMin: delay,
    gateShownAt: f.lgw.gate ? null : iso(addMin(expected, -GATE_SHOWN_BEFORE_MIN)),
    boardingAt: iso(addMin(expected, -BOARDING_BEFORE_MIN)),
  };
}

// ── Board request window ──────────────────────────────────────────────────
/**
 * The board request covers `backMin` before now to 12 hours later, as UK local
 * times "YYYY-MM-DDTHH:mm". The provider caps the window at 12 hours of LOCAL
 * clock time, so the end is built by adding to the local clock (safe across the
 * clock changes) and stops a minute short.
 */
export function boardWindow(now: Date, backMin = 120): { fromLocal: string; toLocal: string } {
  const from = londonParts(addMin(now, -backMin));
  const naiveFrom = new Date(`${from.date}T${from.hm}:00Z`);
  const naiveTo = new Date(naiveFrom.getTime() + (12 * 60 - 1) * MIN);
  const toLocal = naiveTo.toISOString().slice(0, 16);
  return { fromLocal: `${from.date}T${from.hm}`, toLocal };
}
