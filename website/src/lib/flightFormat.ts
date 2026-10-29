// Flight status page: the data shapes the backend sends, and every piece of wording.
// Pure functions only (no fetch), so both server and client components can import it.
// All times on the page are UK time unless marked "local".

export type Direction = "ARRIVAL" | "DEPARTURE";
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
 * Arrivals: how sure we are the plane is flying (backend flightBoardRules.ts).
 * REPORTED = take-off reported; TRACKED = no take-off reported but tracked (shown in the air);
 * UNCONFIRMED = should have left, no take-off and no tracking (maybe still on the ground).
 */
export type InAir = "REPORTED" | "TRACKED" | "UNCONFIRMED" | null;

export type BoardFlight = {
  id: string;
  direction: Direction;
  number: string;
  displayNumber?: string; // as on the ticket, e.g. "EZY8687" (older cached data may lack it)
  keys: string[];
  airline: { name: string | null; iata: string | null; icao: string | null };
  codeshare: "OPERATOR" | "CODESHARE" | "UNKNOWN";
  operatedBy: string | null;
  status: string | null;
  aircraft: string | null;
  airlineSlug?: string | null; // its /gatwick/terminals/<slug> page (older backends: absent)
  other: {
    iata: string | null;
    name: string | null;
    scheduledUtc: string | null;
    revisedUtc: string | null;
    runwayUtc: string | null;
    scheduledLocal: string | null;
    revisedLocal: string | null;
    runwayLocal: string | null;
    countryCode?: string | null;
    timeZone?: string | null;
  };
  lgw: {
    scheduledUtc: string;
    revisedUtc: string | null;
    predictedUtc: string | null;
    runwayUtc: string | null;
    terminal: "NORTH" | "SOUTH" | null;
    terminalInferred?: boolean; // filled from the airline's other flights today
    gate: string | null;
    baggageBelt: string | null;
    checkInDesk: string | null;
    live: boolean;
  };
};

export type FlightView = {
  state: FlightState;
  tone: Tone;
  scheduledAt: string;
  expectedAt: string | null;
  delayMin: number | null;
  takeOffAt: string | null;
  landsAt: string | null;
  landed: boolean;
  arrivedTimeIsGate: boolean;
  gateAt: string | null;
  outHandAt: string | null;
  outBagsAt: string | null;
  progress: number | null;
  minutesToGo: number | null;
  inAir?: InAir; // older backends: absent
  overdueMin?: number | null; // minutes past the expected touchdown, not yet landed
  departedAt: string | null;
  beThereBy: string | null;
  gateShownAt: string | null;
  boardingAt: string | null;
  longHaul: boolean;
};

/** Forecasts for the moments that matter (backend picks the nearest 3-hour slot). */
export type FlightForecast = {
  lgwAt: string | null; // departures: "be at the airport by"; arrivals: at the gate
  lgw: Weather | null;
  otherAt: string | null; // departures: when it lands at the destination
  other: Weather | null;
} | null;

/** A flight from the destination that landed at Gatwick this week ("Coming back?"). */
export type ReturnFlight = {
  displayNumber: string;
  airline: { name: string | null; iata: string | null; slug: string | null };
  usualTimeUk: string;
  terminal: "NORTH" | "SOUTH" | null;
  lastDate: string;
  seenAt: string;
};

export type FlightWithView = {
  flight: BoardFlight;
  view: FlightView;
  forecast?: FlightForecast; // older backends: absent
  returns?: ReturnFlight[];
  punctuality?: RoutePunctuality | null; // CAA figures for the route (null: none)
  rights?: PassengerRights | null; // UK delay/cancellation rights (null: nothing to say)
  travelAdvice?: TravelAdvice | null; // departures: FCDO advice for the destination (cached only)
};

// ── UK passenger rights (CAA's explanation of UK261) ─────────────────────────
export type PassengerRights = {
  covered: "YES" | "UK_EU_AIRLINE";
  distanceKm: number | null;
  band: "SHORT" | "MEDIUM" | "LONG" | null;
  cancelled: boolean;
  arrivalDelayMin: number | null;
  arrivalDelayFinal: boolean;
  compensationGbp: number | null;
  compensationIfLateGbp: number | null;
  careFromMin: number | null;
  careDue: boolean;
  refundOption: boolean;
};
export const CAA_DELAYS_HREF = "https://www.caa.co.uk/air-passengers/travel-problems-and-rights/flight-delays-and-cancellations/delays/";
export const CAA_CANCELLATIONS_HREF =
  "https://www.caa.co.uk/air-passengers/travel-problems-and-rights/flight-delays-and-cancellations/cancellations/";

