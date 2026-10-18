// backend/src/routes/admin/lostProperty.ts
//
// Admin: TfL Condition 9 lost property register (replaces the two routes that were in admin.ts).
// GET    /admin/lost-property                   all items (Alerts page), newest first; ?status=
// POST   /admin/lost-property                   log an item handed in / reported by phone
// PUT    /admin/lost-property/:id               edit details / add a history entry / change status
// DELETE /admin/lost-property/:id               permanent delete, closed 12+ months {confirmRef}
// GET    /admin/lost-property/:id/tfl-record    everything for the TfL "LOST/FOUND PROPERTY" record
// GET    /admin/tfl-records/lost-property       the register (TfL Records tab) ?from=YYYY-MM-DD&to=
//
// Passengers report from the app via POST /passengers/bookings/:id/lost-property (passengers.ts).
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../../config";
import { dayKey, parseDay, ukToday } from "../../services/driverRegisterRules";
import {
  LostPropertyError,
  OUTCOME_LABELS,
  STATUS_LABELS,
  canDelete,
  daysOpen,
  deletableFrom,
  isClosed,
  isOverdue,
  ukDateLabel,
  ukDateTimeLabel,
  ukInputValue,
  type LpOutcome,
  type LpStatus,
} from "../../services/lostPropertyRules";
import {
  ITEM_INCLUDE,
  deleteItem,
  loadItem,
  logItem,
  staffName,
  updateItem,
  type LostPropertyItem,
} from "../../services/lostProperty.service";

const s = (max: number) => z.string().max(max).nullable().optional();
const detailsSchema = z.object({
  bookingId: s(64),
  bookingReference: s(40),
  description: s(2000),
  handedInByDriverId: s(64),
  handedInByName: s(200),
  vehicleReg: s(20),
  receivedAt: s(40),
  bookingDateTime: s(40),
  customerName: s(200),
  customerAddress: s(600),
  contactPhone: s(60),
});
const logSchema = detailsSchema.extend({
  status: z.enum(["REPORTED", "FOUND"]).optional(),
  note: s(2000),
  showToPassenger: z.boolean().optional(),
});
const updateSchema = z.object({
  details: detailsSchema.optional(),
  note: s(2000),
  noteAt: s(40),
  showToPassenger: z.boolean().optional(),
  status: z.string().max(20).optional(),
  outcome: s(40),
  outcomeAt: s(40),
  outcomeDetails: s(2000),
  representativeName: s(200),
});

/** Strip keys zod added as undefined, so "left out" stays "unchanged" in the service. */
const present = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

const outcomeLabel = (o: string | null) => (o ? OUTCOME_LABELS[o as LpOutcome] ?? o : null);
const NO_RESULT = "Result not recorded (closed before the register was kept)";

/** One item for the Alerts page (old fields kept, so nothing that read them breaks). */
function listRow(item: LostPropertyItem, now: Date) {
  const del = deletableFrom(item);
  return {
    ...item,
    statusLabel: STATUS_LABELS[item.status as LpStatus],
    outcomeLabel: outcomeLabel(item.outcome),
    overdue: isOverdue(item, now),
    daysOpen: isClosed(item.status) ? null : daysOpen(item, now),
    deletableFrom: del ? dayKey(del) : null,
    deletableFromLabel: del ? ukDateLabel(del) : null,
    canDelete: canDelete(item, now),
    // for the edit form's datetime-local inputs (UK time)
    inputs: {
      receivedAt: ukInputValue(item.receivedAt),
      bookingDateTime: ukInputValue(item.bookingDateTime),
      outcomeAt: ukInputValue(item.outcomeAt),
    },
  };
}

/** The date the register is ordered and filtered by: received, or reported if never received. */
const registerDate = (i: { receivedAt: Date | null; reportedAt: Date }) => ukToday(i.receivedAt ?? i.reportedAt);

