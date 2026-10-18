// backend/src/routes/admin/complaints.ts
//
// Admin: TfL Condition 7 complaints / compliments register (replaces the two complaint routes
// that were in admin.ts and read Booking.feedback).
// GET    /admin/complaints                         all records (Alerts page), newest first; ?status= ?type=
// POST   /admin/complaints                         log a complaint / compliment (phone, email, in person)
// PUT    /admin/complaints/:id                     edit details / add a history entry / change status
// DELETE /admin/complaints/:id                     permanent delete, 12+ months after resolving {confirmRef}
// GET    /admin/complaints/:id/tfl-record          everything for the TfL "COMPLAINT/COMPLIMENT" record
// GET    /admin/tfl-records/complaints             the register (TfL Records tab) ?from=YYYY-MM-DD&to=
// POST   /admin/feedback/:bookingId/compliment     record a rating comment as a compliment
//
// Passengers complain from the app via POST /passengers/bookings/:id/complaint (passengers.ts).
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../../config";
import { dayKey, parseDay, ukToday } from "../../services/driverRegisterRules";
import { ukDateLabel, ukDateTimeLabel, ukInputValue } from "../../services/lostPropertyRules";
import {
  CHANNEL_LABELS,
  ComplaintError,
  OUTCOME_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  canDelete,
  deletableFrom,
  hoursSince,
  isDone,
  isReplyOverdue,
  type CChannel,
  type COutcome,
  type CStatus,
  type CType,
} from "../../services/complaintRules";
import {
  ITEM_INCLUDE,
  complimentFromRating,
  deleteItem,
  loadItem,
  logItem,
  staffName,
  updateItem,
  type ComplaintItem,
} from "../../services/complaint.service";

const s = (max: number) => z.string().max(max).nullable().optional();
const detailsSchema = z.object({
  type: z.string().max(20).optional(),
  channel: z.string().max(20).optional(),
  category: s(100),
  details: s(4000),
  bookingId: s(64),
  bookingReference: s(40),
  receivedAt: s(40),
  bookingDateTime: s(40),
  complainantName: s(200),
  complainantAddress: s(600),
  complainantPhone: s(60),
  driverName: s(200),
  vehicleReg: s(20),
  handledByUserId: s(64),
});
const logSchema = detailsSchema.extend({ note: s(4000) });
const updateSchema = z.object({
  details: detailsSchema.optional(),
  note: s(4000),
  noteAt: s(40),
  status: z.string().max(20).optional(),
  outcome: s(40),
  resolutionNote: s(4000),
  representativeName: s(200),
});

const present = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

const NO_OUTCOME = "Outcome not recorded (resolved before the register was kept)";
const outcomeLabel = (c: { type: string; status: string; outcome: string | null }) =>
  c.outcome ? OUTCOME_LABELS[c.outcome as COutcome] : c.type === "COMPLAINT" && c.status === "RESOLVED" ? NO_OUTCOME : null;

/** One record for the Alerts page. */
function listRow(c: ComplaintItem, now: Date) {
  const del = deletableFrom(c);
  const contactCount = c.contacts.length;
  return {
    ...c,
    typeLabel: TYPE_LABELS[c.type as CType],
    statusLabel: STATUS_LABELS[c.status as CStatus],
    channelLabel: CHANNEL_LABELS[c.channel as CChannel],
    outcomeLabel: outcomeLabel(c),
    replyOverdue: isReplyOverdue({ ...c, contactCount }, now),
    hoursOpen: isDone(c.status) ? null : hoursSince(c.receivedAt, now),
    deletableFrom: del ? dayKey(del) : null,
    canDelete: canDelete(c, now),
    inputs: { receivedAt: ukInputValue(c.receivedAt), bookingDateTime: ukInputValue(c.bookingDateTime) },
  };
}

