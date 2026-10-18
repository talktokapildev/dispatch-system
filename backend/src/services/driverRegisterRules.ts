// backend/src/services/driverRegisterRules.ts
//
// Pure rules for the TfL driver register (no database). Calendar dates ("days") are stored as
// 00:00 UTC of that day and exchanged as "YYYY-MM-DD".

export const RETENTION_MONTHS = 12; // TfL: keep driver records 12 months after they leave
export const MIN_DRIVER_AGE = 21; // TfL minimum age for a PHV driver's licence
export const LICENCE_CHECK_MONTHS = 6; // "check driver licence details at regular intervals"
export const TFL_DISMISSAL_NOTICE_DAYS = 14; // notify TfL of a dismissal for conduct

export class RegisterError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

// ─── Days ────────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" → Date at 00:00 UTC, or null if not a real date. */
export function parseDay(input: unknown): Date | null {
  if (typeof input !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null;
}

/** Date (stored day) → "YYYY-MM-DD". */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Today's UK calendar day as a stored day (00:00 UTC). */
export function ukToday(now = new Date()): Date {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parseDay(key)!;
}

/** "18 Oct 2026" for a stored day. */
export function dayLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(d);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** Same day n months later (end of month when the day doesn't exist, e.g. 31 Jan + 1 → 28/29 Feb). */
export function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}

/** Whole years between a date of birth and a day. */
export function ageOn(dob: Date, day: Date): number {
  let age = day.getUTCFullYear() - dob.getUTCFullYear();
  const before =
    day.getUTCMonth() < dob.getUTCMonth() ||
    (day.getUTCMonth() === dob.getUTCMonth() && day.getUTCDate() < dob.getUTCDate());
  if (before) age--;
  return age;
}

// ─── Fields ──────────────────────────────────────────────────────────────────

/** UK postcode → "RH10 4SS" style, or null if it isn't one. */
export function normalisePostcode(input: string): string | null {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(s)) return null;
  return `${s.slice(0, -3)} ${s.slice(-3)}`;
}

/** National Insurance number → "AB123456C" (capitals, no spaces), or null if not valid. */
export function normaliseNi(input: string): string | null {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // HMRC format: two prefix letters (D, F, I, Q, U, V never; O never second; some pairs not
  // allocated), six digits, suffix A–D.
  if (!/^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/.test(s)) return null;
  if (["BG", "GB", "KN", "NK", "NT", "TN", "ZZ"].includes(s.slice(0, 2))) return null;
  return s;
}

/** "AB 12 34 56 C" */
export function formatNi(ni: string): string {
  return `${ni.slice(0, 2)} ${ni.slice(2, 4)} ${ni.slice(4, 6)} ${ni.slice(6, 8)} ${ni.slice(8)}`;
}

/** "AB ** ** ** C" — for anywhere the full number isn't needed. */
export function maskNi(ni: string | null | undefined): string | null {
  if (!ni) return null;
  return `${ni.slice(0, 2)} ** ** ** ${ni.slice(-1)}`;
}

/** Call sign: capitals, letters/digits/hyphen, up to 10 characters; "" → null. */
export function normaliseCallSign(input: string): string | null | false {
  const s = input.trim().toUpperCase();
  if (!s) return null;
  return /^[A-Z0-9-]{1,10}$/.test(s) ? s : false;
}

