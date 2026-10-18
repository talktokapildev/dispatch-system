// backend/src/services/driverRegister.service.ts
//
// TfL driver register: register details (DriverRegister), periods of work (DriverEngagement),
// archive when a driver leaves, restore when they restart, and permanent deletion once the
// 12-month retention period after leaving has passed.
import { BookingStatus, Prisma, PrismaClient } from "@prisma/client";
import type Redis from "ioredis";
import { RedisKeys } from "../plugins/redis";
import { SocketEvent } from "../types";
import { opsAlert } from "./documentWatch.service";
import { deleteStoredFile } from "./fileStorage";
import { APP_DOC_MULTI, APP_DOC_SINGLE } from "./applicationDocs";
import {
  RegisterError,
  TFL_DISMISSAL_NOTICE_DAYS,
  addDays,
  dayLabel,
  deletableFrom,
  parseDay,
  parseRegisterInput,
  registerDates,
  sortEngagements,
  ukToday,
  validateEngagements,
  type RegisterInput,
} from "./driverRegisterRules";

type Tx = Prisma.TransactionClient;
type Log = { warn: (msg: string) => void; error?: (...a: any[]) => void };
type Emitter = {
  to: (room: string) => { emit: (ev: string, data: unknown) => void };
  in?: (room: string) => { disconnectSockets: (close?: boolean) => void };
};
export type RegisterDeps = { prisma: PrismaClient; redis?: Redis; io?: Emitter; log: Log; now?: Date };

/** Archived-driver token block lasts longer than any app token (JWT_EXPIRES_IN, 7 days default). */
const ARCHIVED_FLAG_TTL_SEC = 60 * 86_400;
const ACTIVE_TRIP: BookingStatus[] = ["DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "IN_PROGRESS"];

const fullName = (u: { firstName: string; lastName: string | null }, middle?: string | null) =>
  [u.firstName, middle, u.lastName].filter(Boolean).join(" ").trim();

/** Open a new period of work (new driver, or when the driver restarts). */
export async function startEngagement(tx: Tx, driverId: string, startedAt: Date, by?: string | null, notes?: string | null) {
  return tx.driverEngagement.create({
    data: { driverId, startedAt, startedBy: by ?? null, notes: notes ?? null },
  });
}

// ─── Register details ────────────────────────────────────────────────────────

export async function saveRegister(
  prisma: PrismaClient,
  driverId: string,
  input: RegisterInput,
  adminUserId: string,
  now = new Date()
) {
  const data = parseRegisterInput(input, now);
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { id: true } });
  if (!driver) throw new RegisterError("Driver not found", 404);
  if (data.callSign) {
    const clash = await prisma.driverRegister.findFirst({
      where: { callSign: data.callSign, driverId: { not: driverId } },
      select: { driver: { select: { user: { select: { firstName: true, lastName: true } } } } },
    });
    if (clash)
      throw new RegisterError(`Call sign ${data.callSign} is already used by ${fullName(clash.driver.user)}`, 409);
  }
  return prisma.driverRegister.upsert({
    where: { driverId },
    create: { driverId, ...data, updatedBy: adminUserId },
    update: { ...data, updatedBy: adminUserId },
  });
}

// ─── Leaving ─────────────────────────────────────────────────────────────────

export type ArchiveInput = {
  driverId: string;
  leftOn: string; // YYYY-MM-DD
  reason: string;
  dismissedForConduct?: boolean;
  notes?: string | null;
  adminUserId: string;
};

/**
 * The driver leaves: closes their current period, archives them, takes them offline, puts their
 * accepted pre-booked jobs back on the job board, unassigns their car and signs them out.
 * Refused while they are on a trip or have an accepted ASAP job.
 */
