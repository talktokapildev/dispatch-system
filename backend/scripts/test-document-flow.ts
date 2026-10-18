// backend/scripts/test-document-flow.ts
//
// Driver & vehicle documents end to end against the LOCAL database and LOCAL Redis
// (Cloudinary, push and Google Maps are stubbed; SMS must be dry-run). Creates its own
// users / drivers / vehicles / bookings / documents and deletes them afterwards.
//
//   SMS_DRY_RUN=true node --env-file=.env -r ts-node/register scripts/test-document-flow.ts
//
// Expect: all PASS, 0 failed.
// Type-only: the fastify decorations (prisma, redis, io, authenticate…) used by the routes
import type {} from "../src/plugins/database";
import type {} from "../src/plugins/auth";
import type {} from "../src/plugins/socket";
import Fastify from "fastify";
import Redis from "ioredis";
import { PrismaClient as NativePrismaClient } from "@prisma/client";
import { driverRoutes } from "../src/routes/drivers";
import { scheduledBookingRoutes } from "../src/routes/scheduledBooking.routes";
import { adminDocumentRoutes } from "../src/routes/admin/documents";
import { MapsService } from "../src/services/maps.service";
import { addDocumentVersion, reviewDocument, DocumentError } from "../src/services/documentReview.service";
import { loadCompliance } from "../src/services/documentCompliance.service";
import { runDocumentCycle } from "../src/services/documentWatch.service";
import { DispatchService } from "../src/services/dispatch.service";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, info?: any) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && info !== undefined ? "  → " + JSON.stringify(info) : ""}`);
};
const day = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
};
const at = (ymd: string) => new Date(ymd + "T00:00:00Z");

(async () => {
  if (process.env.SMS_DRY_RUN !== "true") {
    console.error("Run with SMS_DRY_RUN=true (ops alerts would be sent).");
    process.exit(1);
  }
  // TEST_PRISMA_WASM: sandbox-only switch (no native Prisma engine available there).
  let pool: any = null;
  let prisma: any;
  if (process.env.TEST_PRISMA_WASM) {
    const { Pool } = require("pg");
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { PrismaClient } = require(process.env.TEST_PRISMA_WASM);
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  } else {
    prisma = new NativePrismaClient();
  }
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  redis.on("error", () => {});
  try {
    await redis.connect();
    await redis.ping();
  } catch {
    console.error("Local Redis isn't running. Start it (docker compose up -d redis) and run again.");
    process.exit(1);
  }
  const tag = String(Date.now()).slice(-6);
  const phone = (n: number) => `+4479100${tag}`.slice(0, 11) + String(n).padStart(2, "0");
  const created = { users: [] as string[], drivers: [] as string[], vehicles: [] as string[], bookings: [] as string[] };

  // Stubs: maps, push (counted)
  (MapsService.prototype as any).getDirections = async () => ({ distanceKm: 10, durationMinutes: 20 });
  const pushes: { userId: string; title: string; body: string; type?: string }[] = [];
  const { NotificationService } = require("../src/services/notification.service");
  for (const k of Object.getOwnPropertyNames(NotificationService.prototype))
    if (k !== "constructor") NotificationService.prototype[k] = async () => 0;
  NotificationService.prototype.sendToUser = async (userId: string, msg: any) => {
    pushes.push({ userId, title: msg.title, body: msg.body, type: msg.data?.type });
    return 1;
  };
  const pushesTo = (userId: string, type: string) => pushes.filter((p) => p.userId === userId && p.type === type);

  const admin = await prisma.user.create({ data: { phone: phone(90), firstName: "Admin", lastName: "T", roles: ["ADMIN"] } });
  created.users.push(admin.id);
  async function mkDriver(n: number, first: string) {
    const u = await prisma.user.create({ data: { phone: phone(n), firstName: first, lastName: "Test", roles: ["DRIVER"] } });
    const d = await prisma.driver.create({ data: { userId: u.id, pcoBadgeNumber: `PCO${tag}${n}`, pcoLicenseExpiry: at("2099-01-01"), drivingLicenseNumber: "X" } });
    created.users.push(u.id); created.drivers.push(d.id);
    return { ...d, userId: u.id };
  }
  const kapil = await mkDriver(91, "Kapil");
  const other = await mkDriver(92, "Other");
  const car = await prisma.vehicle.create({
    data: { driverId: kapil.id, make: "Tesla", model: "Y", year: 2022, colour: "White", licensePlate: `DT${tag}A`,
      motExpiry: at("2099-01-01"), insuranceExpiry: at("2099-01-01"), phvLicenceNumber: "PHV1" },
  });
  const car2 = await prisma.vehicle.create({
    data: { make: "Toyota", model: "Prius", year: 2020, colour: "Black", licensePlate: `DT${tag}B`,
      motExpiry: at("2099-01-01"), insuranceExpiry: at("2099-01-01") },
  });
  created.vehicles.push(car.id, car2.id);

  // "who is calling" for driver routes
  let currentDriverUser = kapil.userId;
  const f = Fastify();
  f.decorate("prisma", prisma);
  f.decorate("redis", redis as any);
  f.decorate("io", { to: () => ({ emit: () => {} }) } as any);
  f.decorate("authenticateAdmin", async (req: any) => { req.user = { userId: admin.id }; });
  f.decorate("authenticate", async (req: any) => { req.user = { userId: currentDriverUser }; });
  f.decorate("authenticatePassenger", async () => {});
  f.decorate("authenticateDriver", async (req: any) => { req.user = { userId: currentDriverUser }; });
  f.setErrorHandler((error: any, _req, reply) => {
    reply.status(error.statusCode ?? 500).send({ success: false, error: error.message });
  });
  await f.register(driverRoutes, { prefix: "/api/v1" });
  await f.register(scheduledBookingRoutes, { prefix: "/api/v1" });
  await f.register(adminDocumentRoutes, { prefix: "/api/v1" });
  await f.ready();
  const req = (method: any, url: string, payload?: any) => f.inject({ method, url: `/api/v1${url}`, payload });

  const cycle = (opts: { now?: Date } = {}) =>
    runDocumentCycle({ prisma, redis: redis as any, log: { warn: () => {} }, io: { to: () => ({ emit: () => {} }) }, onlyDriverIds: [kapil.id, other.id], ...opts });

  try {
    // ── Seed Kapil's documents (approved) ──
    const files = (n: string) => [`https://example.test/${tag}/${n}.jpg`];
    const approve = async (type: any, expiry: string | null, owner: any = { driverId: kapil.id }) => {
      const d = await addDocumentVersion(prisma, { type, files: files(type), ...owner, uploadedBy: admin.id });
      return reviewDocument(prisma, { docId: d.id, decision: "approve", expiryDate: expiry ? at(expiry) : null, adminUserId: admin.id });
    };
    await approve("PCO_LICENSE", day(300));
    await approve("DRIVING_LICENSE", null);
    await approve("DRIVING_LICENSE_BACK", null);
    await approve("DBS_CHECK", null);
    await approve("PHV_LICENCE", day(200));
    const ins1 = await approve("VEHICLE_INSURANCE", day(10));
    await approve("MOT_CERTIFICATE", day(100));
    await approve("V5C_LOGBOOK", null);

    let c = await loadCompliance(prisma, kapil.id);
    check("all approved → eligible", !!c?.eligible, c?.problems);
    check("insurance doc is on the car, not the driver", ins1.vehicleId === car.id && ins1.driverId === kapil.id, ins1);
    let v = await prisma.vehicle.findUnique({ where: { id: car.id } });
    check("approve copies insurance date to Vehicles record", v.insuranceExpiry.toISOString().slice(0, 10) === day(10), v.insuranceExpiry);
    const drv = await prisma.driver.findUnique({ where: { id: kapil.id } });
    check("approve copies PCO date to driver record", drv.pcoLicenseExpiry.toISOString().slice(0, 10) === day(300));

    // ── Review rules ──
    let err = "";
    const pco2 = await addDocumentVersion(prisma, { type: "PCO_LICENSE", files: files("pco2"), driverId: kapil.id, uploadedBy: kapil.userId });
    try { await reviewDocument(prisma, { docId: pco2.id, decision: "approve", adminUserId: admin.id }); } catch (e: any) { err = e.message; }
    check("approve PCO without expiry → refused", /expiry date/i.test(err), err);
    err = "";
    try { await reviewDocument(prisma, { docId: pco2.id, decision: "approve", expiryDate: at(day(-2)), adminUserId: admin.id }); } catch (e: any) { err = e.message; }
    check("approve with a past date → refused", /has passed/i.test(err), err);
    err = "";
    try { await reviewDocument(prisma, { docId: pco2.id, decision: "reject", adminUserId: admin.id }); } catch (e: any) { err = e.message; }
    check("reject without reason → refused", /reason/i.test(err), err);
    const rej = await reviewDocument(prisma, { docId: pco2.id, decision: "reject", rejectionReason: "Photo is blurry", adminUserId: admin.id });
    check("reject stores reason", rej.status === "REJECTED" && rej.rejectionReason === "Photo is blurry");
    c = await loadCompliance(prisma, kapil.id);
    check("rejected renewal doesn't remove the valid PCO", !!c?.eligible);

    // ── Renewal via driver app endpoint data ──
    const ins2 = await addDocumentVersion(prisma, { type: "VEHICLE_INSURANCE", files: [...files("ins2a"), ...files("ins2b")], driverId: kapil.id, expiryDate: at(day(375)), uploadedBy: kapil.userId });
    check("renewal: pages stored", ins2.pageUrls.length === 1 && ins2.vehicleId === car.id, ins2);
    c = await loadCompliance(prisma, kapil.id);
    check("renewal pending, old valid → still eligible", !!c?.eligible);
    let r = await req("GET", "/drivers/documents");
    const listed = r.json().data.find((d: any) => d.type === "VEHICLE_INSURANCE");
    check("GET /drivers/documents shows the renewal waiting (PENDING) for insurance", listed?.status === "PENDING" && listed?.id === ins2.id, listed);
    const listedPco = r.json().data.find((d: any) => d.type === "PCO_LICENSE");
    check("GET /drivers/documents shows rejection reason (old app field)", listedPco?.status === "REJECTED" && listedPco?.rejectionReason === "Photo is blurry", listedPco);

    // second upload while first still waiting → first replaced
    const ins3 = await addDocumentVersion(prisma, { type: "VEHICLE_INSURANCE", files: files("ins3"), driverId: kapil.id, uploadedBy: kapil.userId });
    const ins2b = await prisma.driverDocument.findUnique({ where: { id: ins2.id } });
    check("newer upload replaces the one still waiting", ins2b.replacedById === ins3.id);
    err = "";
    try { await reviewDocument(prisma, { docId: ins2.id, decision: "approve", expiryDate: at(day(375)), adminUserId: admin.id }); } catch (e: any) { err = e.message; }
    check("reviewing a replaced upload → refused", /newer version/i.test(err), err);

    await reviewDocument(prisma, { docId: ins3.id, decision: "approve", expiryDate: at(day(380)), adminUserId: admin.id });
    const old = await prisma.driverDocument.findUnique({ where: { id: ins1.id } });
    check("approving renewal marks the old version replaced (kept)", old.replacedById === ins3.id && !old.archivedAt);
    v = await prisma.vehicle.findUnique({ where: { id: car.id } });
    check("Vehicles record follows the renewal", v.insuranceExpiry.toISOString().slice(0, 10) === day(380));

    // ── Admin panel + lists ──
    r = await req("GET", `/admin/documents/panel?driverId=${kapil.id}`);
    const panel = r.json().data;
    check("panel: 8 items, all valid", panel.items.length === 8 && panel.items.every((i: any) => i.state === "valid"), panel.items?.map((i: any) => i.state));
    check("panel: history has old insurance", panel.history.some((h: any) => h.id === ins1.id));
    r = await req("GET", `/admin/documents?view=rejected&driverId=${kapil.id}`);
    check("admin list rejected view", r.json().data.some((d: any) => d.id === pco2.id && d.owner.kind === "driver"));
    r = await req("GET", `/admin/documents?view=current&vehicleId=${car.id}`);
    check("admin list: vehicle docs labelled with car + driver", r.json().data.every((d: any) => d.owner.label.startsWith(car.licensePlate) && d.owner.label.includes("Kapil")), r.json().data.map((d: any) => d.owner.label));

    // ── Expire the MOT ──
    const mot = await prisma.driverDocument.findFirst({ where: { vehicleId: car.id, type: "MOT_CERTIFICATE", status: "APPROVED", replacedAt: null } });
    await prisma.driverDocument.update({ where: { id: mot.id }, data: { expiryDate: at(day(-1)) } });
    c = await loadCompliance(prisma, kapil.id);
    check("expired MOT → not eligible", !c?.eligible && c?.problems[0]?.type === "MOT_CERTIFICATE");
    r = await req("GET", "/driver/dispatch-eligibility");
    const el = r.json();
    check("eligibility: old fields + message", el.eligible === false && el.expiredDocs.includes("MOT_CERTIFICATE") && el.message.includes(car.licensePlate), el);

    // shadow mode: going online allowed
    delete process.env.DOCUMENT_GATING_ENABLED;
    r = await req("PATCH", "/drivers/status", { status: "AVAILABLE" });
    check("shadow: go online allowed", r.statusCode === 200, r.json());
    // assigned scheduled job
    const job = await prisma.booking.create({
      data: { reference: `DT${tag}J`, type: "PREBOOKED", status: "DRIVER_ASSIGNED", driverId: kapil.id, vehicleId: car.id, claimedAt: new Date(),
        scheduledAt: new Date(Date.now() + 30 * 3_600_000), pickupAddress: "A", pickupLatitude: 51.15, pickupLongitude: -0.16,
        dropoffAddress: "B", dropoffLatitude: 51.11, dropoffLongitude: -0.15, estimatedFare: 20 },
    });
    created.bookings.push(job.id);
    await cycle();
    let kd = await prisma.driver.findUnique({ where: { id: kapil.id } });
    let jb = await prisma.booking.findUnique({ where: { id: job.id } });
    check("shadow cycle: driver stays online, job stays assigned", kd.status === "AVAILABLE" && jb.status === "DRIVER_ASSIGNED" && jb.driverId === kapil.id, { s: kd.status, j: jb.status });
    const open = await prisma.booking.create({
      data: { reference: `DT${tag}O`, type: "PREBOOKED", status: "SCHEDULED_OPEN", scheduledAt: new Date(Date.now() + 50 * 3_600_000),
        pickupAddress: "A", pickupLatitude: 51.15, pickupLongitude: -0.16, dropoffAddress: "B", dropoffLatitude: 51.11, dropoffLongitude: -0.15, estimatedFare: 20 },
    });
    created.bookings.push(open.id);
    r = await req("GET", "/bookings/scheduled/open");
    check("shadow: job board still lists jobs", r.json().data.some((j: any) => j.id === open.id));

    // enforced
    process.env.DOCUMENT_GATING_ENABLED = "true";
    await prisma.driver.update({ where: { id: kapil.id }, data: { status: "OFFLINE" } });
    r = await req("PATCH", "/drivers/status", { status: "AVAILABLE" });
    check("enforced: go online → 403 with reason", r.statusCode === 403 && /MOT/.test(r.json().error), r.json());
    r = await req("GET", "/bookings/scheduled/open");
    check("enforced: job board empty + blocked message", r.json().data.length === 0 && r.json().blocked?.reason === "documents", r.json());
    r = await req("POST", `/bookings/${open.id}/claim`, { latitude: 51.15, longitude: -0.16 });
    check("enforced: claim → 403 documents", r.statusCode === 403 && r.json().error === "documents", r.json());
    const dispatch = new DispatchService(prisma, redis as any, { to: () => ({ emit: () => {} }) } as any, new MapsService());
    err = "";
    await prisma.driver.update({ where: { id: kapil.id }, data: { status: "AVAILABLE" } });
    try { await dispatch.manualAssign(open.id, kapil.id); } catch (e: any) { err = e.message; }
    check("enforced: manual assign refused", /documents are not in order/i.test(err), err);
    r = await req("PATCH", `/drivers/jobs/${job.id}/status`, { status: "DRIVER_EN_ROUTE" });
    check("enforced: setting off → 403", r.statusCode === 403, r.json());

    await cycle();
    kd = await prisma.driver.findUnique({ where: { id: kapil.id } });
    jb = await prisma.booking.findUnique({ where: { id: job.id } });
    check("enforced cycle: driver set OFFLINE", kd.status === "OFFLINE", kd.status);
    check("enforced cycle: accepted job back on job board", jb.status === "SCHEDULED_OPEN" && jb.driverId === null && jb.vehicleId === null, jb);
    check("driver told about the job", pushesTo(kapil.userId, "DOCUMENT_JOB_REMOVED").length === 1);

    // Renew the MOT → eligible again
    const mot2 = await addDocumentVersion(prisma, { type: "MOT_CERTIFICATE", files: files("mot2"), driverId: kapil.id, uploadedBy: kapil.userId });
    c = await loadCompliance(prisma, kapil.id);
    check("expired + renewal waiting → still blocked", !c?.eligible);
    await reviewDocument(prisma, { docId: mot2.id, decision: "approve", expiryDate: at(day(365)), adminUserId: admin.id });
    c = await loadCompliance(prisma, kapil.id);
    check("MOT renewal approved → eligible", !!c?.eligible, c?.problems);
    r = await req("PATCH", "/drivers/status", { status: "AVAILABLE" });
    check("go online allowed again", r.statusCode === 200, r.json());

    // ── Reminders: expiring in 10 days → 14-day reminder once ──
    const pcoCur = await prisma.driverDocument.findFirst({ where: { driverId: kapil.id, vehicleId: null, type: "PCO_LICENSE", status: "APPROVED", replacedAt: null } });
    await prisma.driverDocument.update({ where: { id: pcoCur.id }, data: { expiryDate: at(day(10)), lastReminderDays: null } });
    const noon = new Date(); noon.setUTCHours(11, 0, 0, 0); // daytime UK
    pushes.length = 0;
    await cycle({ now: noon });
    await cycle({ now: noon });
    const rem = pushesTo(kapil.userId, "DOCUMENT_EXPIRING");
    const pcoAfter = await prisma.driverDocument.findUnique({ where: { id: pcoCur.id } });
    check("reminder sent once (14-day)", rem.length === 1 && pcoAfter.lastReminderDays === 14, { n: rem.length, last: pcoAfter.lastReminderDays });
    const night = new Date(noon); night.setUTCHours(1, 0, 0, 0);
    await prisma.driverDocument.update({ where: { id: pcoCur.id }, data: { lastReminderDays: null } });
    pushes.length = 0;
    await cycle({ now: night });
    check("no reminders at night", pushesTo(kapil.userId, "DOCUMENT_EXPIRING").length === 0);
    await prisma.driverDocument.update({ where: { id: pcoCur.id }, data: { expiryDate: at(day(300)), lastReminderDays: null } });

    // ── 48 h warning: job tomorrow, insurance expires today ──
    const soonJob = await prisma.booking.create({
      data: { reference: `DT${tag}W`, type: "PREBOOKED", status: "DRIVER_ASSIGNED", driverId: kapil.id, vehicleId: car.id, claimedAt: new Date(),
        scheduledAt: new Date(Date.now() + 36 * 3_600_000), pickupAddress: "A", pickupLatitude: 51.15, pickupLongitude: -0.16,
        dropoffAddress: "B", dropoffLatitude: 51.11, dropoffLongitude: -0.15, estimatedFare: 20 },
    });
    created.bookings.push(soonJob.id);
    await prisma.driverDocument.update({ where: { id: ins3.id }, data: { expiryDate: at(day(0)) } });
    pushes.length = 0;
    await cycle();
    await cycle();
    const warn = pushes.filter((p) => p.userId === kapil.userId && /before your job/.test(p.title));
    check("48 h warning sent once", warn.length === 1, pushes);
    check("job still assigned while documents valid", (await prisma.booking.findUnique({ where: { id: soonJob.id } })).status === "DRIVER_ASSIGNED");

    // ── Car change: documents follow the car ──
    await prisma.vehicle.update({ where: { id: car.id }, data: { driverId: null } });
    await prisma.vehicle.update({ where: { id: car.id }, data: { driverId: other.id } });
    const cOther = await loadCompliance(prisma, other.id);
    const vehicleItems = cOther?.items.filter((i) => i.owner === "vehicle") ?? [];
    check("other driver with Kapil's car: car documents count, driver documents missing",
      vehicleItems.length === 4 && vehicleItems.every((i) => i.state === "valid") && !!cOther?.problems.every((p) => p.owner === "driver"), cOther?.problems.map((p) => p.type));
    c = await loadCompliance(prisma, kapil.id);
    check("Kapil without a car → not eligible (no vehicle)", !c?.eligible && !!c?.noVehicle);
    err = "";
    try { await addDocumentVersion(prisma, { type: "MOT_CERTIFICATE", files: files("x"), driverId: kapil.id, uploadedBy: kapil.userId }); } catch (e: any) { err = e instanceof DocumentError ? e.message : String(e); }
    check("vehicle document upload without a car → refused", /No vehicle/i.test(err), err);
  } catch (e) {
    fail++;
    console.error("ERROR", e);
  } finally {
    delete process.env.DOCUMENT_GATING_ENABLED;
    await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: { in: created.bookings } } });
    await prisma.booking.deleteMany({ where: { id: { in: created.bookings } } });
    await prisma.driverDocument.deleteMany({ where: { OR: [{ driverId: { in: created.drivers } }, { vehicleId: { in: created.vehicles } }] } });
    await prisma.vehicle.deleteMany({ where: { id: { in: created.vehicles } } });
    await prisma.driver.deleteMany({ where: { id: { in: created.drivers } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    await redis.srem("drivers:online", ...created.drivers).catch(() => 0);
    await f.close();
    await prisma.$disconnect();
    redis.disconnect();
    if (pool) await pool.end();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