// ── FCDO travel advice (GOV.UK, Open Government Licence v3.0) ────────────────
export type TravelAdvice = {
  slug: string;
  name: string;
  level: "NONE" | "PARTS_ESSENTIAL" | "PARTS_ALL" | "WHOLE_ESSENTIAL" | "WHOLE_ALL";
  updatedAt: string | null;
  changeDescription: string | null;
  url: string;
  entryUrl: string | null;
};
export const OGL_CREDIT = "Contains public sector information licensed under the Open Government Licence v3.0.";
export const OGL_HREF = "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/";

// ── CAA punctuality (UK Civil Aviation Authority monthly statistics) ─────────
export type PunctualityStats = {
  flights: number; // timed flights behind the figures
  onTimePct: number; // early to 15 min late, whole %
  avgDelayMin: number;
  overHourPct: number; // more than 60 min late, 1 decimal
  cancelledPct: number; // 1 decimal
};
export type RoutePunctuality = {
  from: string; // "2025-09"
  to: string; // "2026-08"
  name: string;
  year: PunctualityStats;
  sameMonth: (PunctualityStats & { period: string }) | null; // that month, about a year ago
};
export type PunctualityRoute = { iata: string; name: string; onTimePct: number; avgDelayMin: number; flights: number };
export type AirlinePunctuality = {
  from: string;
  to: string;
  slug: string;
  arrivals: PunctualityStats | null;
  departures: PunctualityStats | null;
  best: PunctualityRoute[];
  worst: PunctualityRoute[];
};
export type AirlineScores = {
  from: string;
  to: string;
  minFlights: number;
  airlines: Record<string, { arrivals: PunctualityStats | null; departures: PunctualityStats | null }>;
};
export type GatwickMonth = { period: string; arrivals: PunctualityStats | null; departures: PunctualityStats | null };
export type UkAirport = { name: string; gatwick: boolean; arrivals: PunctualityStats | null; departures: PunctualityStats | null };
export type DelaysData =
  | {
      status: "FOUND";
      from: string;
      to: string;
      gatwick: { arrivals: PunctualityStats | null; departures: PunctualityStats | null; months: GatwickMonth[] };
      airports: UkAirport[];
    }
  | { status: "NONE" | "ERROR" };
export const CAA_CREDIT = "Source: UK Civil Aviation Authority punctuality statistics";
export const CAA_HREF = "https://www.caa.co.uk/data-and-analysis/uk-aviation-market/flight-punctuality/uk-flight-punctuality-statistics/";

/** What we remember about a flight seen on the board in the last 7 days (no live times). */
export type SeenFlight = {
  number: string;
  displayNumber: string;
  direction: Direction;
  airline: { name: string | null; iata: string | null };
  other: { iata: string | null; name: string | null; countryCode: string | null; timeZone: string | null };
  terminal: "NORTH" | "SOUTH" | null;
  terminalInferred: boolean;
  usualTimeUk: string; // "21:10"
  aircraft: string | null;
  lastDate: string; // "2026-10-23"
  seenAt: string;
  airlineSlug?: string | null;
  punctuality?: RoutePunctuality | null;
  travelAdvice?: TravelAdvice | null;
};

export type BoardRow = {
  id: string;
  number: string;
  displayNumber?: string;
  airline: string | null;
  airlineIata?: string | null;
  other: { iata: string | null; name: string | null; countryCode?: string | null };
  terminal: "NORTH" | "SOUTH" | null;
  terminalInferred?: boolean;
  gate: string | null;
  baggageBelt: string | null;
  view: Pick<
    FlightView,
    "state" | "tone" | "scheduledAt" | "expectedAt" | "delayMin" | "landsAt" | "landed" | "departedAt" | "inAir"
  >;
};

export type BoardData = {
  fetchedAt: string | null;
  stale: boolean;
  arrivals: BoardRow[];
  departures: BoardRow[];
  weather?: WeatherMap; // by airport code; "LGW" = Gatwick
};

// ── Which terminal (/gatwick/terminals) ─────────────────────────────────────
export type TerminalAnswer = "NORTH" | "SOUTH" | "BOTH";