export async function adminComplaintRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticateAdmin] };
  const prisma = fastify.prisma;
  const deps = () => ({ prisma, log: fastify.log });

  const handle =
    (fn: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        return await fn(request, reply);
      } catch (err) {
        if (err instanceof ComplaintError) return reply.status(err.statusCode).send({ success: false, error: err.message });
        if (err instanceof z.ZodError) return reply.status(400).send({ success: false, error: "Some details are not valid" });
        throw err;
      }
    };

  // ─── List (Alerts) ───
  fastify.get(
    "/admin/complaints",
    auth,
    handle(async (request, reply) => {
      const { status, type } = request.query as { status?: string; type?: string };
      const now = new Date();
      const items = await prisma.complaint.findMany({
        where: {
          ...(status && status in STATUS_LABELS ? { status: status as CStatus } : {}),
          ...(type && type in TYPE_LABELS ? { type: type as CType } : {}),
        },
        include: ITEM_INCLUDE,
        orderBy: { receivedAt: "desc" },
      });
      return reply.send({ success: true, data: items.map((c) => listRow(c, now)) });
    })
  );

  // ─── Log ───
  fastify.post(
    "/admin/complaints",
    auth,
    handle(async (request, reply) => {
      const body = present(logSchema.parse(request.body ?? {}));
      const c = await logItem(deps(), body, request.user.userId);
      return reply.send({ success: true, data: listRow(c, new Date()) });
    })
  );

  // ─── Update ───
  fastify.put(
    "/admin/complaints/:id",
    auth,
    handle(async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = present(updateSchema.parse(request.body ?? {}));
      if (body.details) body.details = present(body.details);
      const c = await updateItem(deps(), id, body, request.user.userId);
      return reply.send({ success: true, data: listRow(c, new Date()) });
    })
  );

  // ─── Permanent delete ───
  fastify.delete(
    "/admin/complaints/:id",
    auth,
    handle(async (request, reply) => {
      const { id } = request.params as { id: string };
      const { confirmRef } = (request.body ?? {}) as { confirmRef?: string };
      const done = await deleteItem(deps(), id, confirmRef);
      fastify.log.info(`[Complaints] ${done.refNo} permanently deleted by ${request.user.userId}`);
      return reply.send({ success: true, data: done });
    })
  );

  // ─── Feedback page: rating comment → compliment ───
  fastify.post(
    "/admin/feedback/:bookingId/compliment",
    auth,
    handle(async (request, reply) => {
      const { bookingId } = request.params as { bookingId: string };
      const c = await complimentFromRating(deps(), bookingId, request.user.userId);
      return reply.send({ success: true, data: listRow(c, new Date()) });
    })
  );

  // ─── TfL record ───
  fastify.get(
    "/admin/complaints/:id/tfl-record",
    auth,
    handle(async (request, reply) => {
      const { id } = request.params as { id: string };
      const now = new Date();
      const c = await loadItem(prisma, id);
      const done = isDone(c.status);
      const warnings = [
        !c.handledByName && "Handled by",
        !c.complainantName && "Name",
        !c.complainantAddress && "Address",
        !c.complainantPhone && "Phone number",
        c.type === "COMPLAINT" && !c.bookingDateTime && "Date and time of booking",
        c.type === "COMPLAINT" && done && !c.outcome && "Outcome",
      ].filter(Boolean) as string[];
      const del = deletableFrom(c);
      return reply.send({
        success: true,
        data: {
          operator: { name: config.OPERATOR_NAME, licenceNumber: config.OPERATOR_LICENSE_NUMBER },
          printedAt: now.toISOString(),
          printedBy: await staffName(prisma, request.user.userId),
          item: {
            id: c.id,
            refNo: c.refNo,
            type: c.type,
            typeLabel: TYPE_LABELS[c.type as CType],
            status: c.status,
            statusLabel: STATUS_LABELS[c.status as CStatus],
            channelLabel: CHANNEL_LABELS[c.channel as CChannel],
            category: c.category,
            handledBy: c.handledByName,
            receivedAt: ukDateTimeLabel(c.receivedAt),
            bookingDateTime: ukDateTimeLabel(c.bookingDateTime),
            bookingReference: c.booking?.reference ?? null,
            complainant: {
              name: c.complainantName,
              address: (c.complainantAddress ?? "").split("\n").filter(Boolean),
              phone: c.complainantPhone,
            },
            driverName: c.driverName,
            vehicleReg: c.vehicleReg,
            details: c.details,
            enquiries: c.contacts.map((e) => ({ at: ukDateTimeLabel(e.at), staffName: e.staffName, note: e.note })),
            result: done
              ? { outcome: outcomeLabel(c), note: c.resolutionNote, at: ukDateTimeLabel(c.resolvedAt) }
              : null,
            representativeName: c.representativeName,
            replyOverdue: isReplyOverdue({ ...c, contactCount: c.contacts.length }, now),
            deletableFrom: del ? ukDateLabel(del) : null,
            canDelete: canDelete(c, now),
          },
          warnings,
        },
      });
    })
  );

  // ─── Register (TfL Records tab) ───
  fastify.get(
    "/admin/tfl-records/complaints",
    auth,
    handle(async (request, reply) => {
      const q = request.query as { from?: string; to?: string };
      const from = q.from ? parseDay(q.from) : null;
      const to = q.to ? parseDay(q.to) : null;
      if ((q.from && !from) || (q.to && !to)) throw new ComplaintError("Dates must be YYYY-MM-DD");
      const now = new Date();
      const items = await prisma.complaint.findMany({
        include: { booking: { select: { reference: true } }, _count: { select: { contacts: true } } },
        orderBy: [{ receivedAt: "asc" }, { refNo: "asc" }],
      });
      const rows = items
        .filter((c) => {
          const d = dayKey(ukToday(c.receivedAt));
          return (!from || d >= dayKey(from)) && (!to || d <= dayKey(to));
        })
        .map((c) => ({
          id: c.id,
          refNo: c.refNo,
          type: c.type,
          typeLabel: TYPE_LABELS[c.type as CType],
          status: c.status,
          statusLabel: STATUS_LABELS[c.status as CStatus],
          received: ukDateLabel(c.receivedAt),
          channelLabel: CHANNEL_LABELS[c.channel as CChannel],
          category: c.category,
          details: c.details,
          complainantName: c.complainantName,
          driverName: c.driverName,
          vehicleReg: c.vehicleReg,
          bookingReference: c.booking?.reference ?? null,
          handledBy: c.handledByName,
          outcome: outcomeLabel(c),
          resolutionNote: c.resolutionNote,
          resolvedAt: ukDateLabel(c.resolvedAt),
          representativeName: c.representativeName,
          replyOverdue: isReplyOverdue({ ...c, contactCount: c._count.contacts }, now),
        }));
      const complaints = rows.filter((r) => r.type === "COMPLAINT");
      return reply.send({
        success: true,
        data: {
          operator: { name: config.OPERATOR_NAME, licenceNumber: config.OPERATOR_LICENSE_NUMBER },
          printedAt: now.toISOString(),
          printedBy: await staffName(prisma, request.user.userId),
          from: from ? ukDateLabel(from) : null,
          to: to ? ukDateLabel(to) : null,
          summary: {
            complaints: complaints.length,
            open: complaints.filter((r) => !isDone(r.status)).length,
            upheld: complaints.filter((r) => r.outcome === "Upheld" || r.outcome === "Partly upheld").length,
            compliments: rows.length - complaints.length,
          },
          rows,
        },
      });
    })
  );
}
