// backend/src/services/lostPropertyRules.ts
//
// Pure rules for the TfL Condition 9 lost property register (no database): ref numbers,
// statuses and results, the 28-day flag, the 12-month retention, the passenger pushes, and the
// UK date/time handling for the "Date property received" / "Date and time of booking" fields.
import { RETENTION_MONTHS, addMonths, dayKey, dayLabel, parseDay, ukToday } from "./driverRegisterRules";

export const OPEN_FLAG_DAYS = 28; // open longer than this → amber "consider police / disposal"
export const LP_RETENTION_MONTHS = RETENTION_MONTHS; // keep closed records 12 months
export const REF_PREFIX = "LP";

export const STATUSES = ["REPORTED", "FOUND", "RETURNED", "CLOSED"] as const;
export type LpStatus = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<LpStatus, string> = {
  REPORTED: "Reported",
  FOUND: "Found",
  RETURNED: "Returned",
  CLOSED: "Closed",
};

export const OUTCOMES = [
  "COLLECTED_BY_OWNER",
  "POSTED_TO_OWNER",
  "RETURNED_BY_DRIVER",
  "HANDED_TO_POLICE",
  "DISPOSED",
  "DONATED",
] as const;
export type LpOutcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABELS: Record<LpOutcome, string> = {
  COLLECTED_BY_OWNER: "Collected by owner",
  POSTED_TO_OWNER: "Posted / couriered to owner",
  RETURNED_BY_DRIVER: "Returned by driver",
  HANDED_TO_POLICE: "Handed to police",
  DISPOSED: "Disposed of",
  DONATED: "Donated",
};
/** Results that mean the owner got the item back ("Returned" status needs one of these). */
export const RETURN_OUTCOMES = new Set<LpOutcome>(["COLLECTED_BY_OWNER", "POSTED_TO_OWNER", "RETURNED_BY_DRIVER"]);

export class LostPropertyError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

export const isStatus = (s: unknown): s is LpStatus => typeof s === "string" && (STATUSES as readonly string[]).includes(s);
export const isOutcome = (s: unknown): s is LpOutcome => typeof s === "string" && (OUTCOMES as readonly string[]).includes(s);
export const isClosed = (s: string) => s === "RETURNED" || s === "CLOSED";

// ─── Ref numbers ─────────────────────────────────────────────────────────────

/** LP-2026-001 (3 digits minimum; LP-2026-1000 after 999). */
export function formatRef(year: number, n: number): string {
  return `${REF_PREFIX}-${year}-${String(n).padStart(3, "0")}`;
}

/** The running number of a ref in a given year, or null if it isn't one of that year's refs. */
export function refNumber(ref: string, year: number): number | null {
  const m = new RegExp(`^${REF_PREFIX}-${year}-(\\d{3,})$`).exec(ref);
  return m ? parseInt(m[1], 10) : null;
}

/** UK calendar year of a moment (a report at 23:30 UTC on 31 Dec is still that year in winter). */
export function ukYear(d: Date): number {
  return parseInt(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric" }).format(d), 10);
}

// ─── Dates and times (UK) ────────────────────────────────────────────────────

/** Offset of UK time from UTC at a moment, in minutes (0 in winter, 60 in summer). */
function ukOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)!.value, 10);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/**
 * A date/time typed in the admin ("2026-10-18T20:15", UK local time, as a datetime-local input
 * gives it) or a full ISO time with a zone ("…Z") → Date. "YYYY-MM-DD" alone = 12:00 UK that day.
 * Returns null for anything that isn't a real date/time.
 */
export function parseUkDateTime(input: unknown): Date | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(s);
  if (!m) return null;
  const day = parseDay(m[1]);
  if (!day) return null;
  const hh = m[2] === undefined ? 12 : +m[2];
  const mm = m[3] === undefined ? 0 : +m[3];
  if (hh > 23 || mm > 59) return null;
  const guess = day.getTime() + (hh * 60 + mm) * 60_000;
  let utc = guess - ukOffsetMinutes(new Date(guess)) * 60_000;
  utc = guess - ukOffsetMinutes(new Date(utc)) * 60_000; // settle around clock changes
  return new Date(utc);
}

