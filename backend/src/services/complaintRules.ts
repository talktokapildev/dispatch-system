// backend/src/services/complaintRules.ts
//
// Pure rules for the TfL Condition 7 complaints / compliments register (no database): refs,
// statuses and outcomes, the 48-hour reply flag, the 12-month retention, the passenger push,
// the ops alert for safety concerns, and the old "[COMPLAINT]" / "[ACK]" text that installed
// passenger apps still read. Date/time and text helpers are shared with the lost property rules.
import { LP_RETENTION_MONTHS } from "./lostPropertyRules";
import { addMonths, dayKey, ukToday } from "./driverRegisterRules";

export const REF_PREFIX = "CC";
export const REPLY_DUE_HOURS = 48; // the app promises a reply within 48 hours
export const RETENTION_MONTHS = LP_RETENTION_MONTHS; // 12 months after resolving
export const SAFETY_CATEGORY = "Safety concern";

/** Categories the passenger app offers (staff can type others). */
export const CATEGORIES = [
  "Driver behaviour",
  "Vehicle condition",
  "Late arrival",
  "Wrong route taken",
  "Overcharged",
  "Safety concern",
  "Other",
];

export const TYPES = ["COMPLAINT", "COMPLIMENT"] as const;
export type CType = (typeof TYPES)[number];
export const TYPE_LABELS: Record<CType, string> = { COMPLAINT: "Complaint", COMPLIMENT: "Compliment" };

export const STATUSES = ["RECEIVED", "INVESTIGATING", "RESOLVED", "CLOSED"] as const;
export type CStatus = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<CStatus, string> = {
  RECEIVED: "Received",
  INVESTIGATING: "Investigating",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};
/** Statuses each type can be in. */
export const STATUSES_FOR: Record<CType, CStatus[]> = {
  COMPLAINT: ["RECEIVED", "INVESTIGATING", "RESOLVED"],
  COMPLIMENT: ["RECEIVED", "CLOSED"],
};

export const OUTCOMES = ["UPHELD", "PARTLY_UPHELD", "NOT_UPHELD", "WITHDRAWN"] as const;
export type COutcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABELS: Record<COutcome, string> = {
  UPHELD: "Upheld",
  PARTLY_UPHELD: "Partly upheld",
  NOT_UPHELD: "Not upheld",
  WITHDRAWN: "Withdrawn",
};

export const CHANNELS = ["APP", "PHONE", "EMAIL", "IN_PERSON"] as const;
export type CChannel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<CChannel, string> = {
  APP: "App",
  PHONE: "Phone",
  EMAIL: "Email",
  IN_PERSON: "In person",
};

export class ComplaintError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

const isIn = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
export const isType = (v: unknown): v is CType => isIn(TYPES, v);
export const isStatus = (v: unknown): v is CStatus => isIn(STATUSES, v);
export const isOutcome = (v: unknown): v is COutcome => isIn(OUTCOMES, v);
export const isChannel = (v: unknown): v is CChannel => isIn(CHANNELS, v);
export const isOpen = (s: string) => s === "RECEIVED" || s === "INVESTIGATING";
export const isDone = (s: string) => s === "RESOLVED" || s === "CLOSED";

// ─── Refs ────────────────────────────────────────────────────────────────────

export function formatRef(year: number, n: number): string {
  return `${REF_PREFIX}-${year}-${String(n).padStart(3, "0")}`;
}

export function refNumber(ref: string, year: number): number | null {
  const m = new RegExp(`^${REF_PREFIX}-${year}-(\\d{3,})$`).exec(ref);
  return m ? parseInt(m[1], 10) : null;
}

// ─── Status changes ──────────────────────────────────────────────────────────

/**
 * Check a status change; returns the outcome to store (null unless resolving a complaint).
 * A complaint is resolved with an outcome and a resolution note (the note is shown to the
 * passenger); a compliment is simply closed.
 */
export function checkStatusChange(type: string, to: unknown, outcome: unknown, resolutionNote: string | null): COutcome | null {
  if (!isType(type)) throw new ComplaintError("Unknown type");
  if (!isStatus(to) || !STATUSES_FOR[type].includes(to))
    throw new ComplaintError(type === "COMPLIMENT" ? "A compliment is either received or closed" : "A complaint is received, investigating or resolved");
  if (to !== "RESOLVED") return null;
  if (!isOutcome(outcome)) throw new ComplaintError("Choose the outcome before resolving");
  if (!resolutionNote) throw new ComplaintError("Write the resolution — the passenger sees it in the app");
  return outcome;
}

// ─── Flags, retention ────────────────────────────────────────────────────────

/** An open complaint nobody has replied to (no history entry) within 48 hours of receiving it. */
export function isReplyOverdue(
  c: { type: string; status: string; receivedAt: Date; contactCount: number },
  now = new Date()
): boolean {
  return c.type === "COMPLAINT" && isOpen(c.status) && c.contactCount === 0 && now.getTime() - c.receivedAt.getTime() > REPLY_DUE_HOURS * 3_600_000;
}

/** Hours since the complaint was received (for "reply overdue — 53 h"). */
export function hoursSince(d: Date, now = new Date()): number {
  return Math.floor((now.getTime() - d.getTime()) / 3_600_000);
}

export function deletableFrom(c: { status: string; resolvedAt?: Date | null }): Date | null {
  if (!isDone(c.status) || !c.resolvedAt) return null;
  return addMonths(ukToday(c.resolvedAt), RETENTION_MONTHS);
}

export function canDelete(c: { status: string; resolvedAt?: Date | null }, now = new Date()): boolean {
  const from = deletableFrom(c);
  return !!from && dayKey(ukToday(now)) >= dayKey(from);
}

// ─── Messages ────────────────────────────────────────────────────────────────

/** Push to the passenger when their complaint is resolved. */
export function resolvedPush(ref: string, note: string): { title: string; body: string } {
  const text = note.replace(/\s+/g, " ").trim();
  return {
    title: "Your complaint has been resolved",
    body: `${ref}: ${text.length > 140 ? text.slice(0, 139) + "…" : text}`,
  };
}

/** Ops SMS for a safety concern (null for anything else). */
export function safetyAlert(c: { type: string; category: string | null; refNo: string; bookingRef?: string | null; name?: string | null }): string | null {
  if (c.type !== "COMPLAINT" || c.category !== SAFETY_CATEGORY) return null;
  return `OrangeRide: SAFETY complaint ${c.refNo}${c.bookingRef ? ` on booking ${c.bookingRef}` : ""}${c.name ? ` from ${c.name}` : ""}. Check Alerts now.`;
}

// ─── Old passenger app format ────────────────────────────────────────────────
// Installed passenger apps (up to 1.0.12) read the complaint from Booking.feedback and the
// resolution from Booking.operatorNotes. These rebuild exactly what they parse:
//   feedback:       "[COMPLAINT] Category: <category>\n<details>"
//   operatorNotes:  "[ACK] Resolved at <iso> | Note: <one line>"   (regex \[ACK\][^\n]*Note: ([^\n]+))

export function legacyFeedback(c: { category: string | null; details: string }): string {
  return `[COMPLAINT] Category: ${c.category || "Other"}\n${c.details}`;
}

export function legacyOperatorNotes(c: { status: string; resolutionNote: string | null; resolvedAt: Date | null }): string | null {
  if (c.status !== "RESOLVED" || !c.resolutionNote?.trim()) return null;
  const line = c.resolutionNote.replace(/\s+/g, " ").trim();
  return `[ACK] Resolved at ${(c.resolvedAt ?? new Date()).toISOString()} | Note: ${line}`;
}
