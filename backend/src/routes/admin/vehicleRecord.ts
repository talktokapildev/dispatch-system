// backend/src/routes/admin/vehicleRecord.ts
//
// Admin: TfL vehicle record ("VEHICLE DETAILS" template) and vehicle / driver history.
// GET /admin/tfl-records/vehicles          TfL Records dropdown: fleet cars + cars ceased within 12 months
// GET /admin/vehicles/:id/tfl-record       everything for the vehicle record (template + OrangeRide record)
// GET /admin/vehicles/:id/history          drivers who had this car (Vehicles page)
// GET /admin/drivers/:driverId/vehicle-history   cars this driver had (Drivers page)
//
// History rows are written by the database trigger "vehicle_history" (see the migration
// 20261018200000_vehicle_history), never by this code.
import { FastifyInstance } from "fastify";
import { config } from "../../config";
import { DOC_LABELS, typeStatus, ukDateLabel, type DocType } from "../../services/documentRules";
import { RETENTION_MONTHS, addMonths, dayKey, ukToday } from "../../services/driverRegisterRules";
import { fileLinker } from "../../services/fileLinks";

const label = (d: Date | null | undefined) => (d ? ukDateLabel(d) : null);
const name = (u: { firstName: string; lastName: string | null }) => `${u.firstName} ${u.lastName ?? ""}`.trim();

/** The template's "copy enclosed" documents, then the PHV vehicle licence (OrangeRide record). */
const ENCLOSURES: { type: DocType; title: string; onTemplate: boolean }[] = [
  { type: "MOT_CERTIFICATE", title: "MOT", onTemplate: true },
  { type: "VEHICLE_INSURANCE", title: "Insurance", onTemplate: true },
  { type: "V5C_LOGBOOK", title: "Vehicle Registration Document", onTemplate: true },
  { type: "PHV_LICENCE", title: "PHV vehicle licence", onTemplate: false },
];

export async function adminVehicleRecordRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticateAdmin] };
  const prisma = fastify.prisma;

  // ─── Dropdown ───
  fastify.get("/admin/tfl-records/vehicles", auth, async (_request, reply) => {
    const today = ukToday();
    const vehicles = await prisma.vehicle.findMany({
      select: {
        id: true,
        licensePlate: true,
        make: true,
        model: true,
        archivedAt: true,
        driver: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: { licensePlate: "asc" },
    });
    const rows = vehicles
      .map((v) => {
        const keptUntil = v.archivedAt ? addMonths(new Date(ukDateKeyOf(v.archivedAt) + "T00:00:00Z"), RETENTION_MONTHS) : null;
        return {
          id: v.id,
          registration: v.licensePlate,
          makeModel: `${v.make} ${v.model}`,
          driverName: v.driver ? name(v.driver.user) : null,
          retired: !!v.archivedAt,
          ceasedOn: v.archivedAt ? ukDateKeyOf(v.archivedAt) : null,
          keptUntil: keptUntil ? dayKey(keptUntil) : null,
        };
      })
      .filter((r) => !r.retired || (r.keptUntil && r.keptUntil > dayKey(today)))
      .sort((a, b) => Number(a.retired) - Number(b.retired) || a.registration.localeCompare(b.registration));
    return reply.send({ success: true, data: rows });
  });

  // ─── Vehicle record ───
  fastify.get("/admin/vehicles/:id/tfl-record", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const now = new Date();
    const v = await prisma.vehicle.findUnique({
      where: { id },
      include: {
        documents: true,
        servicePeriods: { orderBy: [{ startedAt: "asc" }, { createdAt: "asc" }] },
        assignments: {
          orderBy: [{ startedAt: "asc" }, { createdAt: "asc" }],
          include: { driver: { select: { register: { select: { callSign: true } } } } },
        },
      },
    });
    if (!v) return reply.status(404).send({ success: false, error: "Vehicle not found" });
    const admin = await prisma.user.findUnique({
      where: { id: request.user.userId },
      select: { firstName: true, lastName: true },
    });
    const files = fileLinker(request, { kind: "admin", id: request.user.userId });
    // A retired car's documents still count as "enclosed" for the inspector
    const docs = v.documents.map((d) => ({ ...d, archivedAt: null }));

    const enclosures = ENCLOSURES.map(({ type, title, onTemplate }) => {
      const st = typeStatus(type, docs, now);
      const doc = st.current;
      return {
        type,
        title,
        label: DOC_LABELS[type],
        onTemplate,
        state: st.state,
        approvedAt: label(doc?.reviewedAt ?? null),
        expiryDate: label(doc?.expiryDate ?? null),
        pages: doc ? files.doc(doc).pages : [],
      };
    });

    const keeper = [v.keeperName, ...(v.keeperAddress ?? "").split(/\r?\n/)].map((s) => (s ?? "").trim()).filter(Boolean);
    return reply.send({
      success: true,
      data: {
        operator: { name: config.OPERATOR_NAME, licenceNumber: config.OPERATOR_LICENSE_NUMBER },
        printedAt: now.toISOString(),
        printedBy: admin ? name(admin) : null,
        retired: !!v.archivedAt,
        vehicle: {
          make: v.make,
          model: v.model,
          registration: v.licensePlate,
          colour: v.colour,
          year: v.year,
          keeper,
          phvLicenceNumber: v.phvLicenceNumber,
          phvDiscNumber: v.phvDiscNumber,
          phvLicenceExpiry: label(v.phvLicenceExpiry),
        },
        periods: v.servicePeriods.map((p) => ({ start: label(p.startedAt), ceased: label(p.endedAt) })),
        enclosures,
        drivers: v.assignments.map((a) => ({
          name: a.driverName,
          callSign: a.driver?.register?.callSign ?? null,
          from: label(a.startedAt),
          to: label(a.endedAt),
          reason: a.endReason,
          note: a.note,
          current: !a.endedAt,
        })),
        warnings: {
          keeperNameMissing: !v.keeperName,
          keeperAddressMissing: !v.keeperAddress,
        },
      },
    });
  });

  // ─── History: one car's drivers ───
  fastify.get("/admin/vehicles/:id/history", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await prisma.vehicleAssignment.findMany({
      where: { vehicleId: id },
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    });
    return reply.send({
      success: true,
      data: rows.map((a) => ({
        id: a.id,
        driverId: a.driverId,
        driverName: a.driverName,
        startedAt: a.startedAt,
        endedAt: a.endedAt,
        endReason: a.endReason,
        note: a.note,
      })),
    });
  });

  // ─── History: one driver's cars ───
  fastify.get("/admin/drivers/:driverId/vehicle-history", auth, async (request, reply) => {
    const { driverId } = request.params as { driverId: string };
    const rows = await prisma.vehicleAssignment.findMany({
      where: { driverId },
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
      include: { vehicle: { select: { id: true, licensePlate: true, make: true, model: true, archivedAt: true } } },
    });
    return reply.send({
      success: true,
      data: rows.map((a) => ({
        id: a.id,
        vehicleId: a.vehicle.id,
        registration: a.vehicle.licensePlate,
        makeModel: `${a.vehicle.make} ${a.vehicle.model}`,
        retired: !!a.vehicle.archivedAt,
        startedAt: a.startedAt,
        endedAt: a.endedAt,
        endReason: a.endReason,
        note: a.note,
      })),
    });
  });
}

/** UK calendar date "YYYY-MM-DD" of a timestamp. */
function ukDateKeyOf(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