/** Date → "2026-10-18T20:15" in UK time (for datetime-local inputs). */
export function ukInputValue(d: Date | null | undefined): string | null {
  if (!d) return null;
  const local = new Date(d.getTime() + ukOffsetMinutes(d) * 60_000);
  return local.toISOString().slice(0, 16);
}

/** "25 Aug 2026, 11:42" in UK time. */
export function ukDateTimeLabel(d: Date | null | undefined): string | null {
  if (!d) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** "25 Aug 2026" in UK time. */
export function ukDateLabel(d: Date | null | undefined): string | null {
  return d ? dayLabel(ukToday(d)) : null;
}

/** "Date and Time of related booking": the pickup time if booked ahead, else when the trip ran. */
export function bookingDateTime(b: {
  scheduledAt?: Date | null;
  tripStartedAt?: Date | null;
  completedAt?: Date | null;
  createdAt?: Date | null;
}): Date | null {
  return b.scheduledAt ?? b.tripStartedAt ?? b.completedAt ?? b.createdAt ?? null;
}

// ─── Open items, retention ───────────────────────────────────────────────────

type Timed = { status: string; receivedAt?: Date | null; reportedAt: Date; resolvedAt?: Date | null };

/** Whole UK days the item has been open (from received, or reported if never received). */
export function daysOpen(item: Timed, now = new Date()): number {
  const from = ukToday(item.receivedAt ?? item.reportedAt);
  return Math.max(0, Math.round((ukToday(now).getTime() - from.getTime()) / 86_400_000));
}

/** Open for 28 days or more → time to think about the police or disposal. */
export function isOverdue(item: Timed, now = new Date()): boolean {
  return !isClosed(item.status) && daysOpen(item, now) >= OPEN_FLAG_DAYS;
}

/** First UK day a closed record may be permanently deleted (12 months after closing). */
export function deletableFrom(item: { status: string; resolvedAt?: Date | null }): Date | null {
  if (!isClosed(item.status) || !item.resolvedAt) return null;
  return addMonths(ukToday(item.resolvedAt), LP_RETENTION_MONTHS);
}

export function canDelete(item: { status: string; resolvedAt?: Date | null }, now = new Date()): boolean {
  const from = deletableFrom(item);
  return !!from && dayKey(ukToday(now)) >= dayKey(from);
}

// ─── Status changes ──────────────────────────────────────────────────────────

/**
 * Check a status change and return the result to store (null while the item is open).
 * Closing (Returned / Closed) needs a result; "Returned" needs a result where the owner got it back.
 */
export function checkStatusChange(to: unknown, outcome: unknown): LpOutcome | null {
  if (!isStatus(to)) throw new LostPropertyError("Unknown status");
  if (!isClosed(to)) return null;
  if (!isOutcome(outcome)) throw new LostPropertyError("Choose the result before closing this item");
  if (to === "RETURNED" && !RETURN_OUTCOMES.has(outcome))
    throw new LostPropertyError(`"Returned" is for items the owner got back — use "Closed" for ${OUTCOME_LABELS[outcome].toLowerCase()}`);
  return outcome;
}

/** Push to the passenger for a status change, or null. */
export function pushFor(from: string | null, to: string, ref: string): { title: string; body: string } | null {
  if (to === from) return null;
  if (to === "FOUND")
    return {
      title: "We've found your item",
      body: `Lost property ${ref}: your item has been found. We'll contact you to arrange its return.`,
    };
  if (to === "RETURNED")
    return { title: "Item returned", body: `Lost property ${ref} has been marked as returned to you.` };
  return null;
}

// ─── Text fields ─────────────────────────────────────────────────────────────

/** Trim; empty → null; too long → error naming the field. Keeps line breaks (addresses), drops blank lines. */
export function cleanText(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new LostPropertyError(`${field} is not valid`);
  const s = value
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join("\n");
  if (!s) return null;
  if (s.length > max) throw new LostPropertyError(`${field} is too long (${max} characters at most)`);
  return s;
}

/** Vehicle registration → "GL72LXW" (capitals, no spaces), or null. */
export function normaliseReg(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s || null;
}
