// backend/src/services/lostProperty.service.ts
//
// TfL Condition 9 lost property register: passenger reports (app), items logged by staff, edits,
// the enquiry history, status changes with their result, passenger pushes, and permanent
// deletion once a closed record is 12 months old.
//
// Every new item gets its ref (LP-2026-001) inside the same transaction that creates it, under a
// Postgres advisory lock, so two items saved at the same moment can't get the same number.
// Booking details, vehicle reg and customer name are COPIED onto the record when a booking is
// linked, so the record stays right if the booking, passenger or vehicle is later changed or deleted.
import { Prisma, PrismaClient } from "@prisma/client";
import { NotificationService } from "./notification.service";
import {
  LostPropertyError,
  OUTCOME_LABELS,
  STATUS_LABELS,
  bookingDateTime,
  canDelete,
  checkStatusChange,
  cleanText,
  deletableFrom,
  formatRef,
  isClosed,
  isStatus,
  normaliseReg,
  parseUkDateTime,
  pushFor,
  refNumber,
  ukDateLabel,
  ukYear,
  type LpOutcome,
  type LpStatus,
} from "./lostPropertyRules";

type Tx = Prisma.TransactionClient;
type Log = { warn: (msg: string) => void; error?: (...a: any[]) => void };
export type PushFn = (userId: string, n: { title: string; body: string; data?: Record<string, any> }) => Promise<unknown>;
export type LpDeps = { prisma: PrismaClient; log: Log; push?: PushFn; now?: Date };

const REF_LOCK = "lost_property_ref";
const MAX = { description: 1000, name: 120, address: 400, phone: 40, note: 1000, details: 1000 };

const personName = (u: { firstName: string; lastName: string | null } | null | undefined) =>
  u ? `${u.firstName} ${u.lastName ?? ""}`.trim() : null;

/** Passenger push (passenger app only). Failures are logged, never thrown. */
async function sendPush(deps: LpDeps, userId: string | null | undefined, n: { title: string; body: string }, data: Record<string, any>) {
  if (!userId) return;
  const push: PushFn = deps.push ?? ((uid, msg) => new NotificationService(deps.prisma).sendToUser(uid, msg, "passenger"));
  try {
    await push(userId, { ...n, data });
  } catch (err) {
    deps.log.warn(`[LostProperty] push failed: ${(err as Error).message}`);
  }
}

/** The admin's name for the history and "Company Representative Name". */
export async function staffName(prisma: PrismaClient | Tx, userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
  return personName(u) || "Staff";
}

// ─── Ref numbers ─────────────────────────────────────────────────────────────

/** Next ref for the UK year of `now`. Must run inside the transaction that creates the item. */
export async function allocateRef(tx: Tx, now: Date): Promise<string> {
  const year = ukYear(now);
  // Held until the transaction ends: a second item waits here, then sees this one's ref.
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('${REF_LOCK}'))`);
  const rows = await tx.lostProperty.findMany({
    where: { refNo: { startsWith: `LP-${year}-` } },
    select: { refNo: true },
  });
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
  vehicle: { select: { licensePlate: true } },
  passenger: { select: { user: { select: { firstName: true, lastName: true, phone: true } } } },
} satisfies Prisma.BookingSelect;

async function findBooking(tx: Tx, by: { id?: string | null; reference?: string | null }) {
  const reference = by.reference?.trim().toUpperCase();
  const b = by.id
    ? await tx.booking.findUnique({ where: { id: by.id }, select: BOOKING_SELECT })
    : reference
      ? await tx.booking.findUnique({ where: { reference }, select: BOOKING_SELECT })
      : null;
  if (!b) throw new LostPropertyError(reference && !by.id ? `Booking ${reference} not found` : "Booking not found", 404);
  return b;
}

// ─── Template fields ─────────────────────────────────────────────────────────

/** Fields an admin can set. A key left out = unchanged; null / "" = cleared. */
export type DetailsInput = {
  bookingId?: string | null;
  bookingReference?: string | null;
  description?: string | null;
  handedInByDriverId?: string | null;
  handedInByName?: string | null;
  vehicleReg?: string | null;
  receivedAt?: string | null;
  bookingDateTime?: string | null;
  customerName?: string | null;
  customerAddress?: string | null;
  contactPhone?: string | null;
};

type Current = {
  source: string;
  bookingId: string | null;
  customerName: string | null;
  contactPhone: string;
} | null;

function timeField(value: unknown, field: string, now: Date, allowFuture = false): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = parseUkDateTime(value);
  if (!d) throw new LostPropertyError(`${field} is not a valid date and time`);
  if (!allowFuture && d.getTime() > now.getTime() + 5 * 60_000) throw new LostPropertyError(`${field} can't be in the future`);
  return d;
}