/** One airline at Gatwick over the last 7 days (backend airlineTerminalRules.ts). */
export type AirlineTerminal = {
  slug: string;
  name: string;
  codes: string[];
  flights: number;
  arrivals: number;
  departures: number;
  north: number; // flights with a stated North terminal
  south: number;
  terminal: TerminalAnswer | null;
  mainShare: number | null;
  moved: { from: "NORTH" | "SOUTH"; to: "NORTH" | "SOUTH"; since: string } | null;
  firstDate: string;
  lastDate: string;
  hasPage: boolean; // enough flights for its own (indexed) page
};

export type TerminalSummary = {
  updatedAt: string | null;
  airlines: AirlineTerminal[];
  // CAA on-time figures by airline slug; ranked from `minFlights` (older backends: absent)
  punctuality?: AirlineScores | null;
};

export type AirlineTerminalPage =
  | {
      status: "FOUND";
      updatedAt: string;
      airline: AirlineTerminal;
      board: BoardData; // only this airline's flights; empty when the board is old
      sameTerminal: { slug: string; name: string }[];
      punctuality?: AirlinePunctuality | null; // CAA figures (older backends: absent)
    }
  | { status: "NOT_FOUND" | "ERROR" };

// Our own meeting points (same as the home page "Gatwick specialists" section).
export const MEETING_POINT = { NORTH: "Car Park 6, Level 4", SOUTH: "Orange Car Park, Level 3" } as const;

export const terminalShort = (t: TerminalAnswer | null) =>
  t === "NORTH" ? "North" : t === "SOUTH" ? "South" : t === "BOTH" ? "Both" : "Not known yet";

/** Days the figures cover, 1–7 ("in the last 3 days" while the record is still filling up). */
export function daysCovered(firstDate: string, now: Date = new Date()): number {
  const first = Date.parse(`${firstDate}T12:00:00Z`);
  const today = Date.parse(`${ukDate(now)}T12:00:00Z`);
  return Math.min(7, Math.max(1, Math.round((today - first) / 86_400_000) + 1));
}

export const lastDays = (n: number) => (n === 1 ? "today" : `in the last ${n} days`);

/** "easyJet's" / "British Airways'" */
export const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/** "easyJet uses the North Terminal." */
export function terminalAnswer(a: AirlineTerminal): string {
  switch (a.terminal) {
    case "NORTH":
    case "SOUTH":
      return `${a.name} uses the ${terminalName(a.terminal)}.`;
    case "BOTH":
      return `${a.name} uses both terminals.`;
    default:
      return `We haven't seen a terminal for ${a.name} yet.`;
  }
}

/** The evidence under the answer, e.g. "From 312 flights in the last 7 days: 309 North, 3 South." */
export function terminalEvidence(a: AirlineTerminal, now: Date = new Date()): string {
  const days = lastDays(daysCovered(a.firstDate, now));
  const flights = `${a.flights} ${a.name} ${a.flights === 1 ? "flight" : "flights"} at Gatwick ${days}`;
  const stated = a.north + a.south;
  if (!stated) return `From ${flights}. Gatwick hadn't published the terminal for any of them yet, so check your booking.`;
  const parts = [a.north ? `${a.north} North` : null, a.south ? `${a.south} South` : null].filter(Boolean).join(", ");
  const unknown = a.flights - stated;
  const counts = `${parts}${unknown ? ` (${unknown} not shown yet)` : ""}`;
  if (a.moved)
    return `Since ${dayLabel(a.moved.since)}, ${possessive(a.name)} flights have used the ${terminalName(a.moved.to)}. All ${a.flights} ${a.flights === 1 ? "flight" : "flights"} ${days}: ${counts}.`;
  return `From ${flights}: ${counts}.`;
}

/** The exception line, when there is one. */
export function terminalCaveat(a: AirlineTerminal): string | null {
  if (a.terminal === "BOTH") return "Which one depends on the flight: find yours below, or check your booking.";
  if (a.terminal !== "NORTH" && a.terminal !== "SOUTH") return null;
  const other = a.terminal === "NORTH" ? a.south : a.north;
  if (!other || a.moved) return null;
  return `A few flights use the ${a.terminal === "NORTH" ? "South" : "North"} Terminal, so check your booking before you set off.`;
}

// ── Time difference ─────────────────────────────────────────────────────────
/** Minutes a time zone is ahead of UTC at an instant (negative = behind). */
function zoneOffsetMin(timeZone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const p = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0);
    const asUtc = Date.UTC(p("year"), p("month") - 1, p("day"), p("hour"), p("minute"));
    return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
  } catch {
    return null;
  }
}

