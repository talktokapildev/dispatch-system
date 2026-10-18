// backend/src/routes/admin/driverRegister.ts
//
// Admin: TfL driver register.
// GET   /admin/drivers/:driverId/register                   register details, periods, deletion date
// PUT   /admin/drivers/:driverId/register                   save register details
// POST  /admin/drivers/:driverId/archive                    driver left {leftOn, reason, dismissedForConduct, notes}
// POST  /admin/drivers/:driverId/restore                    driver restarts {restartOn, notes}
// PATCH /admin/drivers/:driverId/engagements/:engagementId  correct a period
// GET   /admin/drivers/:driverId/tfl-record                 everything for the printable TfL record
// GET   /admin/tfl-records/drivers                          TfL Records page dropdown: current drivers +
//                                                           drivers who left within the retention period
//
// The register details (NI number, date of birth, address) live in DriverRegister and are only
// returned by these admin endpoints.
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { config } from "../../config";
import {
  RegisterError,
  ageOn,
  dayKey,
  dayLabel,
  formatNi,
  licenceCheckDue,
  maskNi,
  MIN_DRIVER_AGE,
  registerDates,
  sortEngagements,
  ukToday,
} from "../../services/driverRegisterRules";
import {
  archiveDriver,
  deletableFromMany,
  deletionStatus,
  restoreDriver,
  saveRegister,
  updateEngagement,
} from "../../services/driverRegister.service";
import { DOC_LABELS, typeStatus, type DocType } from "../../services/documentRules";
import { fileLinker } from "../../services/fileLinks";

const optStr = z.string().max(400).nullable().optional();
const registerSchema = z.object({
  middleNames: optStr,
  callSign: optStr,
  address: optStr,
  postcode: optStr,
  dateOfBirth: optStr,
  niNumber: optStr,
  licenceCheckedAt: optStr,
});
const archiveSchema = z.object({
  leftOn: z.string(),
  reason: z.string().max(300),
  dismissedForConduct: z.boolean().optional(),
  notes: z.string().max(500).nullable().optional(),
});
const restoreSchema = z.object({ restartOn: z.string(), notes: z.string().max(500).nullable().optional() });
const engagementSchema = z.object({
  startedAt: z.string().optional(),
  endedAt: z.string().nullable().optional(),
  endReason: z.string().max(300).nullable().optional(),
  dismissedForConduct: z.boolean().optional(),
  notes: z.string().max(500).nullable().optional(),
});

const key = (d: Date | null | undefined) => (d ? dayKey(d) : null);
const label = (d: Date | null | undefined) => (d ? dayLabel(d) : null);