/** Turn admin input into the columns to write (booking details copied when a booking is linked). */
async function detailsData(tx: Tx, current: Current, input: DetailsInput, now: Date) {
  const data: Prisma.LostPropertyUncheckedUpdateInput = {};
  const has = (k: keyof DetailsInput) => Object.prototype.hasOwnProperty.call(input, k);

  if (has("description")) {
    const d = cleanText(input.description, "Details of property", MAX.description);
    if (!d) throw new LostPropertyError("Describe the property");
    data.description = d;
  }

  if (has("bookingId") || has("bookingReference")) {
    const wanted = input.bookingId || input.bookingReference?.trim();
    if (!wanted) {
      if (current?.source === "PASSENGER_REPORT" && current.bookingId)
        throw new LostPropertyError("A passenger's report stays linked to the booking it was made on");
      data.bookingId = null;
      data.passengerId = null;
    } else {
      const b = await findBooking(tx, { id: input.bookingId, reference: input.bookingReference });
      if (b.id !== current?.bookingId) {
        if (current?.source === "PASSENGER_REPORT" && current.bookingId)
          throw new LostPropertyError("A passenger's report stays linked to the booking it was made on");
        data.bookingId = b.id;
        data.passengerId = b.passengerId;
        data.bookingDateTime = bookingDateTime(b);
        if (!has("vehicleReg")) {
          data.vehicleId = b.vehicleId;
          data.vehicleReg = b.vehicle?.licensePlate ?? null;
        }
        const u = b.passenger?.user;
        if (u && !has("customerName") && !current?.customerName) data.customerName = personName(u);
        if (u && !has("contactPhone") && !current?.contactPhone) data.contactPhone = u.phone;
      }
    }
  }

  if (has("handedInByDriverId") && input.handedInByDriverId) {
    const d = await tx.driver.findUnique({
      where: { id: input.handedInByDriverId },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
    });
    if (!d) throw new LostPropertyError("Driver not found", 404);
    data.handedInByDriverId = d.id;
    data.handedInByName = personName(d.user);
  } else if (has("handedInByDriverId") || has("handedInByName")) {
    data.handedInByDriverId = null;
    data.handedInByName = cleanText(input.handedInByName, "Handed in by", MAX.name);
  }

  if (has("vehicleReg")) {
    const reg = normaliseReg(input.vehicleReg);
    if (reg && reg.length > 10) throw new LostPropertyError("Vehicle registration is not valid");
    let vehicleId: string | null = null;
    if (reg) {
      const fleet = await tx.vehicle.findMany({ select: { id: true, licensePlate: true } });
      vehicleId = fleet.find((v) => normaliseReg(v.licensePlate) === reg)?.id ?? null;
    }
    data.vehicleReg = reg;
    data.vehicleId = vehicleId;
  }

  if (has("receivedAt")) data.receivedAt = timeField(input.receivedAt, "Date property received", now);
  if (has("bookingDateTime")) data.bookingDateTime = timeField(input.bookingDateTime, "Date and time of booking", now, true);
  if (has("customerName")) data.customerName = cleanText(input.customerName, "Customer name", MAX.name);
  if (has("customerAddress")) data.customerAddress = cleanText(input.customerAddress, "Customer address", MAX.address);
  if (has("contactPhone")) data.contactPhone = cleanText(input.contactPhone, "Phone number", MAX.phone) ?? "";
  return data;
}

// ─── Passenger report (app) ──────────────────────────────────────────────────

