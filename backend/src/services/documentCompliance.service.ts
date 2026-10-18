// backend/src/services/documentCompliance.service.ts
//
// Loads a driver's documents (and their current car's) and applies documentRules.
// One check, used everywhere a driver could start or take work:
//   auto offers, manual assign, job board (list + claim), start trip / set off, going online,
//   GET /driver/dispatch-eligibility, and the background document cycle.
//
// DOCUMENT_GATING_ENABLED (Railway var):
//   unset → SHADOW: nothing is blocked; what would have been blocked is logged ("[Documents] SHADOW …").
//   "true" → enforced.
import { PrismaClient, Prisma } from "@prisma/client";
import {
  Compliance,
  DocRow,
  blockMessage,
  evaluateCompliance,
  problemSummary,
} from "./documentRules";

type Db = PrismaClient | Prisma.TransactionClient;
type Log = { warn: (msg: string) => void };

export const gatingEnabled = () => process.env.DOCUMENT_GATING_ENABLED === "true";

/** Fields the rules need (plus what the app/admin show). */
export const docRuleSelect = {
  id: true,
  type: true,
  status: true,
  expiryDate: true,
  expiryGraceUntil: true,
  replacedAt: true,
  archivedAt: true,
  createdAt: true,
  reviewedAt: true,
  rejectionReason: true,
  driverId: true,
  vehicleId: true,
  lastReminderDays: true,
  expiredNotifiedAt: true,
} as const;

export type DocRuleRow = DocRow & {
  driverId: string | null;
  vehicleId: string | null;
  lastReminderDays: number | null;
  expiredNotifiedAt: Date | null;
};

const liveDocs = { archivedAt: null, replacedAt: null } as const;

/** Compliance for many drivers at once (dispatch, admin list, background cycle). */
export async function loadComplianceMany(
  db: Db,
  driverIds: string[],
  now = new Date()
): Promise<Map<string, Compliance<DocRuleRow>>> {
  const out = new Map<string, Compliance<DocRuleRow>>();
  if (!driverIds.length) return out;
  const drivers = await db.driver.findMany({
    where: { id: { in: driverIds } },
    select: {
      id: true,
      vehicle: { select: { id: true, licensePlate: true, archivedAt: true } },
    },
  });
  const vehicleIds = drivers
    .map((d) => (d.vehicle && !d.vehicle.archivedAt ? d.vehicle.id : null))
    .filter((v): v is string => !!v);
  const docs = (await db.driverDocument.findMany({
    where: {
      ...liveDocs,
      OR: [
        { driverId: { in: driverIds }, vehicleId: null },
        ...(vehicleIds.length ? [{ vehicleId: { in: vehicleIds } }] : []),
      ],
    },
    select: docRuleSelect,
  })) as DocRuleRow[];

  for (const d of drivers) {
    const vehicle = d.vehicle && !d.vehicle.archivedAt ? d.vehicle : null;
    out.set(
      d.id,
      evaluateCompliance({
        driverDocs: docs.filter((x) => x.driverId === d.id && !x.vehicleId),
        vehicle: vehicle ? { id: vehicle.id, licensePlate: vehicle.licensePlate } : null,
        vehicleDocs: vehicle ? docs.filter((x) => x.vehicleId === vehicle.id) : [],
        now,
      })
    );
  }
  return out;
}

export async function loadCompliance(db: Db, driverId: string, now = new Date()) {
  const map = await loadComplianceMany(db, [driverId], now);
  return map.get(driverId) ?? null;
}

// Shadow-mode log lines repeat on every job-board refresh; keep one per driver+action per 10 min.
const shadowLogged = new Map<string, number>();
export function shadowLogOnce(key: string): boolean {
  const now = Date.now();
  const last = shadowLogged.get(key) ?? 0;
  if (now - last < 10 * 60_000) return false;
  shadowLogged.set(key, now);
  if (shadowLogged.size > 500) shadowLogged.clear();
  return true;
}

export type WorkCheck = {
  /** May go ahead (always true in shadow mode). */
  ok: boolean;
  /** Documents are actually in order. */
  compliant: boolean;
  message: string;
  compliance: Compliance<DocRuleRow> | null;
};

/**
 * Can this driver take / start work? `action` is only for the log line.
 * In shadow mode a non-compliant driver is allowed, and the would-be block is logged.
 */
export async function checkDriverCanWork(
  db: Db,
  driverId: string,
  action: string,
  log?: Log
): Promise<WorkCheck> {
  const compliance = await loadCompliance(db, driverId);
  if (!compliance) return { ok: false, compliant: false, message: "Driver not found", compliance };
  if (compliance.eligible) return { ok: true, compliant: true, message: "", compliance };
  const message = blockMessage(compliance);
  if (!gatingEnabled()) {
    if (shadowLogOnce(`${driverId}:${action}`))
      (log ?? console).warn(
        `[Documents] SHADOW would block ${action} for driver ${driverId}: ${problemSummary(compliance)}`
      );
    return { ok: true, compliant: false, message, compliance };
  }
  (log ?? console).warn(
    `[Documents] Blocked ${action} for driver ${driverId}: ${problemSummary(compliance)}`
  );
  return { ok: false, compliant: false, message, compliance };
}

/** Error thrown by services when documents stop an action (routes map it to 403). */
export class DocumentsBlockedError extends Error {
  readonly code = "documents";
  constructor(message: string) {
    super(message);
  }
}
