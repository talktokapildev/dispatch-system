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

export type BoardFlight = {
  id: string;
  direction: Direction;
  number: string;
  keys: string[];
  airline: { name: string | null; iata: string | null; icao: string | null };
  codeshare: "OPERATOR" | "CODESHARE" | "UNKNOWN";
  operatedBy: string | null;
  status: string | null;
  aircraft: string | null;
  other: {
    iata: string | null;
    name: string | null;
    scheduledUtc: string | null;
    revisedUtc: string | null;
    runwayUtc: string | null;
    scheduledLocal: string | null;
    revisedLocal: string | null;
    runwayLocal: string | null;
  };
  lgw: {
    scheduledUtc: string;
    revisedUtc: string | null;
    predictedUtc: string | null;
    runwayUtc: string | null;
    terminal: "NORTH" | "SOUTH" | null;
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
  departedAt: string | null;
  beThereBy: string | null;
  gateShownAt: string | null;
  boardingAt: string | null;
  longHaul: boolean;
};

export type FlightWithView = { flight: BoardFlight; view: FlightView };

export type BoardRow = {
  id: string;
  number: string;
  airline: string | null;
  other: { iata: string | null; name: string | null };
  terminal: "NORTH" | "SOUTH" | null;
  gate: string | null;
  baggageBelt: string | null;
  view: Pick<
    FlightView,
    "state" | "tone" | "scheduledAt" | "expectedAt" | "delayMin" | "landsAt" | "landed" | "departedAt"
  >;
};

export type BoardData = {
  fetchedAt: string | null;
  stale: boolean;
  arrivals: BoardRow[];
  departures: BoardRow[];
};

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
    case "EN_ROUTE":
      return short ? "In the air" : `In the air${le ? ` · ${le}` : ""}`;
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
  const num = f.number;
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
      case "EN_ROUTE":
        return `${num} is in the air from ${place} and should land at Gatwick${at} at about ${ukTime(v.landsAt)}. With a suitcase, travellers are usually out around ${ukTime(v.outBagsAt)}, so aim to be there by about ${ukTime(v.outHandAt)}.`;
      case "DELAYED":
        return `${num} hasn't left ${place} yet and is running about ${duration(v.delayMin ?? 0)} late. It's now expected to land at about ${ukTime(v.landsAt)}. This can still change until it takes off.`;
      default:
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