export async function reportByPassenger(
  deps: LpDeps,
  input: { userId: string; bookingId: string; description: unknown; contactPhone?: unknown }
) {
  const { prisma } = deps;
  const now = deps.now ?? new Date();
  const description = cleanText(input.description, "Description", MAX.description);
  if (!description) throw new LostPropertyError("Description is required");

  const passenger = await prisma.passenger.findUnique({ where: { userId: input.userId }, include: { user: true } });
  if (!passenger) throw new LostPropertyError("Not found", 403);
  const booking = await prisma.booking.findUnique({ where: { id: input.bookingId }, select: BOOKING_SELECT });
  if (!booking) throw new LostPropertyError("Booking not found", 404);
  if (booking.passengerId !== passenger.id) throw new LostPropertyError("Access denied", 403);

  const existing = await prisma.lostProperty.findFirst({ where: { bookingId: booking.id, passengerId: passenger.id } });
  if (existing) throw new LostPropertyError("Lost property already reported for this booking");

  const phone =
    (typeof input.contactPhone === "string" && cleanText(input.contactPhone, "Phone number", MAX.phone)) ||
    passenger.user.phone;

  const report = await prisma.$transaction(async (tx) => {
    const refNo = await allocateRef(tx, now);
    return tx.lostProperty.create({
      data: {
        refNo,
        source: "PASSENGER_REPORT",
        bookingId: booking.id,
        passengerId: passenger.id,
        description,
        contactPhone: phone,
        reportedAt: now,
        bookingDateTime: bookingDateTime(booking),
        vehicleId: booking.vehicleId,
        vehicleReg: booking.vehicle?.licensePlate ?? null,
        customerName: personName(passenger.user),
      },
    });
  });
  return { report, booking, passenger };
}

// ─── Phone: taken by Araa, the AI receptionist ───────────────────────────────

/** A customer reporting something left in a car, taken by Araa on a call (status REPORTED). */
export async function reportByPhoneAssistant(
  deps: LpDeps,
  input: { description: string; bookingId?: string | null; passengerId?: string | null; customerName?: string | null; contactPhone: string }
) {
  const { prisma } = deps;
  const now = deps.now ?? new Date();
  const description = cleanText(input.description, "Description", MAX.description);
  if (!description) throw new LostPropertyError("Description is required");
  const phone = cleanText(input.contactPhone, "Phone number", MAX.phone);
  if (!phone) throw new LostPropertyError("A phone number is required");
  const booking = input.bookingId
    ? await prisma.booking.findUnique({ where: { id: input.bookingId }, select: BOOKING_SELECT })
    : null;

  const report = await prisma.$transaction(async (tx) => {
    const refNo = await allocateRef(tx, now);
    const r = await tx.lostProperty.create({
      data: {
        refNo,
        source: "PASSENGER_REPORT",
        status: "REPORTED",
        bookingId: booking?.id ?? null,
        passengerId: booking?.passengerId ?? input.passengerId ?? null,
        description,
        contactPhone: phone,
        reportedAt: now,
        bookingDateTime: booking ? bookingDateTime(booking) : null,
        vehicleId: booking?.vehicleId ?? null,
        vehicleReg: booking?.vehicle?.licensePlate ?? null,
        customerName: cleanText(input.customerName, "Customer name", MAX.name) ?? (booking ? personName(booking.passenger?.user) : null),
      },
    });
    await tx.lostPropertyContact.create({
      data: {
        lostPropertyId: r.id,
        at: now,
        staffName: "Araa (AI phone assistant)",
        note: `Reported by phone to Araa. The call and its transcript are on the Araa calls page.${booking ? "" : " No booking linked yet: check which trip it was."}`,
      },
    });
    return r;
  });
  return { report, booking };
}

// ─── Staff: log an item ──────────────────────────────────────────────────────

export type LogInput = DetailsInput & {
  status?: "REPORTED" | "FOUND"; // FOUND = in our hands (default); REPORTED = customer says it's missing
  note?: string | null;
  showToPassenger?: boolean;
};