export async function archiveDriver(deps: RegisterDeps, input: ArchiveInput) {
  const { prisma, log } = deps;
  const now = deps.now ?? new Date();
  const leftOn = parseDay(input.leftOn);
  if (!leftOn) throw new RegisterError("Choose the date the driver left");
  if (leftOn > ukToday(now)) throw new RegisterError("The leaving date can't be in the future");
  const reason = input.reason?.trim();
  if (!reason) throw new RegisterError("Give a reason for leaving");

  const driver = await prisma.driver.findUnique({
    where: { id: input.driverId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      engagements: true,
      register: { select: { middleNames: true } },
    },
  });
  if (!driver) throw new RegisterError("Driver not found", 404);
  if (driver.archivedAt) throw new RegisterError("This driver has already left", 409);

  const busy = await prisma.booking.findMany({
    where: {
      driverId: driver.id,
      OR: [{ status: { in: ACTIVE_TRIP } }, { status: "DRIVER_ASSIGNED", scheduledAt: null }],
    },
    select: { reference: true },
  });
  if (busy.length)
    throw new RegisterError(
      `Finish or reassign ${busy.map((b) => b.reference).join(", ")} first: the driver is on a trip or has an accepted ASAP job`,
      409
    );

  const open = sortEngagements(driver.engagements).filter((e) => !e.endedAt);
  const current = open[open.length - 1];
  if (current && leftOn < current.startedAt)
    throw new RegisterError(`The leaving date is before they started (${dayLabel(current.startedAt)})`);

  const jobs = await prisma.booking.findMany({
    where: { driverId: driver.id, status: "DRIVER_ASSIGNED", scheduledAt: { not: null } },
    select: { id: true, reference: true },
  });
  const name = fullName(driver.user, driver.register?.middleNames);

  await prisma.$transaction(async (tx) => {
    await tx.driver.update({
      where: { id: driver.id },
      data: { archivedAt: now, archivedBy: input.adminUserId, status: "OFFLINE" },
    });
    const closing = {
      endedAt: leftOn,
      endReason: reason.slice(0, 300),
      dismissedForConduct: !!input.dismissedForConduct,
      endedBy: input.adminUserId,
      ...(input.notes?.trim() ? { notes: input.notes.trim().slice(0, 500) } : {}),
    };
    if (current) {
      await tx.driverEngagement.update({ where: { id: current.id }, data: closing });
    } else {
      // No open period on record (shouldn't happen after the backfill): record one ending today
      const start = driver.engagements.length ? leftOn : parseDay(driver.createdAt.toISOString().slice(0, 10))!;
      await tx.driverEngagement.create({ data: { driverId: driver.id, startedAt: start, ...closing } });
    }
    for (const b of jobs) {
      const res = await tx.booking.updateMany({
        where: { id: b.id, status: "DRIVER_ASSIGNED", driverId: driver.id },
        data: {
          driverId: null,
          status: "SCHEDULED_OPEN",
          claimedAt: null,
          dispatchedAt: null,
          dispatchedBy: null,
          driverPhvLicenceNumber: null,
          vehicleId: null,
        },
      });
      if (res.count)
        await tx.bookingStatusHistory.create({
          data: { bookingId: b.id, status: "SCHEDULED_OPEN", note: `Unassigned: driver ${name} left`.slice(0, 250) },
        });
    }
    await tx.vehicle.updateMany({ where: { driverId: driver.id }, data: { driverId: null } });
    await tx.refreshToken.deleteMany({ where: { userId: driver.user.id } });
    await tx.pushToken.deleteMany({ where: { userId: driver.user.id, OR: [{ app: "driver" }, { app: null }] } });
  });

  // Outside the transaction: live state
  if (deps.redis) {
    await deps.redis.srem(RedisKeys.onlineDrivers(), driver.id).catch(() => 0);
    await deps.redis.set(RedisKeys.archivedDriver(driver.user.id), "1", "EX", ARCHIVED_FLAG_TTL_SEC).catch(() => null);
  }
  for (const b of jobs)
    deps.io?.to("admin").emit(SocketEvent.ADMIN_BOOKING_UPDATED, {
      bookingId: b.id,
      status: "SCHEDULED_OPEN",
      source: "driver_left",
      adminAlertRequired: true,
    });
  deps.io?.to("admin").emit(SocketEvent.ADMIN_DRIVER_UPDATE, { driverId: driver.id, status: "OFFLINE" });
  deps.io?.in?.(`driver:${driver.user.id}`).disconnectSockets(true);

  if (input.dismissedForConduct) {
    const by = addDays(leftOn, TFL_DISMISSAL_NOTICE_DAYS);
    await opsAlert(
      log,
      `OrangeRide ops: ${name} dismissed for conduct (left ${dayLabel(leftOn)}). Notify TfL by ${dayLabel(by)}.`
    );
  }
  log.warn(`[DriverRegister] ${driver.id} archived: left ${dayLabel(leftOn)}, ${jobs.length} job(s) back on the board`);
  return { unassigned: jobs.map((j) => j.reference) };
}

// ─── Restarting ──────────────────────────────────────────────────────────────

