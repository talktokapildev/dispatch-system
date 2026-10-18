// backend/scripts/test-driver-register.ts
//
// TfL driver register end to end against the LOCAL database and LOCAL Redis: register details,
// archive (leaving), restore (restart), correcting periods, 12-month delete, application archive
// and the printable TfL record. Cloudinary deletes are stubbed; SMS must be dry-run.
// Creates its own users / drivers / vehicles / bookings and deletes them afterwards.
//
//   SMS_DRY_RUN=true node --env-file=.env -r ts-node/register scripts/test-driver-register.ts
//
// Expect: all PASS, 0 failed.
import type {} from "../src/plugins/database";
import type {} from "../src/plugins/auth";
import type {} from "../src/plugins/socket";
import Fastify from "fastify";
import Redis from "ioredis";
import { PrismaClient as NativePrismaClient } from "@prisma/client";
import { driverRoutes } from "../src/routes/drivers";
import { adminDriverRegisterRoutes } from "../src/routes/admin/driverRegister";
import { adminDriverApplicationRoutes } from "../src/routes/admin/driver-applications";
import { RedisKeys } from "../src/plugins/redis";
import { addMonths, dayKey, parseDay, ukToday } from "../src/services/driverRegisterRules";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, info?: any) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && info !== undefined ? "  → " + JSON.stringify(info) : ""}`);
};
const today = () => dayKey(ukToday());
const daysAgo = (n: number) => dayKey(new Date(ukToday().getTime() - n * 86_400_000));

(async () => {
  if (process.env.SMS_DRY_RUN !== "true") {
    console.error("Run with SMS_DRY_RUN=true (ops alerts would be sent).");
    process.exit(1);
  }
  process.env.FILE_TOKEN_SECRET ||= "t".repeat(40);
  process.env.CLOUDINARY_CLOUD_NAME ||= "testcloud";
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
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { lazyConnect: true, maxRetriesPerRequest: 1 });
  redis.on("error", () => {});
  try {
    await redis.connect();
    await redis.ping();
  } catch {
    console.error("Local Redis isn't running. Start it (docker compose up -d redis) and run again.");
    process.exit(1);
  }

  // Stub Cloudinary deletes (count them)
  const deleted: string[] = [];
  const storage = require("../src/services/fileStorage");
  storage.deleteStoredFile = async (v: string) => {
    deleted.push(v);
    return true;
  };
  const logs: string[] = [];
  const log = { warn: (m: string) => logs.push(m), error: () => {}, info: () => {}, debug: () => {}, child: () => log } as any;

  const tag = String(Date.now()).slice(-6);
  const phone = (n: number) => `+4479200${tag}`.slice(0, 11) + String(n).padStart(2, "0");
  const created = { users: [] as string[], drivers: [] as string[], vehicles: [] as string[], bookings: [] as string[], apps: [] as string[] };

  const admin = await prisma.user.create({ data: { phone: phone(90), firstName: "Admin", lastName: "Tester", roles: ["ADMIN"] } });
  created.users.push(admin.id);
  const car = await prisma.vehicle.create({
    data: { make: "Tesla", model: "Y", year: 2022, colour: "White", licensePlate: `DR${tag}A`,
      motExpiry: new Date("2099-01-01"), insuranceExpiry: new Date("2099-01-01") },
  });
  created.vehicles.push(car.id);

  const f = Fastify({ logger: false });
  f.decorate("prisma", prisma);
  f.decorate("redis", redis as any);
  f.decorate("io", { to: () => ({ emit: () => {} }), in: () => ({ disconnectSockets: () => {} }) } as any);
  f.decorate("authenticateAdmin", async (req: any) => { req.user = { userId: admin.id }; });
  f.decorate("authenticate", async () => {});
  f.decorate("authenticatePassenger", async () => {});
  f.decorate("authenticateDriver", async () => {});
  (f as any).log = log;
  f.setErrorHandler((error: any, _req, reply) => {
    reply.status(error.statusCode ?? 500).send({ success: false, error: error.message });
  });
  await f.register(driverRoutes, { prefix: "/api/v1" });
  await f.register(adminDriverRegisterRoutes, { prefix: "/api/v1" });
  await f.register(adminDriverApplicationRoutes, { prefix: "/api/v1" });
  await f.ready();
  const req = (method: any, url: string, payload?: any) => f.inject({ method, url: `/api/v1${url}`, payload });

  async function addDriver(n: number, first: string, availableFrom?: string) {
    const r = await req("POST", "/admin/drivers", {
      firstName: first, lastName: "Reg", phone: phone(n), pcoBadgeNumber: `PCO${tag}${n}`,
      pcoLicenseExpiry: "2099-01-01", drivingLicenseNumber: "REG123", ...(availableFrom && { availableFrom }),
    });
    const body = r.json();
    if (r.statusCode !== 201) throw new Error("create driver failed " + JSON.stringify(body));
    created.users.push(body.data.user.id);
    created.drivers.push(body.data.driver.id);
    return { id: body.data.driver.id as string, userId: body.data.user.id as string };
  }
  const booking = async (ref: string, driverId: string | null, status: string, hoursAhead: number | null) => {
    const b = await prisma.booking.create({
      data: { reference: `DR${tag}${ref}`, type: hoursAhead === null ? "ASAP" : "PREBOOKED", status, driverId,
        scheduledAt: hoursAhead === null ? null : new Date(Date.now() + hoursAhead * 3_600_000),
        pickupAddress: "A", pickupLatitude: 51.15, pickupLongitude: -0.16, dropoffAddress: "B",
        dropoffLatitude: 51.11, dropoffLongitude: -0.15, estimatedFare: 20, driverPhvLicenceNumber: "PHV-X" },
    });
    created.bookings.push(b.id);
    return b;
  };

  try {
    // ── Register details ──
    const a = await addDriver(1, "Alice", daysAgo(400));
    let r = await req("GET", `/admin/drivers/${a.id}/register`);
    let reg = r.json().data;
    check("new driver: first available = chosen date, active", reg.dates.firstAvailable === daysAgo(400) && reg.dates.active && reg.engagements.length === 1, reg.dates);
    check("new driver: register fields missing, licence check due", reg.warnings.missing.length === 4 && reg.warnings.licenceCheckDue);

    r = await req("PUT", `/admin/drivers/${a.id}/register`, {
      middleNames: "Mary", callSign: `a${tag}`.slice(0, 10), address: "1 High St, Crawley", postcode: "rh10 1aa",
      dateOfBirth: "1985-06-15", niNumber: "ab 12 34 56 c", licenceCheckedAt: daysAgo(10),
    });
    reg = r.json().data;
    check("save register: normalised", r.statusCode === 200 && reg.register.postcode === "RH10 1AA" && reg.register.niNumber === "AB 12 34 56 C" && reg.register.address === "1 High St\nCrawley" && reg.warnings.missing.length === 0 && !reg.warnings.licenceCheckDue, reg);
    r = await req("PUT", `/admin/drivers/${a.id}/register`, { postcode: "nope" });
    check("bad postcode → 400", r.statusCode === 400 && /postcode/i.test(r.json().error), r.json());
    r = await req("PUT", `/admin/drivers/${a.id}/register`, { dateOfBirth: daysAgo(365 * 19) });
    check("under 21 → saved with warning", r.statusCode === 200 && r.json().data.warnings.underAge === true);
    await req("PUT", `/admin/drivers/${a.id}/register`, { dateOfBirth: "1985-06-15" });

    const b = await addDriver(2, "Bob", daysAgo(100));
    r = await req("PUT", `/admin/drivers/${b.id}/register`, { callSign: `a${tag}`.slice(0, 10) });
    check("call sign clash → 409 naming the driver", r.statusCode === 409 && /Alice/.test(r.json().error), r.json());

    r = await req("GET", "/admin/drivers");
    const listJson = r.body;
    const rowA = r.json().data.items.find((d: any) => d.id === a.id);
    check("list: call sign shown, NI/DOB/address never included", rowA?.callSign === `A${tag}`.slice(0, 10) && !listJson.includes("AB123456C") && !listJson.includes("High St") && !("register" in rowA && rowA.register?.niNumber), rowA?.register);
    const full = await prisma.driver.findUnique({ where: { id: a.id }, include: { user: true, vehicle: true } });
    check("a whole Driver row (as in booking responses) has no register details", !JSON.stringify(full).includes("AB123456C"));

    // ── Archive ──
    await prisma.vehicle.update({ where: { id: car.id }, data: { driverId: a.id } });
    await prisma.refreshToken.create({ data: { userId: a.userId, token: `rt-${tag}`, expiresAt: new Date(Date.now() + 86_400_000) } });
    const trip = await booking("T", a.id, "IN_PROGRESS", null);
    const job = await booking("J", a.id, "DRIVER_ASSIGNED", 48);
    r = await req("POST", `/admin/drivers/${a.id}/archive`, { leftOn: today(), reason: "Moved away" });
    check("archive refused while on a trip", r.statusCode === 409 && r.json().error.includes(trip.reference), r.json());
    await prisma.booking.update({ where: { id: trip.id }, data: { status: "COMPLETED" } });
    r = await req("POST", `/admin/drivers/${a.id}/archive`, { leftOn: daysAgo(-1), reason: "Moved away" });
    check("future leaving date → 400", r.statusCode === 400);
    r = await req("POST", `/admin/drivers/${a.id}/archive`, { leftOn: today(), reason: "" });
    check("no reason → 400", r.statusCode === 400);
    logs.length = 0;
    r = await req("POST", `/admin/drivers/${a.id}/archive`, { leftOn: today(), reason: "Dismissed", dismissedForConduct: true, notes: "Complaint 12" });
    check("archive OK, job returned", r.statusCode === 200 && r.json().data.unassigned.includes(job.reference), r.json());
    const ad = await prisma.driver.findUnique({ where: { id: a.id } });
    const aj = await prisma.booking.findUnique({ where: { id: job.id } });
    const av = await prisma.vehicle.findUnique({ where: { id: car.id } });
    check("archived + offline", !!ad.archivedAt && ad.status === "OFFLINE");
    check("accepted pre-booked job back on the board", aj.status === "SCHEDULED_OPEN" && aj.driverId === null && aj.driverPhvLicenceNumber === null, aj.status);
    check("car unassigned", av.driverId === null);
    check("signed out (refresh tokens gone)", (await prisma.refreshToken.count({ where: { userId: a.userId } })) === 0);
    check("app tokens refused (Redis flag set)", (await redis.exists(RedisKeys.archivedDriver(a.userId))) === 1);
    check("dismissal → ops alert with TfL deadline", logs.some((l) => /dismissed for conduct.*Notify TfL by/.test(l)), logs);
    reg = (await req("GET", `/admin/drivers/${a.id}/register`)).json().data;
    const deletableExpected = dayKey(addMonths(parseDay(today())!, 12));
    check("period closed with reason; deletable in 12 months", reg.engagements[0].endedAt === today() && reg.engagements[0].endReason === "Dismissed" && reg.engagements[0].dismissedForConduct && reg.deletableFrom === deletableExpected && !reg.canDelete, reg);
    r = await req("POST", `/admin/drivers/${a.id}/archive`, { leftOn: today(), reason: "again" });
    check("archive twice → 409", r.statusCode === 409);

    // ── TfL Records dropdown ──
    r = await req("GET", "/admin/tfl-records/drivers");
    let opts = r.json().data;
    const optA = opts.find((o: any) => o.id === a.id);
    const optB = opts.find((o: any) => o.id === b.id);
    check("dropdown: current driver first, left driver with kept-until date",
      !!optB && !optB.left && !!optA && optA.left && optA.leftOn === today() && optA.keptUntil === deletableExpected &&
      opts.indexOf(optB) < opts.indexOf(optA) && optA.name === "Alice Mary Reg", { optA, optB });

    // ── Delete before 12 months ──
    r = await req("DELETE", `/admin/drivers/${a.id}`, { confirmName: "Alice Reg" });
    check("delete before 12 months → 409 with the date", r.statusCode === 409 && r.json().error.includes("can be deleted from"), r.json());

    // ── Correct periods ──
    const eng = reg.engagements[0];
    r = await req("PATCH", `/admin/drivers/${a.id}/engagements/${eng.id}`, { endedAt: null });
    check("left driver: can't reopen a period → 400", r.statusCode === 400, r.json());
    r = await req("PATCH", `/admin/drivers/${a.id}/engagements/${eng.id}`, { endedAt: daysAgo(401) });
    check("finish before start → 400", r.statusCode === 400);
    r = await req("PATCH", `/admin/drivers/${a.id}/engagements/${eng.id}`, { endedAt: daysAgo(370) });
    reg = r.json().data;
    check("correct leaving date → can delete now", r.statusCode === 200 && reg.canDelete === true, reg);
    opts = (await req("GET", "/admin/tfl-records/drivers")).json().data;
    check("dropdown: driver past the 12 months no longer listed", !opts.some((o: any) => o.id === a.id));

    // ── Printable TfL record (left driver) ──
    await prisma.driverDocument.create({ data: { driverId: a.id, type: "DRIVING_LICENSE", status: "APPROVED", reviewedAt: new Date(),
      fileUrl: "cld:authenticated:image:jpg:drivers/documents/front", expiryDate: new Date("2030-01-01") } });
    await prisma.driverDocument.create({ data: { driverId: a.id, type: "PCO_LICENSE", status: "APPROVED", reviewedAt: new Date(),
      fileUrl: "cld:authenticated:image:pdf:drivers/documents/pco", expiryDate: new Date("2027-01-01") } });
    r = await req("GET", `/admin/drivers/${a.id}/tfl-record`);
    const rec = r.json().data;
    check("record: names, NI, postcode, dates", rec.driver.surname === "Reg" && rec.driver.firstAndMiddleNames === "Alice Mary" && rec.driver.niNumber === "AB 12 34 56 C" && rec.driver.postcode === "RH10 1AA" && rec.dates.dateOfLeaving !== null && rec.dates.restarts.length === 0, rec.driver);
    const dl = rec.enclosures[0];
    const ph = rec.enclosures[1];
    check("record: licence copies on file as signed links (back page missing)", dl.parts[0].pages.length === 1 && dl.parts[0].pages[0].includes("/files/page-1.jpg?t=") && dl.parts[1].state === "missing" && !dl.onFile && ph.onFile && ph.parts[0].pages[0].includes(".pdf?t="), rec.enclosures);
    check("record: no storage refs leak", !r.body.includes("cld:") && !r.body.includes("res.cloudinary.com"));
    check("record: operator + printed by", !!rec.operator.name && rec.printedBy === "Admin Tester");
    check("record: no profile photo flagged", rec.checks.photoMissing === true);

    // ── Permanent delete ──
    const app = await prisma.driverApplication.create({ data: { name: "Alice Reg", phone: phone(1), pcoBadgeNumber: "X", pcoBadgeExpiry: new Date("2099-01-01"),
      drivingLicenceNumber: "X", vehicleMake: "T", vehicleModel: "Y", vehicleReg: "X1", vehicleYear: 2022, vehicleColour: "W", status: "APPROVED",
      docPcoBadge: "cld:authenticated:image:jpg:driver-applications/pco-badge/x", docInsurance: ["cld:authenticated:image:pdf:driver-applications/insurance/y"] } });
    created.apps.push(app.id);
    r = await req("DELETE", `/admin/drivers/${a.id}`, { confirmName: "Alice" });
    check("wrong name → 400", r.statusCode === 400, r.json());
    deleted.length = 0;
    r = await req("DELETE", `/admin/drivers/${a.id}`, { confirmName: "alice reg" });
    check("delete OK", r.statusCode === 200, r.json());
    check("driver, register, periods, application gone", !(await prisma.driver.findUnique({ where: { id: a.id } })) && (await prisma.driverRegister.count({ where: { driverId: a.id } })) === 0 && (await prisma.driverEngagement.count({ where: { driverId: a.id } })) === 0 && !(await prisma.driverApplication.findUnique({ where: { id: app.id } })));
    const kept = await prisma.booking.findUnique({ where: { id: trip.id } });
    check("bookings kept with PHV number, driver cleared", kept && kept.driverId === null && kept.driverPhvLicenceNumber === "PHV-X");
    check("car kept", !!(await prisma.vehicle.findUnique({ where: { id: car.id } })));
    check("their files deleted from storage (2 documents + 2 application files)", deleted.length === 4, deleted);
    check("user removed (driver-only account)", !(await prisma.user.findUnique({ where: { id: a.userId } })));

    // ── Restore ──
    r = await req("POST", `/admin/drivers/${b.id}/archive`, { leftOn: daysAgo(30), reason: "Break" });
    check("archive Bob (30 days ago)", r.statusCode === 200, r.json());
    r = await req("POST", `/admin/drivers/${b.id}/restore`, { restartOn: daysAgo(40) });
    check("restore before leaving date → 400", r.statusCode === 400, r.json());
    r = await req("POST", `/admin/drivers/${b.id}/restore`, { restartOn: today() });
    reg = r.json().data;
    check("restore OK: active again, 2 periods", r.statusCode === 200 && reg.dates.active && reg.engagements.length === 2, reg);
    check("Redis flag cleared", (await redis.exists(RedisKeys.archivedDriver(b.userId))) === 0);
    const rec2 = (await req("GET", `/admin/drivers/${b.id}/tfl-record`)).json().data;
    check("record: one restart row, open finish", rec2.dates.restarts.length === 1 && rec2.dates.restarts[0].finish === null, rec2.dates);
    r = await req("DELETE", `/admin/drivers/${b.id}`, { confirmName: "Bob Reg" });
    check("active driver can't be deleted → 409", r.statusCode === 409);

    // ── Application archive → driver leaves ──
    const c = await addDriver(3, "Cara");
    const capp = await prisma.driverApplication.create({ data: { name: "Cara Reg", phone: phone(3), pcoBadgeNumber: "X", pcoBadgeExpiry: new Date("2099-01-01"),
      drivingLicenceNumber: "X", vehicleMake: "T", vehicleModel: "Y", vehicleReg: "X3", vehicleYear: 2022, vehicleColour: "W", status: "APPROVED" } });
    created.apps.push(capp.id);
    r = await req("DELETE", `/admin/driver-applications/${capp.id}`);
    const creg = (await req("GET", `/admin/drivers/${c.id}/register`)).json().data;
    check("archiving the application archives the driver with a leaving date", r.statusCode === 200 && creg.archived && creg.engagements[0].endReason === "Driver application archived" && creg.dates.leftOn === today(), creg);
    r = await req("DELETE", `/admin/driver-applications/${capp.id}/permanent`, { confirmName: "Cara Reg" });
    check("application permanent delete within 12 months → 409", r.statusCode === 409 && /12 months/.test(r.json().error), r.json());
  } catch (err) {
    fail++;
    console.log("FAIL  crashed", err);
  } finally {
    await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: { in: created.bookings } } });
    await prisma.booking.deleteMany({ where: { id: { in: created.bookings } } });
    await prisma.driverApplication.deleteMany({ where: { id: { in: created.apps } } });
    await prisma.driverDocument.deleteMany({ where: { driverId: { in: created.drivers } } });
    await prisma.vehicle.deleteMany({ where: { id: { in: created.vehicles } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: created.users } } });
    await prisma.driver.deleteMany({ where: { id: { in: created.drivers } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    for (const u of created.users) await redis.del(RedisKeys.archivedDriver(u));
    await f.close();
    await prisma.$disconnect();
    if (pool) await pool.end();
    redis.disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