export async function logItem(deps: LpDeps, input: LogInput, adminUserId: string) {
  const { prisma } = deps;
  const now = deps.now ?? new Date();
  const status: LpStatus = input.status ?? "FOUND";
  if (status !== "FOUND" && status !== "REPORTED") throw new LostPropertyError("A new item is either found or reported missing");
  if (!Object.prototype.hasOwnProperty.call(input, "description")) throw new LostPropertyError("Describe the property");
  const note = cleanText(input.note, "Note", MAX.note);
  const admin = await staffName(prisma, adminUserId);

  const item = await prisma.$transaction(async (tx) => {
    const data = await detailsData(tx, null, input, now);
    if (status === "FOUND" && !data.receivedAt) data.receivedAt = now;
    const refNo = await allocateRef(tx, now);
    const created = await tx.lostProperty.create({
      data: {
        ...(data as Prisma.LostPropertyUncheckedCreateInput),
        refNo,
        source: "ADMIN_FOUND",
        status,
        description: data.description as string,
        contactPhone: (data.contactPhone as string | undefined) ?? "",
        reportedAt: now,
        createdByUserId: adminUserId,
        adminNotes: note && input.showToPassenger ? note : null,
      },
    });
    await tx.lostPropertyContact.create({
      data: {
        lostPropertyId: created.id,
        at: now,
        staffName: admin,
        staffUserId: adminUserId,
        note: status === "FOUND" ? "Logged as found / handed in" : "Logged as reported missing",
      },
    });
    if (note)
      await tx.lostPropertyContact.create({
        data: { lostPropertyId: created.id, at: now, staffName: admin, staffUserId: adminUserId, note, shownToPassenger: !!input.showToPassenger },
      });
    return created;
  });

  const full = await loadItem(prisma, item.id);
  const msg = pushFor(null, status, item.refNo);
  if (msg) await sendPush(deps, full.passenger?.userId, msg, pushData(full));
  return full;
}

// ─── Staff: update ───────────────────────────────────────────────────────────

export type UpdateInput = {
  details?: DetailsInput;
  note?: string | null; // a new history entry ("Method/Enquiry to return property")
  noteAt?: string | null; // when it happened (default now)
  showToPassenger?: boolean; // also show it in the passenger app ("Update: …")
  status?: string;
  outcome?: string | null;
  outcomeAt?: string | null;
  outcomeDetails?: string | null;
  representativeName?: string | null;
};

export async function updateItem(deps: LpDeps, id: string, input: UpdateInput, adminUserId: string) {
  const { prisma } = deps;
  const now = deps.now ?? new Date();
  const admin = await staffName(prisma, adminUserId);
  const note = cleanText(input.note, "Note", MAX.note);

  const result = await prisma.$transaction(async (tx) => {
    const cur = await tx.lostProperty.findUnique({ where: { id } });
    if (!cur) throw new LostPropertyError("Lost property item not found", 404);
    const data: Prisma.LostPropertyUncheckedUpdateInput = input.details ? await detailsData(tx, cur, input.details, now) : {};
    const entries: { at: Date; note: string; shownToPassenger: boolean }[] = [];

    const to = input.status && input.status !== cur.status ? input.status : null;
    const closingFields = () => {
      data.outcomeAt = timeField(input.outcomeAt, "Date of the result", now) ?? (to ? now : cur.outcomeAt ?? now);
      data.outcomeDetails = cleanText(input.outcomeDetails, "Result details", MAX.details);
      data.representativeName = cleanText(input.representativeName, "Company representative name", MAX.name) ?? admin;
    };

    if (to) {
      if (!isStatus(to)) throw new LostPropertyError("Unknown status");
      const outcome = checkStatusChange(to, input.outcome);
      data.status = to;
      if (to === "FOUND" && !cur.receivedAt && !data.receivedAt) data.receivedAt = now;
      if (isClosed(to)) {
        data.outcome = outcome;
        closingFields();
        data.closedByUserId = adminUserId;
        if (!isClosed(cur.status)) data.resolvedAt = now;
      } else if (isClosed(cur.status)) {
        // Reopened: the result no longer applies
        data.outcome = null;
        data.outcomeAt = null;
        data.outcomeDetails = null;
        data.representativeName = null;
        data.closedByUserId = null;
        data.resolvedAt = null;
      }
      // Dated when it happened: the result date when closing, the received date when found
      const happened = isClosed(to) ? data.outcomeAt : to === "FOUND" && input.details?.receivedAt ? data.receivedAt : null;
      entries.push({
        at: happened instanceof Date ? happened : now,
        note: `Status: ${STATUS_LABELS[cur.status as LpStatus]} → ${STATUS_LABELS[to]}${outcome ? ` (${OUTCOME_LABELS[outcome]})` : ""}`,
        shownToPassenger: false,
      });
    } else if (isClosed(cur.status) && input.outcome !== undefined) {
      // Correcting the result of a closed item
      data.outcome = checkStatusChange(cur.status, input.outcome);
      closingFields();
    }

    if (note) {
      const at = timeField(input.noteAt, "Date of the note", now) ?? now;
      entries.push({ at, note, shownToPassenger: !!input.showToPassenger });
      if (input.showToPassenger) data.adminNotes = note;
    }

    const updated = await tx.lostProperty.update({ where: { id }, data });
    for (const e of entries)
      await tx.lostPropertyContact.create({
        data: { lostPropertyId: id, at: e.at, note: e.note, shownToPassenger: e.shownToPassenger, staffName: admin, staffUserId: adminUserId },
      });
    return { from: cur.status, to: updated.status, refNo: updated.refNo };
  });

  const full = await loadItem(prisma, id);
  const msg = pushFor(result.from, result.to, result.refNo);
  if (msg) await sendPush(deps, full.passenger?.userId, msg, pushData(full));
  return full;
}

