// backend/src/services/documentRules.ts
//
// Pure rules for driver & vehicle documents (no database): which documents a driver needs,
// which version is in force, and whether the driver may work. Shared by dispatch, the job
// board, the driver app endpoints, the admin site and the background checks.
//
// - Driver documents: PCO badge, driving licence (front + back), DBS.
// - Vehicle documents (on the driver's CURRENT car): PHV vehicle licence, insurance, MOT, V5C.
// - A document type counts when its version in force is APPROVED and in date. Expiry dates are
//   UK calendar days: a document expiring "18 May 2027" is valid until the end of that day.
// - Uploading a renewal never takes away the version in force: the new upload waits for review
//   while the old one stays valid until it expires.
// - Approved before expiry dates were required (migration): valid until expiryGraceUntil.

export type DocType =
  | "PCO_LICENSE"
  | "DRIVING_LICENSE"
  | "DRIVING_LICENSE_BACK"
  | "PHV_LICENCE"
  | "VEHICLE_INSURANCE"
  | "MOT_CERTIFICATE"
  | "V5C_LOGBOOK"
  | "DBS_CHECK"
  | "PROFILE_PHOTO"
  | "VEHICLE_PHOTO";

export type DocStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";

export const DRIVER_REQUIRED: DocType[] = [
  "PCO_LICENSE",
  "DRIVING_LICENSE",
  "DRIVING_LICENSE_BACK",
  "DBS_CHECK",
];
export const VEHICLE_REQUIRED: DocType[] = [
  "PHV_LICENCE",
  "VEHICLE_INSURANCE",
  "MOT_CERTIFICATE",
  "V5C_LOGBOOK",
];
export const REQUIRED_TYPES: DocType[] = [...DRIVER_REQUIRED, ...VEHICLE_REQUIRED];

/** Types stored on the vehicle rather than the driver. */
export const VEHICLE_TYPES = new Set<DocType>([...VEHICLE_REQUIRED, "VEHICLE_PHOTO"]);
/** Types that must carry an expiry date before they can be approved. */
export const EXPIRY_REQUIRED = new Set<DocType>([
  "PCO_LICENSE",
  "PHV_LICENCE",
  "VEHICLE_INSURANCE",
  "MOT_CERTIFICATE",
]);
/** Types that may have several pages. */
export const MULTI_PAGE = new Set<DocType>(["VEHICLE_INSURANCE", "V5C_LOGBOOK"]);

export const DOC_LABELS: Record<DocType, string> = {
  PCO_LICENSE: "PCO badge",
  DRIVING_LICENSE: "Driving licence (front)",
  DRIVING_LICENSE_BACK: "Driving licence (back)",
  PHV_LICENCE: "PHV vehicle licence",
  VEHICLE_INSURANCE: "Insurance",
  MOT_CERTIFICATE: "MOT",
  V5C_LOGBOOK: "V5C logbook",
  DBS_CHECK: "DBS certificate",
  PROFILE_PHOTO: "Profile photo",
  VEHICLE_PHOTO: "Vehicle photo",
};

/** Expiry reminders, in days before expiry. */
export const REMINDER_DAYS = [30, 14, 7, 1];
/** "Expiring soon" in the app and admin. */
export const EXPIRING_SOON_DAYS = 30;

/** Label inside a sentence: "insurance", "driving licence (front)", but "PCO badge", "MOT". */
export const inSentence = (label: string) =>
  /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;

export const isVehicleType = (t: string) => VEHICLE_TYPES.has(t as DocType);
export const isDocType = (t: string): t is DocType => t in DOC_LABELS;

// ── UK calendar days ─────────────────────────────────────────────────────────

const ukKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "2027-05-18" — the UK calendar date of an instant. */
export const ukDateKey = (d: Date) => ukKeyFmt.format(d);