export async function restoreDriver(
  deps: RegisterDeps,
  input: { driverId: string; restartOn: string; notes?: string | null; adminUserId: string }
) {
  const { prisma } = deps;
  const now = deps.now ?? new Date();
  const restartOn = parseDay(input.restartOn);
  if (!restartOn) throw new RegisterError("Choose the restart date");
  if (restartOn > ukToday(now)) throw new RegisterError("The restart date can't be in the future");

  const driver = await prisma.driver.findUnique({
    where: { id: input.driverId },
    include: { engagements: true, user: { select: { id: true } } },
  });
  if (!driver) throw new RegisterError("Driver not found", 404);
  if (!driver.archivedAt) throw new RegisterError("This driver is active", 409);

  const rows = [
    ...driver.engagements,
    { id: "~new", startedAt: restartOn, endedAt: null as Date | null },
  ];
  validateEngagements(rows, now);

  await prisma.$transaction(async (tx) => {
    await tx.driver.update({ where: { id: driver.id }, data: { archivedAt: null, archivedBy: null, status: "OFFLINE" } });
    await startEngagement(tx, driver.id, restartOn, input.adminUserId, input.notes?.trim() || null);
    // Driver documents archived by an older "delete application" come back (vehicle docs stay with cars)
    await tx.driverDocument.updateMany({
      where: { driverId: driver.id, vehicleId: null, archivedAt: { not: null }, replacedAt: null },
      data: { archivedAt: null },
    });
  });
  await deps.redis?.del(RedisKeys.archivedDriver(driver.user.id)).catch(() => 0);
  deps.log.warn(`[DriverRegister] ${driver.id} restored: restart ${dayLabel(restartOn)}`);
}

// ─── Correcting a period ─────────────────────────────────────────────────────

export async function updateEngagement(
  prisma: PrismaClient,
  input: {
    driverId: string;
    engagementId: string;
    startedAt?: string;
    endedAt?: string | null;
    endReason?: string | null;
    dismissedForConduct?: boolean;
    notes?: string | null;
  },
  now = new Date()
) {
  const driver = await prisma.driver.findUnique({
    where: { id: input.driverId },
    select: { id: true, archivedAt: true, engagements: true },
  });
  if (!driver) throw new RegisterError("Driver not found", 404);
  const row = driver.engagements.find((e) => e.id === input.engagementId);
  if (!row) throw new RegisterError("Period not found", 404);

  const patch: Prisma.DriverEngagementUpdateInput = {};
  let startedAt = row.startedAt;
  let endedAt = row.endedAt;
  if (input.startedAt !== undefined) {
    const d = parseDay(input.startedAt);
    if (!d) throw new RegisterError("Start date: use a valid date");
    startedAt = patch.startedAt = d;
  }
  if (input.endedAt !== undefined) {
    if (input.endedAt === null || input.endedAt === "") {
      endedAt = patch.endedAt = null;
    } else {
      const d = parseDay(input.endedAt);
      if (!d) throw new RegisterError("Finish date: use a valid date");
      endedAt = patch.endedAt = d;
    }
  }
  if (input.endReason !== undefined) patch.endReason = input.endReason?.trim().slice(0, 300) || null;
  if (input.dismissedForConduct !== undefined) patch.dismissedForConduct = !!input.dismissedForConduct;
  if (input.notes !== undefined) patch.notes = input.notes?.trim().slice(0, 500) || null;

  const rows = driver.engagements.map((e) => (e.id === row.id ? { ...e, startedAt, endedAt } : e));
  validateEngagements(rows, now);
  const open = rows.some((r) => !r.endedAt);
  if (driver.archivedAt && open)
    throw new RegisterError("This driver has left: every period needs a finish date (use Restore to restart them)");
  if (!driver.archivedAt && !open)
    throw new RegisterError("This driver is active: their latest period can't have a finish date (use Archive)");

  return prisma.driverEngagement.update({ where: { id: row.id }, data: patch });
}

// ─── Permanent deletion ──────────────────────────────────────────────────────

export function deletionStatus(
  driver: { archivedAt: Date | null; engagements: { id: string; startedAt: Date; endedAt: Date | null }[] },
  now = new Date()
) {
  const from = driver.archivedAt ? deletableFrom(driver.engagements) : null;
  return { deletableFrom: from, canDelete: !!from && from <= ukToday(now) };
}

/**
 * Delete everything about a driver once the retention period has passed: driver, register,
 * periods, earnings, breaks, Tesla link, their own documents and applications (with the files in
 * Cloudinary) and their profile photo. Bookings stay, keeping the PHV licence number.
 * The car stays on the fleet (its documents stay with it).
 */
