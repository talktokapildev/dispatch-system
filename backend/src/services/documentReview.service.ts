// backend/src/services/documentReview.service.ts
//
// Adding a document version (driver app or admin) and reviewing it (admin).
// - Every upload is a NEW version (PENDING). The approved version in force is not touched, so a
//   renewal uploaded before expiry never stops the driver working.
// - A newer upload of the same type replaces an older one still waiting for review.
// - Approving needs an expiry date for PCO badge, PHV vehicle licence, insurance and MOT. It marks
//   the previous version replaced (kept for TfL history) and copies the date to the Driver /
//   Vehicle record, so the Vehicles page, compliance page and TfL records match what dispatch checks.
// - Rejecting needs a reason; the driver sees it in the app.
import { PrismaClient, Prisma, DocumentType } from "@prisma/client";
import { NotificationService } from "./notification.service";
import {
  DOC_LABELS,
  DocType,
  EXPIRY_REQUIRED,
  daysUntil,
  isVehicleType,
  ukDateLabel,
} from "./documentRules";

type Db = PrismaClient | Prisma.TransactionClient;

export class DocumentError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

/** Who owns a new upload: driver documents → the driver; vehicle documents → a vehicle. */
export async function resolveOwner(
  db: Db,
  type: DocType,
  opts: { driverId?: string | null; vehicleId?: string | null }
): Promise<{ driverId: string | null; vehicleId: string | null }> {
  if (isVehicleType(type)) {
    let vehicleId = opts.vehicleId ?? null;
    if (!vehicleId && opts.driverId) {
      const v = await db.vehicle.findUnique({
        where: { driverId: opts.driverId },
        select: { id: true },
      });
      vehicleId = v?.id ?? null;
    }
    if (!vehicleId)
      throw new DocumentError(
        "No vehicle is assigned, so vehicle documents can't be added yet. Please contact OrangeRide.",
        409
      );
    const vehicle = await db.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true } });
    if (!vehicle) throw new DocumentError("Vehicle not found", 404);
    return { driverId: opts.driverId ?? null, vehicleId };
  }
  if (!opts.driverId) throw new DocumentError("This document belongs to a driver: choose the driver.");
  return { driverId: opts.driverId, vehicleId: null };
}

/** Add a new version, waiting for review. Older uploads still waiting are replaced by it. */
export async function addDocumentVersion(
  db: Db,
  input: {
    type: DocType;
    files: string[];
    driverId?: string | null;
    vehicleId?: string | null;
    expiryDate?: Date | null;
    uploadedBy: string;
  }
) {
  if (!input.files.length) throw new DocumentError("A document file is required");
  const owner = await resolveOwner(db, input.type, input);
  const doc = await db.driverDocument.create({
    data: {
      type: input.type as DocumentType,
      status: "PENDING",
      fileUrl: input.files[0],
      pageUrls: input.files.slice(1),
      expiryDate: input.expiryDate ?? null,
      uploadedBy: input.uploadedBy,
      driverId: owner.driverId,
      vehicleId: owner.vehicleId,
    },
  });
  await db.driverDocument.updateMany({
    where: {
      id: { not: doc.id },
      type: input.type as DocumentType,
      status: "PENDING",
      replacedAt: null,
      archivedAt: null,
      ...(owner.vehicleId
        ? { vehicleId: owner.vehicleId }
        : { driverId: owner.driverId, vehicleId: null }),
    },
    data: { replacedAt: new Date(), replacedById: doc.id },
  });
  return doc;
}

export type ReviewInput = {
  docId: string;
  decision: "approve" | "reject";
  expiryDate?: Date | null;
  rejectionReason?: string | null;
  notes?: string | null;
  adminUserId: string;
};

/**
 * Approve or reject a version. Also used to correct the expiry date of the approved version in
 * force (approve again with a new date). Runs in a transaction; push to the driver afterwards
 * with notifyReview().
 */