/** "Pisa is 1 hour ahead" / "New York is 5 hours behind"; null when it's UK time there too. */
export function timeDifference(place: string, timeZone: string | null | undefined, atIso: string): string | null {
  if (!timeZone) return null;
  const at = new Date(atIso);
  const there = zoneOffsetMin(timeZone, at);
  const uk = zoneOffsetMin("Europe/London", at);
  if (there == null || uk == null) return null;
  const diff = there - uk;
  if (diff === 0) return null;
  const h = Math.abs(diff) / 60;
  const amount = Number.isInteger(h) ? `${h} ${h === 1 ? "hour" : "hours"}` : `${Math.floor(h)} h ${Math.abs(diff) % 60} min`;
  return `${place} is ${amount} ${diff > 0 ? "ahead" : "behind"}`;
}

/** "12:30" in an airport's own clock. */
export function localTime(timeZone: string | null | undefined, iso: string | null): string | null {
  if (!timeZone || !iso) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  } catch {
    return null;
  }
}

// ── When to leave home ─────────────────────────────────────────────────────
export const LEAVE_SPARE_MIN = 10;

/** Leave-by instant: at the terminal by `beThereBy`, after `driveMin` and some spare time,
 *  rounded down to 5 minutes ("06:40", not "06:44"). */
export function leaveByIso(beThereBy: string, driveMin: number): string {
  const t = Date.parse(beThereBy) - (driveMin + LEAVE_SPARE_MIN) * 60_000;
  const step = 5 * 60_000;
  return new Date(Math.floor(t / step) * step).toISOString();
}

// ── Weather (OpenWeather, cached by the backend) ───────────────────────────
export type WeatherKind = "clear" | "partly" | "cloudy" | "rain" | "drizzle" | "snow" | "thunder" | "fog";
export type Weather = { tempC: number; kind: WeatherKind; night: boolean; text: string; windMph: number; at: string };
export type WeatherMap = Record<string, Weather>;
export const WEATHER_CREDIT = "Weather data © OpenWeather";

/** "U2 8687" → "EZY8687" when the backend sent it; otherwise the number without spaces. */
export const shownNumber = (x: { number: string; displayNumber?: string }) => x.displayNumber ?? x.number.replace(/\s/g, "");

/** Local time at an airport now, e.g. "22:31", from its IANA time zone. */
export function localNow(timeZone: string | null | undefined, now: Date = new Date()): string | null {
  if (!timeZone) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  } catch {
    return null;
  }
}

// ── Flight numbers ──────────────────────────────────────────────────────────
/**
 * "ezy 8687" / "EZY-8687" → "EZY8687" for URLs; null if it can't be a flight number.
 * Same shape the backend accepts: 2–3 character airline code (at least one letter), 1–4 digits,
 * optional letter.
 */
export function cleanFlightNumber(input: string): string | null {
  const s = (input ?? "").toUpperCase().replace(/[\s-]/g, "");
  return /^(?=[A-Z0-9]{0,2}[A-Z])[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(s) ? s : null;
}

/** "U2 8687" → "U28687" (for links). */
export const urlNumber = (n: string) => n.replace(/\s/g, "").toUpperCase();

// ── Dates and times (UK) ────────────────────────────────────────────────────
const TZ = "Europe/London";

function ukParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
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

/** "21:19" (UK) or "--:--". */
export function ukTime(iso: string | null | undefined): string {
  return iso ? ukParts(new Date(iso)).hm : "--:--";
}

/** UK calendar date "YYYY-MM-DD". */
export function ukDate(d: Date | string): string {
  return ukParts(typeof d === "string" ? new Date(d) : d).date;
}

/** "Fri 23 Oct" for a "YYYY-MM-DD" UK date. */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d, 12)))
    .replace(",", "");
}