export async function adminDriverRegisterRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticateAdmin] };

  /** Run a handler; RegisterError → its status + message, bad body → 400. */
  const handle =
    (fn: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        return await fn(request, reply);
      } catch (err) {
        if (err instanceof RegisterError)
          return reply.status(err.statusCode).send({ success: false, error: err.message });
        if (err instanceof z.ZodError)
          return reply.status(400).send({ success: false, error: "Some details are not valid" });
        throw err;
      }
    };

  const deps = () => ({ prisma: fastify.prisma, redis: fastify.redis, io: fastify.io as any, log: fastify.log });

  async function loadRegister(driverId: string) {
    const driver = await fastify.prisma.driver.findUnique({
      where: { id: driverId },
      include: {
        user: { select: { firstName: true, lastName: true, phone: true, email: true } },
        register: true,
        engagements: true,
      },
    });
    if (!driver) throw new RegisterError("Driver not found", 404);
    const now = new Date();
    const r = driver.register;
    const dates = registerDates(driver.engagements);
    const del = deletionStatus(driver, now);
    const age = r?.dateOfBirth ? ageOn(r.dateOfBirth, ukToday(now)) : null;
    const missing = [
      !r?.address && "Address",
      !r?.postcode && "Post code",
      !r?.dateOfBirth && "Date of birth",
      !r?.niNumber && "National Insurance number",
    ].filter(Boolean) as string[];
    return {
      driverId: driver.id,
      archived: !!driver.archivedAt,
      name: {
        surname: driver.user.lastName,
        firstName: driver.user.firstName,
        middleNames: r?.middleNames ?? null,
      },
      register: {
        middleNames: r?.middleNames ?? null,
        callSign: r?.callSign ?? null,
        address: r?.address ?? null,
        postcode: r?.postcode ?? null,
        dateOfBirth: key(r?.dateOfBirth),
        niNumber: r?.niNumber ? formatNi(r.niNumber) : null,
        niMasked: maskNi(r?.niNumber),
        licenceCheckedAt: key(r?.licenceCheckedAt),
        updatedAt: r?.updatedAt ?? null,
      },
      engagements: sortEngagements(driver.engagements).map((e) => ({
        id: e.id,
        startedAt: key(e.startedAt),
        endedAt: key(e.endedAt),
        endReason: e.endReason,
        dismissedForConduct: e.dismissedForConduct,
        notes: e.notes,
      })),
      dates: {
        firstAvailable: key(dates.firstAvailable),
        dateOfLeaving: key(dates.dateOfLeaving),
        leftOn: key(dates.leftOn),
        active: dates.active,
      },
      deletableFrom: key(del.deletableFrom),
      canDelete: del.canDelete,
      warnings: {
        missing,
        underAge: age !== null && age < MIN_DRIVER_AGE,
        age,
        licenceCheckDue: licenceCheckDue(r?.licenceCheckedAt, now),
      },
    };
  }

  fastify.get(
    "/admin/drivers/:driverId/register",
    auth,
    handle(async (request, reply) => {
      const { driverId } = request.params as { driverId: string };
      return reply.send({ success: true, data: await loadRegister(driverId) });
    })
  );

  fastify.put(
    "/admin/drivers/:driverId/register",
    auth,
    handle(async (request, reply) => {
      const { driverId } = request.params as { driverId: string };
      const body = registerSchema.parse(request.body ?? {});
      await saveRegister(fastify.prisma, driverId, body, request.user.userId);
      return reply.send({ success: true, data: await loadRegister(driverId) });
    })
  );

  fastify.post(
    "/admin/drivers/:driverId/archive",
    auth,
    handle(async (request, reply) => {
      const { driverId } = request.params as { driverId: string };
      const body = archiveSchema.parse(request.body ?? {});
      const res = await archiveDriver(deps(), { driverId, ...body, adminUserId: request.user.userId });
      return reply.send({ success: true, data: { ...res, register: await loadRegister(driverId) } });
    })
  );

  fastify.post(
    "/admin/drivers/:driverId/restore",
    auth,
    handle(async (request, reply) => {
      const { driverId } = request.params as { driverId: string };
      const body = restoreSchema.parse(request.body ?? {});
      await restoreDriver(deps(), { driverId, ...body, adminUserId: request.user.userId });
      return reply.send({ success: true, data: await loadRegister(driverId) });
    })
  );

  fastify.patch(
    "/admin/drivers/:driverId/engagements/:engagementId",
    auth,
    handle(async (request, reply) => {
      const { driverId, engagementId } = request.params as { driverId: string; engagementId: string };
      const body = engagementSchema.parse(request.body ?? {});
      await updateEngagement(fastify.prisma, { driverId, engagementId, ...body });
      return reply.send({ success: true, data: await loadRegister(driverId) });
    })
  );

  // ─── TfL Records page: who can be shown ───
  // Current drivers, then drivers who left and whose records are still kept (12 months).
  fastify.get(
    "/admin/tfl-records/drivers",
    auth,
    handle(async (_request, reply) => {
      const drivers = await fastify.prisma.driver.findMany({
        select: {
          id: true,
          archivedAt: true,
          user: { select: { firstName: true, lastName: true } },
          register: { select: { callSign: true, middleNames: true } },
          vehicle: { select: { licensePlate: true } },
        },
      });
      const leaving = await deletableFromMany(fastify.prisma, drivers.map((d) => d.id));
      const today = ukToday();
      const rows = drivers
        .map((d) => {
          const l = leaving.get(d.id);
          return {
            id: d.id,
            name: [d.user.firstName, d.register?.middleNames, d.user.lastName].filter(Boolean).join(" "),
            callSign: d.register?.callSign ?? null,
            vehicleReg: d.vehicle?.licensePlate ?? null,
            left: !!d.archivedAt,
            leftOn: d.archivedAt ? key(l?.leftOn) : null,
            keptUntil: d.archivedAt ? key(l?.deletableFrom) : null,
          };
        })
        // past the retention period: no longer a record TfL can ask for
        .filter((r) => !r.left || !r.keptUntil || r.keptUntil > dayKey(today))
        .sort((a, b) => Number(a.left) - Number(b.left) || a.name.localeCompare(b.name));
      return reply.send({ success: true, data: rows });
    })
  );

  // ─── Printable TfL record ("PRIVATE HIRE DRIVER") ───
  fastify.get(
    "/admin/drivers/:driverId/tfl-record",
    auth,
    handle(async (request, reply) => {
      const { driverId } = request.params as { driverId: string };
      const now = new Date();
      const driver = await fastify.prisma.driver.findUnique({
        where: { id: driverId },
        include: {
          user: { select: { firstName: true, lastName: true } },
          register: true,
          engagements: true,
          documents: { where: { vehicleId: null } },
          vehicle: {
            select: {
              licensePlate: true,
              documents: { where: { type: "VEHICLE_INSURANCE" } },
            },
          },
        },
      });
      if (!driver) throw new RegisterError("Driver not found", 404);
      const admin = await fastify.prisma.user.findUnique({
        where: { id: request.user.userId },
        select: { firstName: true, lastName: true },
      });
      const files = fileLinker(request, { kind: "admin", id: request.user.userId });
      const r = driver.register;
      const dates = registerDates(driver.engagements);

      // An inspector may ask for a driver who has left: their documents still count as "on file".
      const asLive = <T extends { archivedAt: Date | null }>(rows: T[]) => rows.map((d) => ({ ...d, archivedAt: null }));
      const docs = asLive(driver.documents);
      const enclosure = (title: string, types: DocType[]) => {
        const parts = types.map((type) => {
          const st = typeStatus(type, docs, now);
          const doc = st.current;
          return {
            type,
            label: DOC_LABELS[type],
            state: st.state,
            approvedAt: label(doc?.reviewedAt ?? null),
            expiryDate: label(doc?.expiryDate ?? null),
            pages: doc ? files.doc(doc).pages : [],
          };
        });
        return { title, onFile: parts.every((p) => p.pages.length > 0), parts };
      };

      const insuranceStatus = driver.vehicle
        ? (() => {
            const st = typeStatus("VEHICLE_INSURANCE", driver.vehicle!.documents, now);
            return {
              vehicleReg: driver.vehicle!.licensePlate,
              state: st.state,
              expiryDate: label(st.expiryDate),
            };
          })()
        : null;

      return reply.send({
        success: true,
        data: {
          operator: { name: config.OPERATOR_NAME, licenceNumber: config.OPERATOR_LICENSE_NUMBER },
          printedAt: now.toISOString(),
          printedBy: admin ? `${admin.firstName} ${admin.lastName ?? ""}`.trim() : null,
          archived: !!driver.archivedAt,
          driver: {
            surname: driver.user.lastName,
            firstAndMiddleNames: [driver.user.firstName, r?.middleNames].filter(Boolean).join(" "),
            address: r?.address ? r.address.split("\n") : [],
            postcode: r?.postcode ?? null,
            dateOfBirth: label(r?.dateOfBirth),
            niNumber: r?.niNumber ? formatNi(r.niNumber) : null,
            privateHireLicenceNo: driver.pcoBadgeNumber,
            privateHireLicenceExpiry: label(driver.pcoLicenseExpiry),
            drivingLicenceNo: driver.drivingLicenseNumber,
            callSign: r?.callSign ?? null,
            photoUrl: driver.photoUrl ?? null,
          },
          dates: {
            firstAvailable: label(dates.firstAvailable),
            dateOfLeaving: label(dates.dateOfLeaving),
            restarts: dates.restarts.map((x) => ({ restart: label(x.restart), finish: label(x.finish) })),
          },
          enclosures: [
            enclosure("Driving Licence", ["DRIVING_LICENSE", "DRIVING_LICENSE_BACK"]),
            enclosure("Private Hire Licence", ["PCO_LICENSE"]),
          ],
          checks: {
            photoMissing: !driver.photoUrl,
            insurance: insuranceStatus,
            licenceCheckedAt: label(r?.licenceCheckedAt),
            licenceCheckDue: licenceCheckDue(r?.licenceCheckedAt, now),
          },
        },
      });
    })
  );
}
