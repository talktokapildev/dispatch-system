// backend/src/routes/admin/documents.ts
//
// Admin: driver & vehicle documents.
// GET  /admin/documents?view=pending|expiring|expired|expiry_needed|rejected|current[&days=30]
//                       [&driverId=…|&vehicleId=…]       list (owner: driver, or car + its driver)
// GET  /admin/documents/counts                             tab badges
// GET  /admin/drivers/documents/expiring?days=60           approved docs expiring/expired (Drivers page alert)
// GET  /admin/documents/panel?driverId=…|vehicleId=…       per-type status, versions in force, history
// POST /admin/documents                                    upload for a driver/car (multipart: type,
//                                                          driverId|vehicleId, expiryDate, approve, notes, files)
// POST /admin/documents/:id/review {decision, expiryDate, rejectionReason, notes}
import { FastifyInstance, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  DOC_LABELS,
  DRIVER_REQUIRED,
  DocType,
  EXPIRY_REQUIRED,
  MULTI_PAGE,
  VEHICLE_REQUIRED,
  daysUntil,
  isDocType,
  isVehicleType,
  parseExpiryDate,
  typeStatus,
  blockMessage,
} from "../../services/documentRules";
import {
  gatingEnabled,
  loadComplianceMany,
  type DocRuleRow,
} from "../../services/documentCompliance.service";
import {
  DocumentError,
  addDocumentVersion,
  notifyReview,
  reviewDocument,
} from "../../services/documentReview.service";
import { readDocumentUpload } from "../../services/documentUpload";
import { fileLinker } from "../../services/fileLinks";

type Files = ReturnType<typeof fileLinker>;

const userSelect = { select: { id: true, firstName: true, lastName: true, phone: true } } as const;
const listInclude = {
  driver: {
    select: { id: true, pcoBadgeNumber: true, archivedAt: true, user: userSelect },
  },
  vehicle: {
    select: {
      id: true,
      licensePlate: true,
      make: true,
      model: true,
      archivedAt: true,
      driver: { select: { id: true, user: userSelect } },
    },
  },
} satisfies Prisma.DriverDocumentInclude;

type ListRow = Prisma.DriverDocumentGetPayload<{ include: typeof listInclude }>;

const fullName = (u?: { firstName: string; lastName: string | null } | null) =>
  u ? `${u.firstName} ${u.lastName ?? ""}`.trim() : null;

/** Admin row: the document plus who it belongs to and how long it has left.
 *  File references are replaced by short-lived links (fileUrl, pageUrls, pages). */
function present(doc: ListRow, now: Date, files: Files) {
  const isVehicle = !!doc.vehicleId;
  const ownerDriver = isVehicle ? doc.vehicle?.driver ?? null : doc.driver;
  return {
    ...files.doc(doc),
    label: DOC_LABELS[doc.type as DocType] ?? doc.type,
    expiryRequired: EXPIRY_REQUIRED.has(doc.type as DocType),
    multiPage: MULTI_PAGE.has(doc.type as DocType),
    daysLeft: doc.expiryDate ? daysUntil(doc.expiryDate, now) : null,
    owner: {
      kind: isVehicle ? "vehicle" : "driver",
      driverId: ownerDriver?.id ?? null,
      driverName: fullName(ownerDriver?.user),
      vehicleId: doc.vehicle?.id ?? null,
      licensePlate: doc.vehicle?.licensePlate ?? null,
      label: isVehicle
        ? `${doc.vehicle?.licensePlate ?? "Vehicle"}${ownerDriver ? ` · ${fullName(ownerDriver.user)}` : " · unassigned"}`
        : fullName(doc.driver?.user) ?? "Driver",
    },
  };
}

/** Live documents of active drivers and fleet vehicles. */
const activeOwners: Prisma.DriverDocumentWhereInput = {
  archivedAt: null,
  replacedAt: null,
  OR: [
    { vehicleId: null, driver: { archivedAt: null } },
    { vehicleId: { not: null }, vehicle: { archivedAt: null } },
  ],
};

const reviewSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  expiryDate: z.string().nullable().optional(),
  rejectionReason: z.string().max(300).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function adminDocumentRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticateAdmin] };

  const linksFor = (request: FastifyRequest) =>
    fileLinker(request, { kind: "admin", id: request.user.userId });

  async function list(
    files: Files,
    where: Prisma.DriverDocumentWhereInput,
    orderBy: Prisma.DriverDocumentOrderByWithRelationInput
  ) {
    const now = new Date();
    const rows = await fastify.prisma.driverDocument.findMany({
      where: { AND: [activeOwners, where] },
      include: listInclude,
      orderBy,
    });
    return rows.map((r) => present(r, now, files));
  }

  function viewWhere(view: string, days: number): Prisma.DriverDocumentWhereInput {
    const now = new Date();
    const soon = new Date(now.getTime() + (days + 1) * 86_400_000);
    // "expired" = before today (UK); today still counts as valid. A small slack is fixed by daysLeft below.
    switch (view) {
      case "pending":
        return { status: "PENDING" };
      case "rejected":
        return { status: "REJECTED" };
      case "current":
        return { status: "APPROVED" };
      case "expiring":
        return { status: "APPROVED", expiryDate: { not: null, lte: soon } };
      case "expired":
        return { status: "APPROVED", expiryDate: { not: null, lt: now } };
      case "expiry_needed":
        return {
          status: "APPROVED",
          expiryDate: null,
          type: { in: [...EXPIRY_REQUIRED] as any },
        };
      default:
        return {};
    }
  }

  // ─── List ───
  fastify.get("/admin/documents", auth, async (request, reply) => {
    const q = request.query as Record<string, string>;
    const view = q.view ?? (q.status === "PENDING" ? "pending" : q.status === "APPROVED" ? "current" : q.status === "REJECTED" ? "rejected" : "pending");
    const days = Math.min(Math.max(parseInt(q.days ?? "30") || 30, 1), 365);
    const where: Prisma.DriverDocumentWhereInput = { ...viewWhere(view, days) };
    if (q.vehicleId) where.vehicleId = q.vehicleId;
    if (q.driverId) {
      const v = await fastify.prisma.vehicle.findUnique({ where: { driverId: q.driverId }, select: { id: true } });
      where.OR = [{ driverId: q.driverId, vehicleId: null }, ...(v ? [{ vehicleId: v.id }] : [])];
    }
    let rows = await list(
      linksFor(request),
      where,
      view === "expiring" || view === "expired" ? { expiryDate: "asc" } : { createdAt: "desc" }
    );
    if (view === "expiring") rows = rows.filter((r) => r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= days);
    if (view === "expired") rows = rows.filter((r) => r.daysLeft !== null && r.daysLeft < 0);
    return reply.send({ success: true, data: rows });
  });

  // ─── Tab counts ───
  fastify.get("/admin/documents/counts", auth, async (_request, reply) => {
    const now = new Date();
    const rows = await fastify.prisma.driverDocument.findMany({
      where: { AND: [activeOwners, { status: { in: ["PENDING", "APPROVED"] } }] },
      select: { status: true, type: true, expiryDate: true },
    });
    let pending = 0, expiring = 0, expired = 0, expiryNeeded = 0;
    for (const r of rows) {
      if (r.status === "PENDING") { pending++; continue; }
      if (!r.expiryDate) {
        if (EXPIRY_REQUIRED.has(r.type as DocType)) expiryNeeded++;
        continue;
      }
      const d = daysUntil(r.expiryDate, now);
      if (d < 0) expired++;
      else if (d <= 30) expiring++;
    }
    return reply.send({ success: true, data: { pending, expiring, expired, expiryNeeded } });
  });

  // ─── Approved documents expiring (or expired) — Drivers page alert ───
  fastify.get("/admin/drivers/documents/expiring", auth, async (request, reply) => {
    const { days = "60" } = request.query as Record<string, string>;
    const n = Math.min(Math.max(parseInt(days) || 60, 1), 365);
    const rows = await list(
      linksFor(request),
      { status: "APPROVED", expiryDate: { not: null, lte: new Date(Date.now() + (n + 1) * 86_400_000) } },
      { expiryDate: "asc" }
    );
    return reply.send({ success: true, data: rows.filter((r) => r.daysLeft !== null && r.daysLeft <= n) });
  });

  // ─── Panel: one driver (their documents + current car's) or one vehicle ───
  fastify.get("/admin/documents/panel", auth, async (request, reply) => {
    const { driverId, vehicleId: vehicleIdParam } = request.query as Record<string, string>;
    const now = new Date();
    let vehicleId: string | null = vehicleIdParam ?? null;
    let compliance: any = null;

    if (driverId) {
      const map = await loadComplianceMany(fastify.prisma, [driverId], now);
      const c = map.get(driverId);
      if (!c) return reply.status(404).send({ success: false, error: "Driver not found" });
      vehicleId = c.vehicle?.id ?? null;
      compliance = {
        eligible: c.eligible,
        noVehicle: c.noVehicle,
        message: c.eligible ? "" : blockMessage(c),
        enforced: gatingEnabled(),
      };
    }

    const vehicle = vehicleId
      ? await fastify.prisma.vehicle.findUnique({
          where: { id: vehicleId },
          select: { id: true, licensePlate: true, make: true, model: true, archivedAt: true },
        })
      : null;

    const ownerOr: Prisma.DriverDocumentWhereInput[] = [];
    if (driverId) ownerOr.push({ driverId, vehicleId: null });
    if (vehicle) ownerOr.push({ vehicleId: vehicle.id });
    if (!ownerOr.length) return reply.status(400).send({ success: false, error: "driverId or vehicleId required" });

    const rows = await fastify.prisma.driverDocument.findMany({
      where: { OR: ownerOr, archivedAt: null },
      include: listInclude,
      orderBy: { createdAt: "desc" },
    });
    const files = linksFor(request);
    const presented = rows.map((r) => present(r, now, files));
    const byId = new Map(presented.map((p) => [p.id, p]));
    const ruleRows = rows as unknown as DocRuleRow[];

    const types: DocType[] = [
      ...(driverId ? DRIVER_REQUIRED : []),
      ...(vehicle ? VEHICLE_REQUIRED : []),
    ];
    const items = types.map((type) => {
      const own = ruleRows.filter((r) => (isVehicleType(type) ? r.vehicleId === vehicle?.id : !r.vehicleId));
      const s = typeStatus(type, own, now);
      const pick = (r: DocRuleRow | null) => (r ? byId.get(r.id) ?? null : null);
      return {
        type,
        label: DOC_LABELS[type],
        owner: s.owner,
        state: s.state,
        daysLeft: s.daysLeft,
        inGrace: s.inGrace,
        expiryRequired: EXPIRY_REQUIRED.has(type),
        multiPage: MULTI_PAGE.has(type),
        current: pick(s.current),
        pending: pick(s.pending),
        rejected: pick(s.rejected),
      };
    });
    const inUse = new Set(items.flatMap((i) => [i.current?.id, i.pending?.id, i.rejected?.id]).filter(Boolean));
    const history = presented.filter((p) => !inUse.has(p.id));

    return reply.send({ success: true, data: { compliance, vehicle, items, history } });
  });

  // ─── Admin upload (optionally approved straight away) ───
  fastify.post("/admin/documents", auth, async (request, reply) => {
    const { userId } = request.user;
    let upload: Awaited<ReturnType<typeof readDocumentUpload>>;
    try {
      upload = await readDocumentUpload(request, `admin_${Date.now()}`);
    } catch (err) {
      request.log.error({ err }, "[Documents] admin upload to Cloudinary failed");
      return reply.status(500).send({ success: false, error: "Upload failed. Please try again." });
    }
    const { fields, files } = upload;
    const type = fields.type;
    if (!type || !isDocType(type)) return reply.status(400).send({ success: false, error: "Choose the document type" });
    const expiryDate = parseExpiryDate(fields.expiryDate);
    if (fields.expiryDate && !expiryDate) return reply.status(400).send({ success: false, error: "Invalid expiry date" });

    try {
      const doc = await addDocumentVersion(fastify.prisma, {
        type,
        files,
        driverId: fields.driverId || null,
        vehicleId: fields.vehicleId || null,
        expiryDate,
        uploadedBy: userId,
      });
      let result = doc;
      if (fields.approve === "true") {
        result = await reviewDocument(fastify.prisma, {
          docId: doc.id,
          decision: "approve",
          expiryDate,
          notes: fields.notes || "Uploaded by admin",
          adminUserId: userId,
        });
        notifyReview(fastify.prisma, result);
      }
      return reply.status(201).send({ success: true, data: linksFor(request).doc(result) });
    } catch (err) {
      if (err instanceof DocumentError)
        return reply.status(err.statusCode).send({ success: false, error: err.message });
      throw err;
    }
  });

  // ─── Review ───
  fastify.post("/admin/documents/:id/review", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = reviewSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: "Invalid review" });
    const expiryDate = parseExpiryDate(body.data.expiryDate ?? undefined);
    if (body.data.expiryDate && !expiryDate)
      return reply.status(400).send({ success: false, error: "Invalid expiry date" });
    try {
      const doc = await reviewDocument(fastify.prisma, {
        docId: id,
        decision: body.data.decision,
        expiryDate,
        rejectionReason: body.data.rejectionReason,
        notes: body.data.notes,
        adminUserId: request.user.userId,
      });
      notifyReview(fastify.prisma, doc);
      return reply.send({ success: true, data: linksFor(request).doc(doc) });
    } catch (err) {
      if (err instanceof DocumentError)
        return reply.status(err.statusCode).send({ success: false, error: err.message });
      throw err;
    }
  });
}