// ─── Staff: permanent delete ─────────────────────────────────────────────────

export async function deleteItem(deps: LpDeps, id: string, confirmRef: unknown) {
  const { prisma } = deps;
  const now = deps.now ?? new Date();
  const item = await prisma.lostProperty.findUnique({ where: { id } });
  if (!item) throw new LostPropertyError("Lost property item not found", 404);
  if (!isClosed(item.status)) throw new LostPropertyError("Only a closed item can be deleted");
  if (!canDelete(item, now))
    throw new LostPropertyError(`TfL records must be kept for 12 months — this one can be deleted from ${ukDateLabel(deletableFrom(item))}`);
  if (typeof confirmRef !== "string" || confirmRef.trim().toUpperCase() !== item.refNo)
    throw new LostPropertyError(`Type ${item.refNo} to confirm`);
  await prisma.lostProperty.delete({ where: { id } }); // history rows go with it (cascade)
  return { refNo: item.refNo };
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export const ITEM_INCLUDE = {
  booking: { select: { id: true, reference: true, pickupAddress: true, dropoffAddress: true, completedAt: true, driverId: true } },
  passenger: { select: { id: true, userId: true, user: { select: { firstName: true, lastName: true, phone: true } } } },
  contacts: { orderBy: [{ at: "asc" }, { createdAt: "asc" }] },
} satisfies Prisma.LostPropertyInclude;

export type LostPropertyItem = Prisma.LostPropertyGetPayload<{ include: typeof ITEM_INCLUDE }>;

export async function loadItem(prisma: PrismaClient, id: string): Promise<LostPropertyItem> {
  const item = await prisma.lostProperty.findUnique({ where: { id }, include: ITEM_INCLUDE });
  if (!item) throw new LostPropertyError("Lost property item not found", 404);
  return item;
}

/** What the passenger app gets about its own reports (status, "Update: …" note) — nothing internal. */
export const PASSENGER_LOST_PROPERTY_SELECT = {
  id: true,
  refNo: true,
  bookingId: true,
  passengerId: true,
  description: true,
  contactPhone: true,
  status: true,
  adminNotes: true,
  reportedAt: true,
  resolvedAt: true,
} satisfies Prisma.LostPropertySelect;

export function passengerLostProperty(r: Prisma.LostPropertyGetPayload<{ select: typeof PASSENGER_LOST_PROPERTY_SELECT }>) {
  const { id, refNo, bookingId, passengerId, description, contactPhone, status, adminNotes, reportedAt, resolvedAt } = r;
  return { id, refNo, bookingId, passengerId, description, contactPhone, status, adminNotes, reportedAt, resolvedAt };
}

const pushData = (item: { id: string; bookingId: string | null; refNo: string; status: string }) => ({
  type: "LOST_PROPERTY",
  lostPropertyId: item.id,
  bookingId: item.bookingId,
  refNo: item.refNo,
  status: item.status,
});

export type { LpOutcome };