/** UK date `days` from today's UK date. */
export function ukDateOffset(days: number, now: Date = new Date()): string {
  const [y, m, d] = ukDate(now).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

/** "today" / "tomorrow" / "yesterday" / "on Sat 24 Oct" relative to now (UK). */
export function relativeDay(iso: string, now: Date = new Date()): string {
  const day = ukDate(iso);
  if (day === ukDateOffset(0, now)) return "today";
  if (day === ukDateOffset(1, now)) return "tomorrow";
  if (day === ukDateOffset(-1, now)) return "yesterday";
  return `on ${dayLabel(day)}`;
}

/** "45 min" / "1 h 05 min" */
export function duration(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/** "just now" / "4 min ago" / "1 h 10 min ago" */
export function ago(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "not yet";
  const min = Math.round((now.getTime() - Date.parse(iso)) / 60_000);
  return min < 1 ? "just now" : `${duration(min)} ago`;
}

export function minutesBetween(a: string | null, b: string | null): number | null {
  return a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 60_000) : null;
}

// ── Wording ─────────────────────────────────────────────────────────────────
export const terminalName = (t: "NORTH" | "SOUTH" | null) =>
  t === "NORTH" ? "North Terminal" : t === "SOUTH" ? "South Terminal" : null;

export const placeName = (o: { name: string | null; iata: string | null }) => o.name ?? o.iata ?? "Unknown";

function lateEarly(delay: number | null): string | null {
  if (delay == null) return null;
  if (delay >= 5) return `${duration(delay)} late`;
  if (delay <= -5) return `${duration(-delay)} early`;
  return "on time";
}

// Past the expected touchdown with no landing reported: "landing now" for this long, then
// "probably landed, not confirmed".
export const LANDING_NOW_MIN = 20;

/** Short status for pills and board chips, e.g. "In the air · 9 min late". */
export function statusLabel(dir: Direction, v: FlightView | BoardRow["view"], short = false, now?: Date): string {
  // Days ahead there's only a timetable: "On time" would claim more than we know.
  if (v.state === "SCHEDULED" && now && Date.parse(v.scheduledAt) - now.getTime() > 6 * 3_600_000) return "Scheduled";
  const le = lateEarly(v.delayMin);
  switch (v.state) {
    case "CANCELLED":
      return "Cancelled";
    case "MAYBE_CANCELLED":
      return "May be cancelled";
    case "DIVERTED":
      return "Diverted";
    case "LANDED":
      return short ? `Landed ${ukTime(v.landsAt)}` : "Landed";
    case "DEPARTED":
      return short ? `Departed ${ukTime(v.departedAt)}` : "Departed";
    // Board chips sit next to the (gate) time column, so they say what's happening, not another time.
    case "EN_ROUTE": {
      // Take-off never reported: on the board a late one still says "Delayed" (as agreed).
      if (short) return v.inAir === "TRACKED" && v.tone === "late" ? "Delayed" : "In the air";
      const overdue = "overdueMin" in v ? v.overdueMin : null;
      if (overdue != null) return overdue >= LANDING_NOW_MIN ? "Landing not confirmed" : "Landing now";
      return `In the air${le ? ` · ${le}` : ""}`;
    }
    case "DELAYED":
      return short ? "Delayed" : `Delayed${v.delayMin && v.delayMin > 0 ? ` ${duration(v.delayMin)}` : ""}`;
    case "BOARDING":
      return "Boarding";
    case "GATE_CLOSED":
      return "Gate closed";
    case "CHECK_IN":
      return "Check-in open";
    default:
      if (v.tone === "early") return short ? "Early" : `Expected · ${le}`;
      if (v.tone === "late") return short ? "Delayed" : `Expected · ${le}`;
      return "On time";
  }
}

/** Colours per tone (WCAG AA text contrast on each background). */
export const TONE: Record<Tone, { pill: string; dot: string; soft: string; text: string }> = {
  info: { pill: "bg-[#e8effd] text-[#1e40af] border-[#9db7f0]", dot: "bg-[#2563eb]", soft: "bg-[#e8effd] border-[#c3d4f7]", text: "text-[#1e40af]" },
  late: { pill: "bg-[#fdf0d8] text-[#92400e] border-[#f0a73a]", dot: "bg-[#e06800]", soft: "bg-[#fffaf0] border-[#f8dca6]", text: "text-[#92400e]" },
  early: { pill: "bg-[#e7f2e3] text-[#2b742f] border-[#9ccf91]", dot: "bg-[#2f7d32]", soft: "bg-[#e7f2e3] border-[#c5e1bd]", text: "text-[#2b742f]" },
  good: { pill: "bg-[#2f7d32] text-white border-[#2f7d32]", dot: "bg-white", soft: "bg-[#e7f2e3] border-[#c5e1bd]", text: "text-[#2b742f]" },
  bad: { pill: "bg-[#b91c1c] text-white border-[#b91c1c]", dot: "bg-white", soft: "bg-[#fdecec] border-[#f3b4b4]", text: "text-[#b91c1c]" },
};

/** One or two plain-English sentences for the "In plain English" box. */
export function plainEnglish(f: BoardFlight, v: FlightView, now: Date = new Date()): string {
  const num = shownNumber(f);
  const place = placeName(f.other);
  const term = terminalName(f.lgw.terminal);
  const at = term ? ` ${term}` : "";
  const when = relativeDay(v.scheduledAt, now);
  if (f.direction === "ARRIVAL") {
    switch (v.state) {
      case "CANCELLED":
        return `${num} from ${place} has been cancelled by the airline. Don't set off: ask the traveller which flight they've been moved to, then check that one.`;
      case "MAYBE_CANCELLED":
        return `${num} may have been cancelled, but the airline hasn't confirmed it. Check with the traveller or the airline before you set off.`;
      case "DIVERTED":
        return `${num} has been diverted to another airport. Wait to hear from the traveller before you set off.`;
      case "LANDED":
        return `${num} landed at Gatwick${at} at ${ukTime(v.landsAt)}${v.arrivedTimeIsGate ? " (time at the gate)" : ""}. Travellers with hand luggage are usually out by about ${ukTime(v.outHandAt)}, and with a suitcase by about ${ukTime(v.outBagsAt)}.`;
      case "EN_ROUTE": {
        const out = `With a suitcase, travellers are usually out around ${ukTime(v.outBagsAt)}, so aim to be there by about ${ukTime(v.outHandAt)}.`;
        const overdue = v.overdueMin ?? null;
        if (overdue != null && overdue >= LANDING_NOW_MIN)
          return `${num} from ${place} was expected to land at Gatwick${at} at about ${ukTime(v.landsAt)}. The landing hasn't been confirmed yet, but it has most likely landed. ${out}`;
        if (overdue != null)
          return `${num} from ${place} should be landing at Gatwick${at} about now (expected ${ukTime(v.landsAt)}). ${out}`;
        const note = v.inAir === "TRACKED" ? " Its take-off time wasn't reported, but the flight is being tracked." : "";
        return `${num} is in the air from ${place} and should land at Gatwick${at} at about ${ukTime(v.landsAt)}.${note} ${out}`;
      }
      case "DELAYED":
        if (v.inAir === "UNCONFIRMED") return unconfirmed(num, place, f, v);
        return `${num} hasn't left ${place} yet and is running about ${duration(v.delayMin ?? 0)} late. It's now expected to land at about ${ukTime(v.landsAt)}. This can still change until it takes off.`;
      default:
        if (v.inAir === "UNCONFIRMED") return unconfirmed(num, place, f, v);
        return `${num} from ${place} is due to land at Gatwick${at} ${when} at ${ukTime(v.landsAt)}. It hasn't taken off yet, so check again nearer the time: delays often show up only around take-off.`;
    }
  }
  switch (v.state) {
    case "CANCELLED":
      return `${num} to ${place} has been cancelled. Contact the airline before you travel to the airport.`;
    case "MAYBE_CANCELLED":
      return `${num} may have been cancelled, but the airline hasn't confirmed it. Check with the airline before you travel.`;
    case "DIVERTED":
      return `${num} was diverted after take-off. Check with the airline for the latest.`;
    case "DEPARTED":
      return `${num} left Gatwick at ${ukTime(v.departedAt)} for ${place}.`;
    case "BOARDING":
      return `${num} to ${place} is boarding now${f.lgw.gate ? ` at gate ${f.lgw.gate}` : ""}. It's due to leave at ${ukTime(v.expectedAt)}.`;
    case "GATE_CLOSED":
      return `The gate for ${num} has closed. It's due to leave at ${ukTime(v.expectedAt)}.`;
    case "DELAYED":
      return `${num} to ${place} is running about ${duration(v.delayMin ?? 0)} late and is now expected to leave at ${ukTime(v.expectedAt)}. Still check in on time: bag drop deadlines don't usually move with a delay.`;
    default:
      return `${num} to ${place} is due to leave Gatwick${at} ${when} at ${ukTime(v.expectedAt)}. Aim to arrive by about ${ukTime(v.beThereBy)}, and check your airline's bag drop closing time if you have a suitcase. The gate usually shows on the screens about 40 minutes before departure.`;
  }
}

/** Due to have left, but no take-off reported and no tracking: flying, or still on the ground. */
function unconfirmed(num: string, place: string, f: BoardFlight, v: FlightView): string {
  const dep = f.other.revisedUtc ?? f.other.scheduledUtc;
  return `${num} was due to leave ${place}${dep ? ` at ${ukTime(dep)}` : ""}, but its take-off hasn't been reported and we can't see it being tracked. It may be in the air or still on the ground, so the landing time (about ${ukTime(v.landsAt)} for now) could change. Check again shortly, or ask the traveller.`;
}
