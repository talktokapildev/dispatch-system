// backend/src/services/complaint.service.ts
//
// TfL Condition 7 complaints / compliments register: passenger complaints (app), items logged
// by staff, compliments recorded from rating comments, edits, the history, status changes,
// the passenger push on resolving, the ops SMS for safety concerns, permanent deletion after
// 12 months, and the old-format fields installed passenger apps read.
//
// Refs (CC-2026-001) are allocated inside the transaction that creates the record, under a
// Postgres advisory lock. Booking time, complainant, driver name and vehicle reg are COPIED when
// a booking is linked, so the record stays right if those are later changed or deleted.
import { Prisma, PrismaClient } from "@prisma/client";
import { NotificationService } from "./notification.service";
import { opsAlert } from "./documentWatch.service";
import { LostPropertyError, bookingDateTime, cleanText, normaliseReg, parseUkDateTime, ukDateLabel, ukYear } from "./lostPropertyRules";
import {
  CATEGORIES,
  ComplaintError,
  OUTCOME_LABELS,
  STATUS_LABELS,
  canDelete,
  checkStatusChange,
  deletableFrom,
  formatRef,
  isChannel,
  isDone,
  isType,
  legacyFeedback,
  legacyOperatorNotes,
  refNumber,
  resolvedPush,
  safetyAlert,
  type CChannel,
  type COutcome,
  type CStatus,
  type CType,
} from "./complaintRules";

type Tx = Prisma.TransactionClient;
type Log = { warn: (msg: string) => void; error?: (...a: any[]) => void };
export type PushFn = (userId: string, n: { title: string; body: string; data?: Record<string, any> }) => Promise<unknown>;
export type AlertFn = (text: string) => Promise<unknown>;
export type ComplaintDeps = { prisma: PrismaClient; log: Log; push?: PushFn; alert?: AlertFn; now?: Date };

const REF_LOCK = "complaint_ref";
const MAX = { details: 2000, name: 120, address: 400, phone: 40, note: 2000, category: 60, reg: 10 };

const personName = (u: { firstName: string; lastName: string | null } | null | undefined) =>
  u ? `${u.firstName} ${u.lastName ?? ""}`.trim() || null : null;

/** cleanText from the shared rules, with complaint errors. */
function text(value: unknown, field: string, max: number): string | null {
  try {
    return cleanText(value, field, max);
  } catch (e) {
    if (e instanceof LostPropertyError) throw new ComplaintError(e.message);
    throw e;
  }
}

function timeField(value: unknown, field: string, now: Date, allowFuture = false): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = parseUkDateTime(value);
  if (!d) throw new ComplaintError(`${field} is not a valid date and time`);
  if (!allowFuture && d.getTime() > now.getTime() + 5 * 60_000) throw new ComplaintError(`${field} can't be in the future`);
  return d;
}

export async function staffName(prisma: PrismaClient | Tx, userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
  return personName(u) || "Staff";
}

async function sendPush(deps: ComplaintDeps, userId: string | null | undefined, n: { title: string; body: string }, data: Record<string, any>) {
  if (!userId) return;
  const push: PushFn = deps.push ?? ((uid, msg) => new NotificationService(deps.prisma).sendToUser(uid, msg, "passenger"));
  try {
    await push(userId, { ...n, data });
  } catch (err) {
    deps.log.warn(`[Complaints] push failed: ${(err as Error).message}`);
  }
}

async function sendAlert(deps: ComplaintDeps, textMsg: string | null) {
  if (!textMsg) return;
  try {
    await (deps.alert ?? ((t: string) => opsAlert(deps.log, t)))(textMsg);
  } catch (err) {
    deps.log.warn(`[Complaints] ops alert failed: ${(err as Error).message}`);
  }
}

// ─── Refs ────────────────────────────────────────────────────────────────────