/** Trim; collapse blank lines; "" → null. Max 300 chars. */
export function normaliseAddress(input: string): string | null | false {
  const lines = input
    .split(/\r?\n|,(?=\s)/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const s = lines.join("\n");
  return s.length <= 300 ? s : false;
}

// ─── Register input ──────────────────────────────────────────────────────────

export type RegisterInput = {
  middleNames?: string | null;
  callSign?: string | null;
  address?: string | null;
  postcode?: string | null;
  dateOfBirth?: string | null;
  niNumber?: string | null;
  licenceCheckedAt?: string | null;
};

export type RegisterData = {
  middleNames?: string | null;
  callSign?: string | null;
  address?: string | null;
  postcode?: string | null;
  dateOfBirth?: Date | null;
  niNumber?: string | null;
  licenceCheckedAt?: Date | null;
};

/**
 * Validate and normalise the fields that were sent (undefined = leave as is, "" or null = clear).
 * Throws RegisterError with a message for the admin form.
 */
export function parseRegisterInput(input: RegisterInput, now = new Date()): RegisterData {
  const out: RegisterData = {};
  const today = ukToday(now);
  const blank = (v: unknown) => v === null || (typeof v === "string" && !v.trim());

  if (input.middleNames !== undefined)
    out.middleNames = blank(input.middleNames) ? null : String(input.middleNames).trim().slice(0, 100);

  if (input.callSign !== undefined) {
    const c = blank(input.callSign) ? null : normaliseCallSign(String(input.callSign));
    if (c === false) throw new RegisterError("Call sign: up to 10 letters, numbers or hyphens");
    out.callSign = c;
  }
  if (input.address !== undefined) {
    const a = blank(input.address) ? null : normaliseAddress(String(input.address));
    if (a === false) throw new RegisterError("Address is too long");
    out.address = a;
  }
  if (input.postcode !== undefined) {
    if (blank(input.postcode)) out.postcode = null;
    else {
      const p = normalisePostcode(String(input.postcode));
      if (!p) throw new RegisterError("Enter a valid UK postcode, e.g. RH10 4SS");
      out.postcode = p;
    }
  }
  if (input.dateOfBirth !== undefined) {
    if (blank(input.dateOfBirth)) out.dateOfBirth = null;
    else {
      const d = parseDay(input.dateOfBirth);
      if (!d) throw new RegisterError("Date of birth: use a valid date");
      if (d >= today || ageOn(d, today) > 100) throw new RegisterError("Date of birth looks wrong");
      out.dateOfBirth = d;
    }
  }
  if (input.niNumber !== undefined) {
    if (blank(input.niNumber)) out.niNumber = null;
    else {
      const n = normaliseNi(String(input.niNumber));
      if (!n) throw new RegisterError("Enter a valid National Insurance number, e.g. AB 12 34 56 C");
      out.niNumber = n;
    }
  }
  if (input.licenceCheckedAt !== undefined) {
    if (blank(input.licenceCheckedAt)) out.licenceCheckedAt = null;
    else {
      const d = parseDay(input.licenceCheckedAt);
      if (!d) throw new RegisterError("Licence check date: use a valid date");
      if (d > today) throw new RegisterError("Licence check date can't be in the future");
      out.licenceCheckedAt = d;
    }
  }
  return out;
}

// ─── Engagements ─────────────────────────────────────────────────────────────

export type EngagementRow = {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  endReason?: string | null;
  dismissedForConduct?: boolean;
  notes?: string | null;
};

export function sortEngagements<T extends EngagementRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || a.id.localeCompare(b.id));
}

/**
 * The register as on TfL's form: the first period gives "Date first available" and "Date of
 * leaving"; every later period is a "Restart date" / "Finish date" pair.
 */
export function registerDates(rows: EngagementRow[]) {
  const sorted = sortEngagements(rows);
  const first = sorted[0] ?? null;
  const current = sorted.find((r) => !r.endedAt) ?? null;
  const last = sorted[sorted.length - 1] ?? null;
  return {
    firstAvailable: first?.startedAt ?? null,
    dateOfLeaving: first?.endedAt ?? null,
    restarts: sorted.slice(1).map((r) => ({ restart: r.startedAt, finish: r.endedAt })),
    active: !!current,
    /** The day they most recently left (null while working). */
    leftOn: current ? null : last?.endedAt ?? null,
  };
}

/** First day the driver's record may be permanently deleted (null = not yet known / active). */
export function deletableFrom(rows: EngagementRow[]): Date | null {
  const { active, leftOn } = registerDates(rows);
  if (active || !leftOn) return null;
  return addMonths(leftOn, RETENTION_MONTHS);
}

/**
 * Check a set of periods after a change: each starts on or before it ends, none overlap, at most
 * one is open and it is the latest, nothing ends in the future.
 */
export function validateEngagements(rows: EngagementRow[], now = new Date()): void {
  const today = ukToday(now);
  const sorted = sortEngagements(rows);
  sorted.forEach((r, i) => {
    if (r.endedAt && r.endedAt < r.startedAt)
      throw new RegisterError(`The finish date (${dayLabel(r.endedAt)}) is before the start (${dayLabel(r.startedAt)})`);
    if (r.endedAt && r.endedAt > today) throw new RegisterError("A finish date can't be in the future");
    if (r.startedAt > today) throw new RegisterError("A start date can't be in the future");
    const next = sorted[i + 1];
    if (next) {
      if (!r.endedAt) throw new RegisterError("Only the latest period can be open (no finish date)");
      if (next.startedAt < r.endedAt)
        throw new RegisterError(
          `Periods overlap: one finishes ${dayLabel(r.endedAt)}, the next starts ${dayLabel(next.startedAt)}`
        );
    }
  });
}

/** DVLA check overdue? (null date = never checked = due) */
export function licenceCheckDue(checkedAt: Date | null | undefined, now = new Date()): boolean {
  if (!checkedAt) return true;
  return addMonths(checkedAt, LICENCE_CHECK_MONTHS) < ukToday(now);
}