export async function adminLostPropertyRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticateAdmin] };
  const prisma = fastify.prisma;
  const deps = () => ({ prisma, log: fastify.log });

  /** Run a handler; LostPropertyError → its status + message, bad body → 400. */
  const handle =
    (fn: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        return await fn(request, reply);
      } catch (err) {
        if (err instanceof LostPropertyError)
          return reply.status(err.statusCode).send({ success: false, error: err.message });
        if (err instanceof z.ZodError)
          return reply.status(400).send({ success: false, error: "Some details are not valid" });
        throw err;
      }
    };

  // ─── List (Alerts) ───
  fastify.get(
    "/admin/lost-property",
    auth,
    handle(async (request, reply) => {
      const { status } = request.query as { status?: string };
      const now = new Date();
      const items = await prisma.lostProperty.findMany({
        where: status && status in STATUS_LABELS ? { status: status as LpStatus } : undefined,
        include: ITEM_INCLUDE,
        orderBy: { reportedAt: "desc" },
      });
      return reply.send({ success: true, data: items.map((i) => listRow(i, now)) });
    })
  );

  // ─── Log an item ───
  fastify.post(
    "/admin/lost-property",
    auth,
    handle(async (request, reply) => {
      const body = present(logSchema.parse(request.body ?? {}));
      const item = await logItem(deps(), body, request.user.userId);
      return reply.send({ success: true, data: listRow(item, new Date()) });
    })
  );

  // ─── Update ───
  fastify.put(
    "/admin/lost-property/:id",
    auth,
    handle(async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = present(updateSchema.parse(request.body ?? {}));
      if (body.details) body.details = present(body.details);
      const item = await updateItem(deps(), id, body, request.user.userId);
      return reply.send({ success: true, data: listRow(item, new Date()) });
    })
  );

  // ─── Permanent delete (closed 12+ months) ───
  fastify.delete(
    "/admin/lost-property/:id",
    auth,
    handle(async (request, reply) => {
      const { id } = request.params as { id: string };
      const { confirmRef } = (request.body ?? {}) as { confirmRef?: string };
      const done = await deleteItem(deps(), id, confirmRef);
      fastify.log.info(`[LostProperty] ${done.refNo} permanently deleted by ${request.user.userId}`);
      return reply.send({ success: true, data: done });
    })
  );

  // ─── TfL record ───
  fastify.get(
    "/admin/lost-property/:id/tfl-record",
    auth,
    handle(async (request, reply) => {
      const { id } = request.params as { id: string };
      const now = new Date();
      const i = await loadItem(prisma, id);
      const closed = isClosed(i.status);
      const warnings = [
        !i.handedInByName && "Handed in by",
        !i.vehicleReg && "Vehicle registration",
        !i.receivedAt && i.status !== "REPORTED" && "Date property received",
        !i.customerName && "Customer name",
        !i.customerAddress && "Customer address",
        !i.contactPhone && "Customer phone",
        closed && !i.outcome && "Result",
      ].filter(Boolean) as string[];
      const del = deletableFrom(i);
      return reply.send({
        success: true,
        data: {
          operator: { name: config.OPERATOR_NAME, licenceNumber: config.OPERATOR_LICENSE_NUMBER },
          printedAt: now.toISOString(),
          printedBy: await staffName(prisma, request.user.userId),
          item: {
            id: i.id,
            refNo: i.refNo,
            status: i.status,
            statusLabel: STATUS_LABELS[i.status as LpStatus],
            source: i.source,
            handedInBy: i.handedInByName,
            vehicleReg: i.vehicleReg,
            receivedAt: ukDateTimeLabel(i.receivedAt),
            bookingDateTime: ukDateTimeLabel(i.bookingDateTime),
            bookingReference: i.booking?.reference ?? null,
            customer: {
              name: i.customerName,
              address: (i.customerAddress ?? "").split("\n").filter(Boolean),
              phone: i.contactPhone || null,
            },
            description: i.description,
            reportedAt: ukDateTimeLabel(i.reportedAt),
            enquiries: i.contacts.map((c) => ({
              at: ukDateTimeLabel(c.at),
              staffName: c.staffName,
              note: c.note,
              shownToPassenger: c.shownToPassenger,
            })),
            result: closed
              ? {
                  label: outcomeLabel(i.outcome) ?? NO_RESULT,
                  at: ukDateTimeLabel(i.outcomeAt ?? i.resolvedAt),
                  details: i.outcomeDetails,
                }
              : null,
            representativeName: i.representativeName,
            overdue: isOverdue(i, now),
            daysOpen: closed ? null : daysOpen(i, now),
            deletableFrom: del ? ukDateLabel(del) : null,
            canDelete: canDelete(i, now),
          },
          warnings,
        },
      });
    })
  );

  // ─── Register (TfL Records tab) ───
  fastify.get(
    "/admin/tfl-records/lost-property",
    auth,
    handle(async (request, reply) => {
      const q = request.query as { from?: string; to?: string };
      const from = q.from ? parseDay(q.from) : null;
      const to = q.to ? parseDay(q.to) : null;
      if ((q.from && !from) || (q.to && !to)) throw new LostPropertyError("Dates must be YYYY-MM-DD");
      const now = new Date();
      const items = await prisma.lostProperty.findMany({
        select: {
          id: true,
          refNo: true,
          status: true,
          receivedAt: true,
          reportedAt: true,
          resolvedAt: true,
          vehicleReg: true,
          description: true,
          customerName: true,
          handedInByName: true,
          outcome: true,
          outcomeAt: true,
          representativeName: true,
          booking: { select: { reference: true } },
        },
      });
      const rows = items
        .filter((i) => {
          const d = dayKey(registerDate(i));
          return (!from || d >= dayKey(from)) && (!to || d <= dayKey(to));
        })
        .sort((a, b) => registerDate(a).getTime() - registerDate(b).getTime() || a.refNo.localeCompare(b.refNo))
        .map((i) => ({
          id: i.id,
          refNo: i.refNo,
          status: i.status,
          statusLabel: STATUS_LABELS[i.status as LpStatus],
          date: ukDateLabel(i.receivedAt ?? i.reportedAt),
          received: !!i.receivedAt,
          vehicleReg: i.vehicleReg,
          description: i.description,
          customerName: i.customerName,
          handedInBy: i.handedInByName,
          bookingReference: i.booking?.reference ?? null,
          result: isClosed(i.status) ? outcomeLabel(i.outcome) ?? NO_RESULT : null,
          resultAt: isClosed(i.status) ? ukDateLabel(i.outcomeAt ?? i.resolvedAt) : null,
          representativeName: i.representativeName,
          overdue: isOverdue(i, now),
        }));
      return reply.send({
        success: true,
        data: {
          operator: { name: config.OPERATOR_NAME, licenceNumber: config.OPERATOR_LICENSE_NUMBER },
          printedAt: now.toISOString(),
          printedBy: await staffName(prisma, request.user.userId),
          from: from ? ukDateLabel(from) : null,
          to: to ? ukDateLabel(to) : null,
          rows,
        },
      });
    })
  );
}