export async function allocateRef(tx: Tx, now: Date): Promise<string> {
  const year = ukYear(now);
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('${REF_LOCK}'))`);
  const rows = await tx.complaint.findMany({ where: { refNo: { startsWith: `CC-${year}-` } }, select: { refNo: true } });
  const max = rows.reduce((m, r) => Math.max(m, refNumber(r.refNo, year) ?? 0), 0);
  return formatRef(year, max + 1);
}

// ─── Booking link ────────────────────────────────────────────────────────────

const BOOKING_SELECT = {
  id: true,
  reference: true,
  passengerId: true,
  driverId: true,
  vehicleId: true,
  scheduledAt: true,
  tripStartedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  feedback: true,
  vehicle: { select: { licensePlate: true } },
  driver: { select: { user: { select: { firstName: true, lastName: true } } } },
  passenger: { select: { user: { select: { firstName: true, lastName: true, phone: true } } } },
} satisfies Prisma.BookingSelect;
type BookingRow = Prisma.BookingGetPayload<{ select: typeof BOOKING_SELECT }>;

async function findBooking(tx: Tx | PrismaClient, by: { id?: string | null; reference?: string | null }): Promise<BookingRow> {
  const reference = by.reference?.trim().toUpperCase();
  const b = by.id
    ? await tx.booking.findUnique({ where: { id: by.id }, select: BOOKING_SELECT })
    : reference
      ? await tx.booking.findUnique({ where: { reference }, select: BOOKING_SELECT })
      : null;
  if (!b) throw new ComplaintError(reference && !by.id ? `Booking ${reference} not found` : "Booking not found", 404);
  return b;
}

/** Columns copied from a booking. */
function fromBooking(b: BookingRow) {
  return {
    bookingId: b.id,
    passengerId: b.passengerId,
    driverId: b.driverId,
    vehicleId: b.vehicleId,
    bookingDateTime: bookingDateTime(b),
    driverName: personName(b.driver?.user),
    vehicleReg: b.vehicle?.licensePlate ?? null,
    complainantName: personName(b.passenger?.user),
    complainantPhone: b.passenger?.user.phone ?? null,
  };
}

// ─── Details an admin can set ────────────────────────────────────────────────

export type DetailsInput = {
  type?: string;
  channel?: string;
  category?: string | null;
  details?: string | null;
  bookingId?: string | null;
  bookingReference?: string | null;
  receivedAt?: string | null;
  bookingDateTime?: string | null;
  complainantName?: string | null;
  complainantAddress?: string | null;
  complainantPhone?: string | null;
  driverName?: string | null;
  vehicleReg?: string | null;
  handledByUserId?: string | null;
};

type Current = {
  channel: string;
  bookingId: string | null;
  complainantName: string | null;
  complainantPhone: string | null;
} | null;

async function detailsData(tx: Tx, current: Current, input: DetailsInput, now: Date) {
  const data: Prisma.ComplaintUncheckedUpdateInput = {};
  const has = (k: keyof DetailsInput) => Object.prototype.hasOwnProperty.call(input, k);

  if (has("type")) {
    if (!isType(input.type)) throw new ComplaintError("Choose complaint or compliment");
    data.type = input.type;
  }
  if (has("channel")) {
    if (!isChannel(input.channel)) throw new ComplaintError("Choose how it was received");
    data.channel = input.channel;
  }
  if (has("category")) data.category = text(input.category, "Category", MAX.category);
  if (has("details")) {
    const d = text(input.details, "Details", MAX.details);
    if (!d) throw new ComplaintError("Write the details");
    data.details = d;
  }

  if (has("bookingId") || has("bookingReference")) {
    const wanted = input.bookingId || input.bookingReference?.trim();
    const appReport = current?.channel === "APP" && !!current.bookingId;
    if (!wanted) {
      if (appReport) throw new ComplaintError("A complaint made in the app stays on the booking it was made on");
      data.bookingId = null;
      data.passengerId = null;
    } else {
      const b = await findBooking(tx, { id: input.bookingId, reference: input.bookingReference });
      if (b.id !== current?.bookingId) {
        if (appReport) throw new ComplaintError("A complaint made in the app stays on the booking it was made on");
        const copy = fromBooking(b);
        data.bookingId = copy.bookingId;
        data.passengerId = copy.passengerId;
        data.driverId = copy.driverId;
        data.bookingDateTime = copy.bookingDateTime;
        if (!has("driverName")) data.driverName = copy.driverName;
        if (!has("vehicleReg")) {
          data.vehicleId = copy.vehicleId;
          data.vehicleReg = copy.vehicleReg;
        }
        if (!has("complainantName") && !current?.complainantName) data.complainantName = copy.complainantName;
        if (!has("complainantPhone") && !current?.complainantPhone) data.complainantPhone = copy.complainantPhone;
      }
    }
  }

  if (has("receivedAt")) {
    const d = timeField(input.receivedAt, "Date received", now);
    if (!d) throw new ComplaintError("Date received is required");
    data.receivedAt = d;
  }
  if (has("bookingDateTime")) data.bookingDateTime = timeField(input.bookingDateTime, "Date and time of booking", now, true);
  if (has("complainantName")) data.complainantName = text(input.complainantName, "Name", MAX.name);
  if (has("complainantAddress")) data.complainantAddress = text(input.complainantAddress, "Address", MAX.address);
  if (has("complainantPhone")) data.complainantPhone = text(input.complainantPhone, "Phone number", MAX.phone);
  if (has("driverName")) data.driverName = text(input.driverName, "Driver", MAX.name);
  if (has("vehicleReg")) {
    const reg = normaliseReg(input.vehicleReg);
    if (reg && reg.length > MAX.reg) throw new ComplaintError("Vehicle registration is not valid");
    const fleet = reg ? await tx.vehicle.findMany({ select: { id: true, licensePlate: true } }) : [];
    data.vehicleReg = reg;
    data.vehicleId = fleet.find((v) => normaliseReg(v.licensePlate) === reg)?.id ?? null;
  }
  if (has("handledByUserId")) {
    if (input.handledByUserId) {
      const u = await tx.user.findUnique({ where: { id: input.handledByUserId }, select: { id: true, firstName: true, lastName: true, roles: true } });
      if (!u || !u.roles.some((r) => r === "ADMIN" || r === "DISPATCHER")) throw new ComplaintError("Staff member not found", 404);
      data.handledByUserId = u.id;
      data.handledByName = personName(u);
    } else {
      data.handledByUserId = null;
      data.handledByName = null;
    }
  }
  return data;
}

// ─── Passenger complaint (app) ───────────────────────────────────────────────

export async function reportByPassenger(
  deps: ComplaintDeps,
  input: { userId: string; bookingId: string; category: unknown; description: unknown }
) {
  const { prisma } = deps;
  const now = deps.now ?? new Date();
  const category = text(input.category, "Category", MAX.category);
  const details = text(input.description, "Description", MAX.details);
  if (!category || !details) throw new ComplaintError("Category and description are required");

  const passenger = await prisma.passenger.findUnique({ where: { userId: input.userId }, select: { id: true } });
  if (!passenger) throw new ComplaintError("Not found", 403);
  const booking = await findBooking(prisma, { id: input.bookingId });
  if (booking.passengerId !== passenger.id) throw new ComplaintError("Access denied", 403);
  const existing = await prisma.complaint.findFirst({
    where: { bookingId: booking.id, passengerId: passenger.id, type: "COMPLAINT", channel: "APP" },
    select: { id: true },
  });
  if (existing) throw new ComplaintError("You've already made a complaint about this booking");

  const complaint = await prisma.$transaction(async (tx) => {
    const refNo = await allocateRef(tx, now);
    return tx.complaint.create({
      data: { ...fromBooking(booking), refNo, type: "COMPLAINT", channel: "APP", category, details, receivedAt: now },
    });
  });
  await sendAlert(deps, safetyAlert({ ...complaint, bookingRef: booking.reference, name: complaint.complainantName }));
  return { complaint, booking };
}

// ─── Phone: taken by Araa, the AI receptionist ───────────────────────────────

export const PHONE_ASSISTANT = "Araa (AI phone assistant)";

/** A complaint or compliment Araa took on a call: channel PHONE, no staff handler yet. */
export async function logFromPhoneAssistant(
  deps: ComplaintDeps,
  input: {
    type: "COMPLAINT" | "COMPLIMENT";
    category?: string | null;
    details: string;
    bookingId?: string | null;
    passengerId?: string | null;
    complainantName?: string | null;
    complainantPhone?: string | null;
  }
) {
  const { prisma } = deps;
  const now = deps.now ?? new Date();
  const details = text(input.details, "Details", MAX.details);
  if (!details) throw new ComplaintError("Details are required");
  const category = input.type === "COMPLAINT" ? (CATEGORIES.includes(input.category ?? "") ? input.category! : "Other") : null;
  const booking = input.bookingId ? await findBooking(prisma, { id: input.bookingId }) : null;

  const created = await prisma.$transaction(async (tx) => {
    const refNo = await allocateRef(tx, now);
    const c = await tx.complaint.create({
      data: {
        ...(booking ? fromBooking(booking) : { passengerId: input.passengerId ?? null }),
        // What the caller told Araa wins over the booking copy (e.g. calling for someone else)
        complainantName: text(input.complainantName, "Name", MAX.name) ?? (booking ? personName(booking.passenger?.user) : null),
        complainantPhone: text(input.complainantPhone, "Phone number", MAX.phone) ?? booking?.passenger?.user.phone ?? null,
        refNo,
        type: input.type,
        channel: "PHONE",
        category,
        details,
        receivedAt: now,
      },
    });
    await tx.complaintContact.create({
      data: {
        complaintId: c.id,
        at: now,
        staffName: PHONE_ASSISTANT,
        note: `Taken by phone by Araa. The call and its transcript are on the Araa calls page.${booking ? "" : " No booking linked yet: check which trip it was."}`,
      },
    });
    return c;
  });
  await sendAlert(deps, safetyAlert({ ...created, bookingRef: booking?.reference, name: created.complainantName }));
  return { complaint: created, booking };
}

// ─── Staff: log a complaint / compliment ─────────────────────────────────────

export type LogInput = DetailsInput & { note?: string | null };

export async function logItem(deps: ComplaintDeps, input: LogInput, adminUserId: string) {
  const { prisma } = deps;
  const now = deps.now ?? new Date();
  const type = (input.type ?? "COMPLAINT") as CType;
  const channel = (input.channel ?? "PHONE") as CChannel;
  if (!isType(type)) throw new ComplaintError("Choose complaint or compliment");
  if (!isChannel(channel)) throw new ComplaintError("Choose how it was received");
  if (!Object.prototype.hasOwnProperty.call(input, "details")) throw new ComplaintError("Write the details");
  const note = text(input.note, "Note", MAX.note);
  const admin = await staffName(prisma, adminUserId);

  const created = await prisma.$transaction(async (tx) => {
    const data = await detailsData(tx, null, { handledByUserId: adminUserId, ...input, type, channel }, now);
    const refNo = await allocateRef(tx, now);
    const c = await tx.complaint.create({
      data: {
        ...(data as Prisma.ComplaintUncheckedCreateInput),
        refNo,
        type,
        channel,
        details: data.details as string,
        receivedAt: (data.receivedAt as Date | undefined) ?? now,
        createdByUserId: adminUserId,
      },
    });
    if (note) await tx.complaintContact.create({ data: { complaintId: c.id, at: now, staffName: admin, staffUserId: adminUserId, note } });
    return c;
  });

  const full = await loadItem(prisma, created.id);
  await sendAlert(deps, safetyAlert({ ...full, bookingRef: full.booking?.reference, name: full.complainantName }));
  return full;
}

/** Feedback page: record a passenger's rating comment as a compliment. */
export async function complimentFromRating(deps: ComplaintDeps, bookingId: string, adminUserId: string) {
  const { prisma } = deps;
  const booking = await findBooking(prisma, { id: bookingId });
  const comment = booking.feedback?.trim();
  if (!comment) throw new ComplaintError("This trip has no rating comment");
  const already = await prisma.complaint.findFirst({ where: { bookingId, type: "COMPLIMENT", details: comment }, select: { refNo: true } });
  if (already) throw new ComplaintError(`Already recorded as ${already.refNo}`);
  return logItem(
    deps,
    { type: "COMPLIMENT", channel: "APP", bookingId, details: comment, receivedAt: booking.updatedAt.toISOString() },
    adminUserId
  );
}

// ─── Staff: update ───────────────────────────────────────────────────────────

export type UpdateInput = {
  details?: DetailsInput;
  note?: string | null;
  noteAt?: string | null;
  status?: string;
  outcome?: string | null;
  resolutionNote?: string | null;
  representativeName?: string | null;
};

export async function updateItem(deps: ComplaintDeps, id: string, input: UpdateInput, adminUserId: string) {
  const { prisma } = deps;
  const now = deps.now ?? new Date();
  const admin = await staffName(prisma, adminUserId);
  const note = text(input.note, "Note", MAX.note);

  const result = await prisma.$transaction(async (tx) => {
    const cur = await tx.complaint.findUnique({ where: { id } });
    if (!cur) throw new ComplaintError("Complaint not found", 404);
    const data: Prisma.ComplaintUncheckedUpdateInput = input.details ? await detailsData(tx, cur, input.details, now) : {};
    if (data.type && data.type !== cur.type && isDone(cur.status))
      throw new ComplaintError("Reopen it before changing between complaint and compliment");
    const type = (data.type as CType | undefined) ?? (cur.type as CType);
    const entries: { at: Date; note: string }[] = [];

    // First person to act on it handles it, unless someone was chosen
    if (!cur.handledByUserId && !("handledByUserId" in data)) {
      data.handledByUserId = adminUserId;
      data.handledByName = admin;
    }

    const resolution = text(input.resolutionNote, "Resolution", MAX.note);
    const to = input.status && input.status !== cur.status ? input.status : null;
    if (to) {
      const outcome = checkStatusChange(type, to, input.outcome, resolution);
      data.status = to as CStatus;
      if (isDone(to)) {
        data.outcome = outcome;
        data.resolutionNote = resolution; // compliments: optional, e.g. "Passed to the driver"
        data.resolvedAt = now;
        data.closedByUserId = adminUserId;
        data.representativeName = text(input.representativeName, "Company representative name", MAX.name) ?? admin;
      } else if (isDone(cur.status)) {
        data.outcome = null;
        data.resolutionNote = null;
        data.resolvedAt = null;
        data.closedByUserId = null;
        data.representativeName = null;
      }
      entries.push({
        at: now,
        note: `Status: ${STATUS_LABELS[cur.status as CStatus]} → ${STATUS_LABELS[to as CStatus]}${outcome ? ` (${OUTCOME_LABELS[outcome]})` : ""}`,
      });
    } else if (isDone(cur.status) && (input.outcome !== undefined || input.resolutionNote !== undefined || input.representativeName !== undefined)) {
      // Correcting the result of a resolved / closed item
      const outcome = checkStatusChange(type, cur.status, input.outcome ?? cur.outcome, resolution ?? cur.resolutionNote);
      data.outcome = outcome;
      if (input.resolutionNote !== undefined) data.resolutionNote = resolution;
      if (input.representativeName !== undefined)
        data.representativeName = text(input.representativeName, "Company representative name", MAX.name) ?? admin;
    }

    if (note) entries.push({ at: timeField(input.noteAt, "Date of the note", now) ?? now, note });

    const updated = await tx.complaint.update({ where: { id }, data });
    for (const e of entries)
      await tx.complaintContact.create({ data: { complaintId: id, at: e.at, note: e.note, staffName: admin, staffUserId: adminUserId } });
    return { from: cur.status, updated };
  });

  const full = await loadItem(prisma, id);
  const u = result.updated;
  if (u.type === "COMPLAINT" && u.status === "RESOLVED" && result.from !== "RESOLVED" && u.resolutionNote)
    await sendPush(deps, full.passenger?.userId, resolvedPush(u.refNo, u.resolutionNote), {
      type: "COMPLAINT",
      complaintId: u.id,
      bookingId: u.bookingId,
      refNo: u.refNo,
    });
  return full;
}

// ─── Staff: permanent delete ─────────────────────────────────────────────────

export async function deleteItem(deps: ComplaintDeps, id: string, confirmRef: unknown) {
  const { prisma } = deps;
  const now = deps.now ?? new Date();
  const c = await prisma.complaint.findUnique({ where: { id } });
  if (!c) throw new ComplaintError("Complaint not found", 404);
  if (!isDone(c.status)) throw new ComplaintError("Only a resolved or closed record can be deleted");
  if (!canDelete(c, now))
    throw new ComplaintError(`TfL records must be kept for 12 months — this one can be deleted from ${ukDateLabel(deletableFrom(c))}`);
  if (typeof confirmRef !== "string" || confirmRef.trim().toUpperCase() !== c.refNo) throw new ComplaintError(`Type ${c.refNo} to confirm`);
  await prisma.complaint.delete({ where: { id } });
  return { refNo: c.refNo };
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export const ITEM_INCLUDE = {
  booking: { select: { id: true, reference: true, pickupAddress: true, dropoffAddress: true } },
  passenger: { select: { id: true, userId: true } },
  contacts: { orderBy: [{ at: "asc" }, { createdAt: "asc" }] },
} satisfies Prisma.ComplaintInclude;

export type ComplaintItem = Prisma.ComplaintGetPayload<{ include: typeof ITEM_INCLUDE }>;

export async function loadItem(prisma: PrismaClient, id: string): Promise<ComplaintItem> {
  const c = await prisma.complaint.findUnique({ where: { id }, include: ITEM_INCLUDE });
  if (!c) throw new ComplaintError("Complaint not found", 404);
  return c;
}

/**
 * Bookings as the passenger app sees them: never the real operator notes; the passenger's
 * complaint (if any) rebuilt into the old feedback / operatorNotes text installed apps read.
 */
export async function passengerBookings<T extends { id: string; feedback?: string | null; operatorNotes?: string | null }>(
  prisma: PrismaClient,
  passengerId: string,
  bookings: T[]
): Promise<T[]> {
  const ids = bookings.map((b) => b.id);
  const complaints = ids.length
    ? await prisma.complaint.findMany({
        where: { bookingId: { in: ids }, passengerId, type: "COMPLAINT" },
        select: { bookingId: true, category: true, details: true, status: true, resolutionNote: true, resolvedAt: true },
        orderBy: { receivedAt: "asc" },
      })
    : [];
  const first = new Map<string, (typeof complaints)[number]>();
  for (const c of complaints) if (c.bookingId && !first.has(c.bookingId)) first.set(c.bookingId, c);
  return bookings.map((b) => {
    const c = first.get(b.id);
    return {
      ...b,
      operatorNotes: c ? legacyOperatorNotes(c) : null,
      feedback: c ? legacyFeedback(c) : b.feedback ?? null,
    };
  });
}

export { CATEGORIES };
export type { COutcome };