export async function hardDeleteDriver(
  deps: RegisterDeps,
  input: { driverId: string; confirmName: string }
): Promise<{ filesDeleted: number; filesFailed: number }> {
  const { prisma, log } = deps;
  const now = deps.now ?? new Date();
  const driver = await prisma.driver.findUnique({
    where: { id: input.driverId },
    include: {
      user: true,
      engagements: true,
      documents: { where: { vehicleId: null }, select: { fileUrl: true, pageUrls: true } },
    },
  });
  if (!driver) throw new RegisterError("Driver not found", 404);
  if (!driver.archivedAt)
    throw new RegisterError("Archive the driver first (with their leaving date). Records are kept for 12 months after they leave.", 409);
  const st = deletionStatus(driver, now);
  if (!st.canDelete)
    throw new RegisterError(
      `TfL requires driver records to be kept for 12 months after leaving. This record can be deleted from ${
        st.deletableFrom ? dayLabel(st.deletableFrom) : "12 months after the leaving date"
      }.`,
      409
    );
  const expected = `${driver.user.firstName} ${driver.user.lastName ?? ""}`.trim().toLowerCase();
  if ((input.confirmName ?? "").trim().toLowerCase().replace(/\s+/g, " ") !== expected)
    throw new RegisterError(`Type the driver's name exactly to confirm: "${driver.user.firstName} ${driver.user.lastName ?? ""}".`);

  const applications = await prisma.driverApplication.findMany({ where: { phone: driver.user.phone } });
  const files = new Set<string>();
  for (const d of driver.documents) [d.fileUrl, ...d.pageUrls].forEach((f) => f && files.add(f));
  for (const a of applications) {
    for (const f of APP_DOC_SINGLE) if (a[f]) files.add(a[f]!);
    for (const f of APP_DOC_MULTI) a[f].forEach((v) => v && files.add(v));
  }
  if (driver.photoUrl) files.add(driver.photoUrl);

  const driverId = driver.id;
  await prisma.$transaction(async (tx) => {
    await tx.booking.updateMany({ where: { driverId }, data: { driverId: null } });
    await tx.driverEarning.deleteMany({ where: { driverId } });
    await tx.driverBreak.deleteMany({ where: { driverId } });
    // Vehicle documents stay with the car; only the uploader link is cleared
    await tx.driverDocument.updateMany({ where: { driverId, vehicleId: { not: null } }, data: { driverId: null } });
    await tx.driverDocument.deleteMany({ where: { driverId } });
    await tx.teslaIntegration.deleteMany({ where: { driverId } });
    await tx.vehicle.updateMany({ where: { driverId }, data: { driverId: null } });
    await tx.driverApplication.deleteMany({ where: { phone: driver.user.phone } });
    await tx.driver.delete({ where: { id: driverId } }); // register + periods cascade
    await tx.pushToken.deleteMany({ where: { userId: driver.userId, OR: [{ app: "driver" }, { app: null }] } });

    const remainingRoles = driver.user.roles.filter((r) => r !== "DRIVER");
    const passenger = await tx.passenger.findUnique({ where: { userId: driver.userId } });
    if (remainingRoles.length === 0 && !passenger) {
      await tx.pushToken.deleteMany({ where: { userId: driver.userId } });
      await tx.otpCode.deleteMany({ where: { userId: driver.userId } });
      await tx.refreshToken.deleteMany({ where: { userId: driver.userId } });
      await tx.user.delete({ where: { id: driver.userId } });
    } else {
      await tx.user.update({
        where: { id: driver.userId },
        data: { roles: remainingRoles.length ? remainingRoles : (["PASSENGER"] as any) },
      });
    }
  });
  await deps.redis?.del(RedisKeys.archivedDriver(driver.userId)).catch(() => 0);

  let filesDeleted = 0;
  let filesFailed = 0;
  for (const f of files) {
    if (await deleteStoredFile(f)) filesDeleted++;
    else filesFailed++;
  }
  log.warn(`[DriverRegister] ${driverId} permanently deleted; files deleted ${filesDeleted}, not deleted ${filesFailed}`);
  return { filesDeleted, filesFailed };
}

/** Driver ids → deletion date, for lists. */
export async function deletableFromMany(prisma: PrismaClient, driverIds: string[]) {
  const rows = await prisma.driverEngagement.findMany({
    where: { driverId: { in: driverIds } },
    select: { id: true, driverId: true, startedAt: true, endedAt: true },
  });
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.driverId, [...(by.get(r.driverId) ?? []), r]);
  const out = new Map<string, { leftOn: Date | null; deletableFrom: Date | null; firstAvailable: Date | null }>();
  for (const id of driverIds) {
    const list = by.get(id) ?? [];
    const dates = registerDates(list);
    out.set(id, { leftOn: dates.leftOn, deletableFrom: deletableFrom(list), firstAvailable: dates.firstAvailable });
  }
  return out;
}
