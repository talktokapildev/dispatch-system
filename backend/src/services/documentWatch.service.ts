// backend/src/services/documentWatch.service.ts
//
// Background document checks, run in the 5-minute loop (server.ts):
//  1. Reminders: driver push 30, 14, 7 and 1 days before an approved document expires
//     (skipped when a renewal is already waiting for review). On expiry: driver push + ops SMS.
//     Messages wait for 08:00–21:00 UK; blocking (step 2) happens at any hour.
//  2. Drivers whose documents are not in order:
//     - online → set OFFLINE (+ push)
//     - accepted scheduled jobs → unassigned, back on the job board (+ push, ops SMS)
//     In shadow mode (DOCUMENT_GATING_ENABLED unset) both are only logged.
//  3. Accepted jobs within 48 h whose pickup is after a document's expiry → driver push + ops SMS (once).
//  4. New uploads waiting for review → ops SMS (at most every 30 min, only for new ones).
//  5. Daily ops SMS (after 08:00 UK) listing documents that expire within 7 days.
//
// Ops SMS go to ADMIN_ALERT_PHONE (purpose ADMIN_ALERT).
import { PrismaClient, BookingStatus, Prisma } from "@prisma/client";
import Redis from "ioredis";
import { RedisKeys } from "../plugins/redis";
import { SocketEvent } from "../types";
import { NotificationService } from "./notification.service";
import { sendSms } from "./sms.service";
import {
  DOC_LABELS,
  DocType,
  REMINDER_DAYS,
  blockMessage,
  daysUntil,
  inSentence,
  problemSummary,
  ukDateKey,
  ukDateLabel,
} from "./documentRules";
import { gatingEnabled, loadComplianceMany } from "./documentCompliance.service";

type Log = { warn: (msg: string) => void; error?: (...a: any[]) => void };
type Emitter = { to: (room: string) => { emit: (ev: string, data: unknown) => void } };

export type DocumentCycleDeps = {
  prisma: PrismaClient;
  redis: Redis;
  log: Log;
  io?: Emitter;
  now?: Date;
  /** Tests only: limit every step to these drivers (their documents and their cars'). */
  onlyDriverIds?: string[];
};

/** Documents in scope for this run (all, or the test drivers' and their cars'). */
function scopeWhere(deps: DocumentCycleDeps): Prisma.DriverDocumentWhereInput {
  if (!deps.onlyDriverIds) return {};
  return {
    OR: [
      { driverId: { in: deps.onlyDriverIds } },
      { vehicle: { driverId: { in: deps.onlyDriverIds } } },
    ],
  };
}

const DAY = 86_400_000;
const WARN_BEFORE_PICKUP_MS = 48 * 3_600_000;

const ukHour = (d: Date) =>
  Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(d)
  );
const ukShort = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(d)
    .replace(",", "");
const name = (u?: { firstName: string; lastName: string | null } | null) =>
  u ? `${u.firstName} ${u.lastName ?? ""}`.trim() : "unknown driver";

/** Ops SMS to ADMIN_ALERT_PHONE (logged when not set). */
export async function opsAlert(log: Log, text: string) {
  log.warn(`[Documents] ops: ${text}`);
  const to = process.env.ADMIN_ALERT_PHONE?.trim();
  if (!to) return;
  const r = await sendSms(to, text, { purpose: "ADMIN_ALERT" });
  if (!r.ok) log.warn(`[Documents] ops SMS failed: ${r.error}`);
}

/** true the first time for this key within ttl seconds. */
async function once(redis: Redis, key: string, ttlSec: number) {
  return (await redis.set(key, "1", "EX", ttlSec, "NX")) === "OK";
}

export async function runDocumentCycle(deps: DocumentCycleDeps): Promise<void> {
  const { redis } = deps;
  const lock = await redis.set("documents:cycle", "1", "EX", 240, "NX");
  if (!lock) return;
  const now = deps.now ?? new Date();
  const daytime = ukHour(now) >= 8 && ukHour(now) < 21;
  const steps: [string, () => Promise<void>][] = [
    ["reminders", () => remindersAndExpiry(deps, now, daytime)],
    ["drivers", () => enforceDrivers(deps, now)],
    ["pending", () => pendingReviewAlert(deps, now)],
    ["digest", () => (daytime ? dailyDigest(deps, now) : Promise.resolve())],
  ];
  try {
    for (const [stepName, step] of steps) {
      try {
        await step();
      } catch (err) {
        deps.log.warn(`[Documents] cycle step ${stepName} failed: ${(err as Error)?.message ?? err}`);
      }
    }
  } finally {
    await redis.del("documents:cycle");
  }
}