export async function reviewDocument(prisma: PrismaClient, input: ReviewInput) {
  return prisma.$transaction(async (tx) => {
    const doc = await tx.driverDocument.findUnique({ where: { id: input.docId } });
    if (!doc || doc.archivedAt) throw new DocumentError("Document not found", 404);
    if (doc.replacedAt)
      throw new DocumentError("A newer version of this document exists. Review that one instead.", 409);
    const type = doc.type as DocType;
    const now = new Date();

    if (input.decision === "reject") {
      const reason = input.rejectionReason?.trim();
      if (!reason) throw new DocumentError("Give the driver a reason for the rejection.");
      if (doc.status === "APPROVED")
        throw new DocumentError(
          "This version is already approved. Upload or wait for a new one instead of rejecting it.",
          409
        );
      return tx.driverDocument.update({
        where: { id: doc.id },
        data: {
          status: "REJECTED",
          rejectionReason: reason.slice(0, 300),
          notes: input.notes ?? doc.notes,
          reviewedAt: now,
          reviewedBy: input.adminUserId,
        },
      });
    }

    // ── approve ──
    if (doc.status === "REJECTED")
      throw new DocumentError("This version was rejected. Ask the driver to upload it again.", 409);
    const expiryDate = input.expiryDate ?? doc.expiryDate ?? null;
    if (EXPIRY_REQUIRED.has(type) && !expiryDate)
      throw new DocumentError(`Enter the expiry date shown on the ${DOC_LABELS[type].toLowerCase()}.`);
    if (expiryDate && daysUntil(expiryDate, now) < 0)
      throw new DocumentError(
        `That date (${ukDateLabel(expiryDate)}) has passed, so this document is expired. Reject it and ask for the current one.`
      );

    const ownerWhere = doc.vehicleId
      ? { vehicleId: doc.vehicleId }
      : { driverId: doc.driverId, vehicleId: null };

    // Older versions (approved, or uploads still waiting) are replaced by this one.
    await tx.driverDocument.updateMany({
      where: {
        ...ownerWhere,
        id: { not: doc.id },
        type: doc.type,
        replacedAt: null,
        archivedAt: null,
        OR: [{ status: "APPROVED" }, { createdAt: { lt: doc.createdAt } }],
      },
      data: { replacedAt: now, replacedById: doc.id },
    });

    const sameDate =
      doc.status === "APPROVED" &&
      (doc.expiryDate?.getTime() ?? null) === (expiryDate?.getTime() ?? null);
    const updated = await tx.driverDocument.update({
      where: { id: doc.id },
      data: {
        status: "APPROVED",
        expiryDate,
        expiryGraceUntil: null,
        rejectionReason: null,
        notes: input.notes ?? doc.notes,
        reviewedAt: now,
        reviewedBy: input.adminUserId,
        // New date → reminders start again
        ...(!sameDate && { lastReminderDays: null, expiredNotifiedAt: null }),
      },
    });

    await syncRecordDates(tx, updated.type as DocType, {
      driverId: updated.driverId,
      vehicleId: updated.vehicleId,
      expiryDate,
    });
    return updated;
  });
}

/** Keep the Driver / Vehicle expiry fields in step with the approved document. */
async function syncRecordDates(
  tx: Db,
  type: DocType,
  { driverId, vehicleId, expiryDate }: { driverId: string | null; vehicleId: string | null; expiryDate: Date | null }
) {
  if (!expiryDate) return;
  if (type === "PCO_LICENSE" && driverId)
    await tx.driver.update({ where: { id: driverId }, data: { pcoLicenseExpiry: expiryDate } });
  if (!vehicleId) return;
  const field =
    type === "PHV_LICENCE"
      ? "phvLicenceExpiry"
      : type === "VEHICLE_INSURANCE"
      ? "insuranceExpiry"
      : type === "MOT_CERTIFICATE"
      ? "motExpiry"
      : null;
  if (field) await tx.vehicle.update({ where: { id: vehicleId }, data: { [field]: expiryDate } });
}

/** userId of the driver who should hear about this document (owner, or the car's current driver). */
export async function documentDriverUserId(
  db: Db,
  doc: { driverId: string | null; vehicleId: string | null }
): Promise<string | null> {
  if (doc.vehicleId) {
    const v = await db.vehicle.findUnique({
      where: { id: doc.vehicleId },
      select: { driver: { select: { userId: true } } },
    });
    return v?.driver?.userId ?? null;
  }
  if (!doc.driverId) return null;
  const d = await db.driver.findUnique({ where: { id: doc.driverId }, select: { userId: true } });
  return d?.userId ?? null;
}

/** Push the review result to the driver (best effort). */
export async function notifyReview(
  prisma: PrismaClient,
  doc: {
    id: string;
    type: string;
    status: string;
    driverId: string | null;
    vehicleId: string | null;
    expiryDate: Date | null;
    rejectionReason: string | null;
  }
) {
  try {
    const userId = await documentDriverUserId(prisma, doc);
    if (!userId) return;
    const label = DOC_LABELS[doc.type as DocType] ?? doc.type;
    const approved = doc.status === "APPROVED";
    await new NotificationService(prisma).sendToUser(
      userId,
      approved
        ? {
            title: `${label} approved`,
            body: doc.expiryDate
              ? `Valid until ${ukDateLabel(doc.expiryDate)}.`
              : "Thanks - it's on file.",
            data: { type: "DOCUMENT_APPROVED", docType: doc.type, documentId: doc.id },
          }
        : {
            title: `${label} rejected`,
            body: `${doc.rejectionReason ?? "Please upload it again."} Tap to upload a new copy.`,
            data: { type: "DOCUMENT_REJECTED", docType: doc.type, documentId: doc.id },
          },
      "driver"
    );
  } catch (err) {
    console.error("[Documents] review push failed", err);
  }
}