/** Whole UK calendar days from `now` to `expiry` (0 = expires today, negative = expired). */
export function daysUntil(expiry: Date, now: Date): number {
  const a = Date.parse(ukDateKey(now) + "T00:00:00Z");
  const b = Date.parse(ukDateKey(expiry) + "T00:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

/** "18 May 2027" */
export function ukDateLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** "2027-05-18" (from a date input) → stored value: midnight UTC of that date. */
export function parseExpiryDate(input: unknown): Date | null {
  if (typeof input !== "string" || !input.trim()) return null;
  const s = input.trim();
  const key = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  if (key) {
    const d = new Date(key + "T00:00:00Z");
    return isNaN(d.getTime()) ? null : d;
  }
  // Full ISO from the app's date picker: keep its UK calendar date.
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return new Date(ukDateKey(d) + "T00:00:00Z");
}

// ── Versions ─────────────────────────────────────────────────────────────────

export interface DocRow {
  id: string;
  type: string;
  status: string;
  expiryDate: Date | null;
  expiryGraceUntil: Date | null;
  replacedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  reviewedAt: Date | null;
  rejectionReason?: string | null;
}

export type DocState =
  | "valid"
  | "missing"
  | "pending" // nothing in force; an upload is waiting for review
  | "rejected" // nothing in force; the last upload was rejected
  | "expired"
  | "expiry_needed"; // approved, but no expiry date and the grace period is over

export interface TypeStatus<R extends DocRow = DocRow> {
  type: DocType;
  owner: "driver" | "vehicle";
  state: DocState;
  /** Approved version in force (may be expired). */
  current: R | null;
  /** Newest upload waiting for review (newer than `current`). */
  pending: R | null;
  /** Newest upload rejected after `current` (and no newer pending one). */
  rejected: R | null;
  expiryDate: Date | null;
  /** UK days until `current` expires (null when it has no date). */
  daysLeft: number | null;
  /** Valid only thanks to the migration grace period (admin must add the date). */
  inGrace: boolean;
}

const t = (d: Date | null | undefined) => (d ? d.getTime() : 0);

export function typeStatus<R extends DocRow>(type: DocType, rows: R[], now: Date): TypeStatus<R> {
  const live = rows.filter((r) => r.type === type && !r.archivedAt && !r.replacedAt);
  const approved = live
    .filter((r) => r.status === "APPROVED")
    .sort((a, b) => t(b.reviewedAt ?? b.createdAt) - t(a.reviewedAt ?? a.createdAt) || t(b.createdAt) - t(a.createdAt));
  const current = approved[0] ?? null;
  const newer = live
    .filter((r) => r.status === "PENDING" || r.status === "REJECTED")
    .filter((r) => !current || t(r.createdAt) > t(current.createdAt))
    .sort((a, b) => t(b.createdAt) - t(a.createdAt));
  const pending = newer.find((r) => r.status === "PENDING") ?? null;
  const rejected =
    newer[0]?.status === "REJECTED" ? newer[0] : null; // only if it is the newest upload

  const owner = VEHICLE_TYPES.has(type) ? "vehicle" : "driver";
  let state: DocState;
  let daysLeft: number | null = null;
  let inGrace = false;
  const expiryDate = current?.expiryDate ?? null;

  if (current) {
    if (expiryDate) {
      daysLeft = daysUntil(expiryDate, now);
      state = daysLeft >= 0 ? "valid" : "expired";
    } else if (EXPIRY_REQUIRED.has(type)) {
      inGrace = !!current.expiryGraceUntil && current.expiryGraceUntil > now;
      state = inGrace ? "valid" : "expiry_needed";
    } else {
      state = "valid";
    }
    // Nothing in force any more, but a replacement is waiting: show that.
    if (state !== "valid" && pending) state = state === "expired" ? "expired" : "pending";
  } else {
    state = pending ? "pending" : rejected ? "rejected" : "missing";
  }

  return { type, owner, state, current, pending, rejected, expiryDate, daysLeft, inGrace };
}

// ── Driver compliance ────────────────────────────────────────────────────────

export interface ComplianceInput<R extends DocRow = DocRow> {
  driverDocs: R[];
  vehicle: { id: string; licensePlate: string } | null;
  vehicleDocs: R[];
  now: Date;
}

export interface Compliance<R extends DocRow = DocRow> {
  eligible: boolean;
  noVehicle: boolean;
  vehicle: { id: string; licensePlate: string } | null;
  items: TypeStatus<R>[];
  /** Required types that are not valid (why the driver can't work). */
  problems: TypeStatus<R>[];
  /** Valid, but expiring within 30 days. */
  expiringSoon: TypeStatus<R>[];
}

export function evaluateCompliance<R extends DocRow>(input: ComplianceInput<R>): Compliance<R> {
  const { driverDocs, vehicle, vehicleDocs, now } = input;
  const items: TypeStatus<R>[] = [
    ...DRIVER_REQUIRED.map((type) => typeStatus(type, driverDocs, now)),
    ...(vehicle ? VEHICLE_REQUIRED.map((type) => typeStatus(type, vehicleDocs, now)) : []),
  ];
  // Most serious first: that's the one the driver is told about
  const rank: Record<DocState, number> = { expired: 0, rejected: 1, expiry_needed: 2, missing: 3, pending: 4, valid: 5 };
  const problems = items.filter((i) => i.state !== "valid").sort((a, b) => rank[a.state] - rank[b.state]);
  const expiringSoon = items.filter(
    (i) => i.state === "valid" && i.daysLeft !== null && i.daysLeft <= EXPIRING_SOON_DAYS
  );
  return {
    eligible: !!vehicle && problems.length === 0,
    noVehicle: !vehicle,
    vehicle,
    items,
    problems,
    expiringSoon,
  };
}

/** One-line reason for the driver app / API errors, e.g.
 *  "Your insurance (GL72 LXW) expired on 18 May 2026. Upload the new one in Documents." */
export function blockMessage(c: Compliance): string {
  if (c.noVehicle) return "You have no vehicle assigned. Please contact OrangeRide.";
  const p = c.problems[0];
  if (!p) return "";
  const label = inSentence(DOC_LABELS[p.type]);
  const what = p.owner === "vehicle" && c.vehicle ? `${label} (${c.vehicle.licensePlate})` : label;
  const more = c.problems.length > 1 ? ` (+${c.problems.length - 1} more)` : "";
  switch (p.state) {
    case "expired":
      return p.pending
        ? `Your ${what} expired on ${ukDateLabel(p.expiryDate!)}. The new one is waiting for approval.${more}`
        : `Your ${what} expired on ${ukDateLabel(p.expiryDate!)}. Upload the new one in Documents.${more}`;
    case "pending":
      return `Your ${what} is waiting for approval.${more}`;
    case "rejected":
      return `Your ${what} was rejected${p.rejected?.rejectionReason ? `: ${p.rejected.rejectionReason}` : ""}. Please upload it again.${more}`;
    case "expiry_needed":
      return `Your ${what} needs checking by OrangeRide before you can take jobs.${more}`;
    default:
      return `Your ${what} is missing. Upload it in Documents.${more}`;
  }
}

/** Short list for ops SMS / logs: "Insurance expired, MOT missing". */
export function problemSummary(c: Compliance): string {
  if (c.noVehicle) return "no vehicle";
  return c.problems
    .map((p) => `${DOC_LABELS[p.type]} ${p.state.replace("_", " ")}`)
    .join(", ");
}

/** The older response shape the driver app (1.0.22) reads. */
export function legacyEligibility(c: Compliance) {
  const of = (...states: DocState[]) =>
    c.problems.filter((p) => states.includes(p.state)).map((p) => p.type);
  const missing = of("missing");
  if (c.noVehicle) missing.push(...VEHICLE_REQUIRED);
  return {
    eligible: c.eligible,
    missingDocs: missing,
    pendingDocs: of("pending", "expiry_needed"),
    expiredDocs: of("expired"),
    rejectedDocs: of("rejected"),
  };
}