// ── 1. Reminders + expiry notices ────────────────────────────────────────────

const liveActive: Prisma.DriverDocumentWhereInput = {
  archivedAt: null,
  replacedAt: null,
  OR: [
    { vehicleId: null, driver: { archivedAt: null } },
    { vehicleId: { not: null }, vehicle: { archivedAt: null } },
  ],
};

const ownerInclude = {
  driver: { select: { id: true, user: { select: { id: true, firstName: true, lastName: true } } } },
  vehicle: {
    select: {
      id: true,
      licensePlate: true,
      driver: { select: { id: true, user: { select: { id: true, firstName: true, lastName: true } } } },
    },
  },
} satisfies Prisma.DriverDocumentInclude;

async function remindersAndExpiry(deps: DocumentCycleDeps, now: Date, daytime: boolean) {
  const { prisma, log } = deps;
  if (!daytime) return;
  const docs = await prisma.driverDocument.findMany({
    where: {
      AND: [liveActive, scopeWhere(deps), { status: "APPROVED", expiryDate: { not: null, lte: new Date(now.getTime() + 31 * DAY) } }],
    },
    include: ownerInclude,
  });
  if (!docs.length) return;

  // Renewals already uploaded (waiting for review) → no reminder
  const pending = await prisma.driverDocument.findMany({
    where: { AND: [liveActive, scopeWhere(deps), { status: "PENDING" }] },
    select: { type: true, driverId: true, vehicleId: true },
  });
  const ownerKey = (d: { type: string; driverId: string | null; vehicleId: string | null }) =>
    `${d.vehicleId ? `v:${d.vehicleId}` : `d:${d.driverId}`}:${d.type}`;
  const renewing = new Set(pending.map(ownerKey));
  const push = new NotificationService(prisma);

  for (const doc of docs) {
    const daysLeft = daysUntil(doc.expiryDate!, now);
    const label = DOC_LABELS[doc.type as DocType] ?? doc.type;
    const isVehicle = !!doc.vehicleId;
    const driverUser = isVehicle ? doc.vehicle?.driver?.user ?? null : doc.driver?.user ?? null;
    const what = isVehicle ? `${inSentence(label)} (${doc.vehicle?.licensePlate})` : inSentence(label);
    const date = ukDateLabel(doc.expiryDate!);

    if (daysLeft < 0) {
      if (doc.expiredNotifiedAt) continue;
      if (driverUser) {
        await push
          .sendToUser(
            driverUser.id,
            {
              title: `${label} expired`,
              body: renewing.has(ownerKey(doc))
                ? `Your ${what} expired on ${date}. Your new copy is waiting for approval.`
                : `Your ${what} expired on ${date}. You can't take jobs until you upload the new one.`,
              data: { type: "DOCUMENT_EXPIRED", docType: doc.type, documentId: doc.id },
            },
            "driver",
            { timeSensitive: true }
          )
          .catch(() => 0);
      }
      await opsAlert(
        log,
        `OrangeRide ops: ${what} for ${isVehicle && !driverUser ? "unassigned car" : name(driverUser)} expired ${date}.${
          renewing.has(ownerKey(doc)) ? " New copy waiting for review." : " No renewal uploaded."
        }`
      );
      await prisma.driverDocument.update({ where: { id: doc.id }, data: { expiredNotifiedAt: now } });
      continue;
    }

    const threshold = REMINDER_DAYS.filter((d) => daysLeft <= d).sort((a, b) => a - b)[0];
    if (threshold === undefined) continue;
    if (doc.lastReminderDays !== null && doc.lastReminderDays <= threshold) continue;
    if (renewing.has(ownerKey(doc))) continue; // renewal uploaded: keep quiet (resumes if it's rejected)

    if (driverUser) {
      const when = daysLeft === 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`;
      await push
        .sendToUser(
          driverUser.id,
          {
            title: `${label} expires ${when}`,
            body: `Your ${what} expires on ${date}. Upload the renewal in Documents so you can keep taking jobs.`,
            data: { type: "DOCUMENT_EXPIRING", docType: doc.type, documentId: doc.id },
          },
          "driver"
        )
        .catch(() => 0);
    }
    await prisma.driverDocument.update({ where: { id: doc.id }, data: { lastReminderDays: threshold } });
  }
}

// ── 2 + 3. Drivers whose documents are not in order; 48 h warnings ───────────

async function enforceDrivers(deps: DocumentCycleDeps, now: Date) {
  const { prisma, redis, log, io } = deps;
  const drivers = await prisma.driver.findMany({
    where: { archivedAt: null, ...(deps.onlyDriverIds && { id: { in: deps.onlyDriverIds } }) },
    select: { id: true, userId: true, status: true, user: { select: { firstName: true, lastName: true } } },
  });
  if (!drivers.length) return;
  const compliance = await loadComplianceMany(prisma, drivers.map((d) => d.id), now);
  const enforce = gatingEnabled();
  const push = new NotificationService(prisma);

  const assigned = await prisma.booking.findMany({
    where: { driverId: { in: drivers.map((d) => d.id) }, status: BookingStatus.DRIVER_ASSIGNED },
    select: { id: true, reference: true, driverId: true, scheduledAt: true, claimedAt: true },
  });

  for (const d of drivers) {
    const c = compliance.get(d.id);
    if (!c) continue;
    const jobs = assigned.filter((b) => b.driverId === d.id);
    const driverName = name(d.user);

    if (!c.eligible) {
      const message = blockMessage(c);
      const summary = problemSummary(c);

      // Approved without an expiry date and the 7-day grace is over: the admin must add the date
      for (const p of c.problems.filter((x) => x.state === "expiry_needed" && x.current)) {
        if (await once(redis, `documents:alert:expiry_needed:${p.current!.id}`, 7 * 86_400))
          await opsAlert(
            log,
            `OrangeRide ops: ${driverName} ${inSentence(DOC_LABELS[p.type])} has no expiry date - add it in admin Documents.`
          );
      }

      // Online → offline
      if (d.status === "AVAILABLE") {
        if (enforce) {
          await prisma.driver.update({ where: { id: d.id }, data: { status: "OFFLINE" } });
          await redis.srem(RedisKeys.onlineDrivers(), d.id);
          io?.to("admin").emit(SocketEvent.ADMIN_DRIVER_UPDATE, { driverId: d.id, status: "OFFLINE" });
          io?.to(`driver:${d.userId}`).emit("driver:documents_blocked", { message });
          await push
            .sendToUser(
              d.userId,
              { title: "You're offline", body: message, data: { type: "DOCUMENT_BLOCKED" } },
              "driver",
              { timeSensitive: true }
            )
            .catch(() => 0);
          log.warn(`[Documents] Driver ${d.id} set OFFLINE: ${summary}`);
        } else if (await once(redis, `documents:shadow:online:${d.id}`, 3600)) {
          log.warn(`[Documents] SHADOW would set driver ${d.id} (${driverName}) OFFLINE: ${summary}`);
        }
      }

      // Accepted jobs → back to the job board
      for (const b of jobs) {
        if (!enforce) {
          if (await once(redis, `documents:shadow:job:${b.id}`, 3600))
            log.warn(`[Documents] SHADOW would unassign ${b.reference} from ${driverName}: ${summary}`);
          continue;
        }
        if (!b.scheduledAt) {
          // Accepted ASAP job (pickup imminent): leave it, tell ops once
          if (await once(redis, `documents:alert:asap:${b.id}`, 86_400))
            await opsAlert(log, `OrangeRide ops: ${b.reference} driver ${driverName} - documents not in order (${summary}). Check the job.`);
          continue;
        }
        const res = await prisma.booking.updateMany({
          where: { id: b.id, status: BookingStatus.DRIVER_ASSIGNED, driverId: d.id },
          data: {
            driverId: null,
            status: BookingStatus.SCHEDULED_OPEN,
            claimedAt: null,
            dispatchedAt: null,
            dispatchedBy: null,
            driverPhvLicenceNumber: null,
            vehicleId: null,
          },
        });
        if (!res.count) continue;
        await prisma.bookingStatusHistory.create({
          data: {
            bookingId: b.id,
            status: BookingStatus.SCHEDULED_OPEN,
            note: `Unassigned from ${driverName}: documents not in order (${summary})`.slice(0, 250),
          },
        });
        io?.to("admin").emit(SocketEvent.ADMIN_BOOKING_UPDATED, {
          bookingId: b.id,
          status: BookingStatus.SCHEDULED_OPEN,
          source: "documents_unassign",
          adminAlertRequired: true,
        });
        io?.to(`driver:${d.userId}`).emit("driver:job_removed", { bookingId: b.id, reason: "documents" });
        await push
          .sendToUser(
            d.userId,
            {
              title: "Job taken off you",
              body: `${b.reference} (${ukShort(b.scheduledAt)}) is back on the job board. ${message}`,
              data: { type: "DOCUMENT_JOB_REMOVED", bookingId: b.id },
            },
            "driver",
            { timeSensitive: true }
          )
          .catch(() => 0);
        await opsAlert(
          log,
          `OrangeRide ops: ${b.reference} ${ukShort(b.scheduledAt)} unassigned from ${driverName} (${summary}). Back on job board.`
        );
      }
      continue;
    }

    // Compliant now: warn about accepted jobs whose pickup is after a document runs out
    for (const b of jobs) {
      if (!b.scheduledAt || b.scheduledAt <= now || b.scheduledAt.getTime() - now.getTime() > WARN_BEFORE_PICKUP_MS) continue;
      for (const item of c.items) {
        if (!item.expiryDate || daysUntil(item.expiryDate, b.scheduledAt) >= 0) continue;
        if (!(await once(redis, `documents:warn:${b.id}:${item.current?.id ?? item.type}`, 3 * 86_400))) continue;
        const what =
          item.owner === "vehicle" && c.vehicle
            ? `${inSentence(DOC_LABELS[item.type])} (${c.vehicle.licensePlate})`
            : inSentence(DOC_LABELS[item.type]);
        const date = ukDateLabel(item.expiryDate);
        await push
          .sendToUser(
            d.userId,
            {
              title: `${DOC_LABELS[item.type]} expires before your job`,
              body: `Your ${what} expires on ${date}, before ${b.reference} (${ukShort(b.scheduledAt)}). Upload the renewal or the job will go back to the board.`,
              data: { type: "DOCUMENT_EXPIRING", docType: item.type, bookingId: b.id },
            },
            "driver",
            { timeSensitive: true }
          )
          .catch(() => 0);
        await opsAlert(
          log,
          `OrangeRide ops: ${driverName} ${what} expires ${date}, before ${b.reference} ${ukShort(b.scheduledAt)}.`
        );
      }
    }
  }
}

// ── 4. Uploads waiting for review ────────────────────────────────────────────

async function pendingReviewAlert(deps: DocumentCycleDeps, now: Date) {
  const { prisma, redis, log } = deps;
  if (deps.onlyDriverIds) return; // global alert: not part of scoped test runs
  if ((await redis.exists("documents:pending:cooldown")) === 1) return;
  const lastRaw = await redis.get("documents:pending:lastAlertAt");
  // First run: only uploads from the last hour (no flood of old ones)
  const since = lastRaw ? new Date(Number(lastRaw)) : new Date(now.getTime() - 3_600_000);
  const fresh = await prisma.driverDocument.findMany({
    where: { AND: [liveActive, { status: "PENDING", createdAt: { gt: since } }] },
    include: ownerInclude,
    orderBy: { createdAt: "asc" },
  });
  if (!fresh.length) return;
  const first = fresh[0];
  const who = first.vehicleId
    ? `${first.vehicle?.licensePlate}${first.vehicle?.driver ? ` (${name(first.vehicle.driver.user)})` : ""}`
    : name(first.driver?.user);
  const more = fresh.length > 1 ? ` +${fresh.length - 1} more` : "";
  await opsAlert(
    log,
    `OrangeRide ops: document to review - ${who} ${DOC_LABELS[first.type as DocType] ?? first.type}${more}. admin.orangeride.co.uk/documents`
  );
  await redis.set("documents:pending:lastAlertAt", String(now.getTime()), "EX", 30 * 86_400);
  await redis.set("documents:pending:cooldown", "1", "EX", 30 * 60);
}

// ── 5. Daily digest: expiring within 7 days ──────────────────────────────────

async function dailyDigest(deps: DocumentCycleDeps, now: Date) {
  const { prisma, redis, log } = deps;
  if (deps.onlyDriverIds) return; // global digest: not part of scoped test runs
  const docs = await prisma.driverDocument.findMany({
    where: {
      AND: [liveActive, { status: "APPROVED", expiryDate: { not: null, lte: new Date(now.getTime() + 8 * DAY) } }],
    },
    include: ownerInclude,
    orderBy: { expiryDate: "asc" },
  });
  const soon = docs.filter((d) => {
    const n = daysUntil(d.expiryDate!, now);
    return n >= 0 && n <= 7;
  });
  if (!soon.length) return;
  if (!(await once(redis, `documents:digest:${ukDateKey(now)}`, 2 * 86_400))) return;
  const parts = soon.map((d) => {
    const who = d.vehicleId ? d.vehicle?.licensePlate : name(d.driver?.user);
    const n = daysUntil(d.expiryDate!, now);
    return `${who} ${DOC_LABELS[d.type as DocType] ?? d.type} ${n === 0 ? "today" : `${n}d`}`;
  });
  const shown = parts.slice(0, 3).join("; ");
  await opsAlert(
    log,
    `OrangeRide ops: expiring within 7 days: ${shown}${parts.length > 3 ? ` +${parts.length - 3} more` : ""}`
  );
}
