// backend/scripts/test-vehicle-record.ts
//
// Vehicle history (database trigger) + TfL vehicle record, end to end against the LOCAL database
// and LOCAL Redis, through the real admin routes: add a car with a driver, reassign, driver leaves,
// retire, restore, edit start date; then the history endpoints, the TfL Records dropdown and the
// vehicle record. Creates its own data and deletes it afterwards.
//
//   SMS_DRY_RUN=true node --env-file=.env -r ts-node/register scripts/test-vehicle-record.ts
//
// Expect: all PASS, 0 failed.
import type {} from "../src/plugins/database";
import type {} from "../src/plugins/auth";
import type {} from "../src/plugins/socket";
import Fastify from "fastify";
import Redis from "ioredis";
import { PrismaClient as NativePrismaClient } from "@prisma/client";
import { driverRoutes } from "../src/routes/drivers";
import { adminVehicleRoutes } from "../src/routes/admin/vehicles";
import { adminDriverRegisterRoutes } from "../src/routes/admin/driverRegister";
import { adminVehicleRecordRoutes } from "../src/routes/admin/vehicleRecord";
import { RedisKeys } from "../src/plugins/redis";
import { dayKey, ukToday } from "../src/services/driverRegisterRules";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, info?: any) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && info !== undefined ? "  → " + JSON.stringify(info) : ""}`);
};
const daysAgo = (n: number) => dayKey(new Date(ukToday().getTime() - n * 86_400_000));

(async () => {
  if (process.env.SMS_DRY_RUN !== "true") {
    console.error("Run with SMS_DRY_RUN=true (ops alerts would be sent).");
    process.exit(1);
  }
  process.env.FILE_TOKEN_SECRET ||= "t".repeat(40);
  process.env.CLOUDINARY_CLOUD_NAME ||= "testcloud";
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
  const log = { warn: () => {}, error: () => {}, info: () => {}, debug: () => {}, child: () => log } as any;
  const tag = String(Date.now()).slice(-6);
  const phone = (n: number) => `+4479300${tag}`.slice(0, 11) + String(n).padStart(2, "0");
  const created = { users: [] as string[], drivers: [] as string[], vehicles: [] as string[] };

  const admin = await prisma.user.create({ data: { phone: phone(90), firstName: "Admin", lastName: "Veh", roles: ["ADMIN"] } });
  created.users.push(admin.id);

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
  await f.register(adminVehicleRoutes, { prefix: "/api/v1" });
  await f.register(adminDriverRegisterRoutes, { prefix: "/api/v1" });
  await f.register(adminVehicleRecordRoutes, { prefix: "/api/v1" });
  await f.ready();
  const req = (method: any, url: string, payload?: any) => f.inject({ method, url: `/api/v1${url}`, payload });

  async function addDriver(n: number, first: string) {
    const r = await req("POST", "/admin/drivers", {
      firstName: first, lastName: "Veh", phone: phone(n), pcoBadgeNumber: `PV${tag}${n}`,
      pcoLicenseExpiry: "2099-01-01", drivingLicenseNumber: "VEH1", availableFrom: daysAgo(200),
    });
    const body = r.json();
    if (r.statusCode !== 201) throw new Error("create driver failed " + JSON.stringify(body));
    created.users.push(body.data.user.id);
    created.drivers.push(body.data.driver.id);
    return { id: body.data.driver.id as string, userId: body.data.user.id as string };
  }
  const history = async (vehicleId: string) => (await req("GET", `/admin/vehicles/${vehicleId}/history`)).json().data as any[];

  try {
    const ann = await addDriver(1, "Ann");
    const bob = await addDriver(2, "Bob");
    const plate = `VR${tag}`;

    // ── Add a car with a driver ──
    let r = await req("POST", "/admin/vehicles", {
      make: "Tesla", model: "Model Y", year: 2022, colour: "White", licensePlate: plate,
      motExpiry: "2027-05-01", insuranceExpiry: "2026-11-14", keeperName: "Kapil Dev",
      keeperAddress: "8 Riverside Walk\nForge Wood\nCrawley RH10 3SZ", startDate: daysAgo(100),
      phvLicenceNumber: "PHV-123", phvDiscNumber: "D-9", driverId: ann.id,
    });
    check("add car with driver", r.statusCode === 201, r.json());
    const car = r.json().data;
    created.vehicles.push(car.id);
    let h = await history(car.id);
    check("history: Ann from today, open", h.length === 1 && h[0].driverName === "Ann Veh" && !h[0].endedAt);

    // ── Reassign to Bob (Vehicles page) ──
    r = await req("POST", `/admin/vehicles/${car.id}/assign`, { driverId: bob.id });
    check("assign to Bob", r.statusCode === 200, r.json());
    h = await history(car.id);
    check("history: Ann closed 'Reassigned', Bob open", h.length === 2 && h[0].driverName === "Bob Veh" && !h[0].endedAt && h[1].endReason === "Reassigned" && !!h[1].endedAt, h);

    // ── Bob leaves (archive) ──
    r = await req("POST", `/admin/drivers/${bob.id}/archive`, { leftOn: dayKey(ukToday()), reason: "Moved away" });
    check("archive Bob", r.statusCode === 200, r.json());
    h = await history(car.id);
    check("history: Bob closed 'Driver left'", h[0].driverName === "Bob Veh" && h[0].endReason === "Driver left" && !!h[0].endedAt, h[0]);

    // ── Ann takes it back via the Drivers page picker, then car retired ──
    r = await req("PUT", `/admin/drivers/${ann.id}`, { vehicleId: car.id });
    check("Drivers page: give car back to Ann", r.statusCode === 200, r.json());
    r = await req("POST", `/admin/vehicles/${car.id}/retire`);
    check("retire car", r.statusCode === 200, r.json());
    h = await history(car.id);
    check("history: Ann closed 'Vehicle retired'; 3 periods of use", h.length === 3 && h[0].endReason === "Vehicle retired", h.map((x) => [x.driverName, x.endReason]));

    // ── Restore + start date edit ──
    r = await req("POST", `/admin/vehicles/${car.id}/restore`);
    check("restore car", r.statusCode === 200, r.json());
    r = await req("PATCH", `/admin/vehicles/${car.id}`, { startDate: daysAgo(150) });
    check("edit start date", r.statusCode === 200, r.json());

    // ── Documents for the enclosures ──
    const mk = (type: string, ext: string, expiry?: string) =>
      prisma.driverDocument.create({ data: { vehicleId: car.id, type, status: "APPROVED", reviewedAt: new Date(),
        fileUrl: `cld:authenticated:image:${ext}:drivers/documents/${type.toLowerCase()}`, expiryDate: expiry ? new Date(expiry) : null } });
    await mk("MOT_CERTIFICATE", "jpg", "2027-05-01");
    await mk("VEHICLE_INSURANCE", "pdf", "2026-11-14");

    // ── TfL record ──
    r = await req("GET", `/admin/vehicles/${car.id}/tfl-record`);
    const rec = r.json().data;
    check("record: template fields", rec.vehicle.make === "Tesla" && rec.vehicle.model === "Model Y" && rec.vehicle.registration === plate && rec.vehicle.colour === "White", rec.vehicle);
    check("record: keeper name + address lines", JSON.stringify(rec.vehicle.keeper) === JSON.stringify(["Kapil Dev", "8 Riverside Walk", "Forge Wood", "Crawley RH10 3SZ"]), rec.vehicle.keeper);
    check("record: two Start / Ceased periods, first start = edited date", rec.periods.length === 2 && !!rec.periods[0].ceased && rec.periods[1].ceased === null && rec.periods[0].start === new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "short", year: "numeric" }).format(new Date(daysAgo(150) + "T00:00:00Z")), rec.periods);
    const enc = Object.fromEntries(rec.enclosures.map((e: any) => [e.type, e]));
    check("record: MOT + insurance enclosed (YES), V5C + PHV missing (NO)", enc.MOT_CERTIFICATE.pages.length === 1 && enc.VEHICLE_INSURANCE.pages[0].includes(".pdf?t=") && enc.V5C_LOGBOOK.pages.length === 0 && enc.PHV_LICENCE.pages.length === 0 && enc.PHV_LICENCE.onTemplate === false, rec.enclosures.map((e: any) => [e.type, e.pages.length]));
    check("record: driver history oldest first with reasons", rec.drivers.map((d: any) => d.name + ":" + (d.reason ?? "")).join("|") === "Ann Veh:Reassigned|Bob Veh:Driver left|Ann Veh:Vehicle retired", rec.drivers);
    check("record: no storage refs leak", !r.body.includes("cld:") && !r.body.includes("res.cloudinary.com"));

    // ── Dropdown ──
    let opts = (await req("GET", "/admin/tfl-records/vehicles")).json().data;
    let o = opts.find((x: any) => x.id === car.id);
    check("dropdown: restored car listed as on the fleet, no driver", o && !o.retired && o.driverName === null && o.makeModel === "Tesla Model Y", o);
    await req("POST", `/admin/vehicles/${car.id}/retire`);
    opts = (await req("GET", "/admin/tfl-records/vehicles")).json().data;
    o = opts.find((x: any) => x.id === car.id);
    check("dropdown: retired car still listed with kept-until", o && o.retired && !!o.ceasedOn && !!o.keptUntil, o);
    await prisma.vehicle.update({ where: { id: car.id }, data: { archivedAt: new Date(Date.now() - 400 * 86_400_000) } });
    opts = (await req("GET", "/admin/tfl-records/vehicles")).json().data;
    check("dropdown: car ceased over 12 months ago not listed", !opts.some((x: any) => x.id === car.id));

    // ── Driver's car history ──
    const dh = (await req("GET", `/admin/drivers/${ann.id}/vehicle-history`)).json().data;
    check("driver history: Ann had the car twice", dh.length === 2 && dh.every((x: any) => x.registration === plate), dh);

    // ── Driver deleted later: name kept ──
    await prisma.driverEngagement.deleteMany({ where: { driverId: bob.id } });
    await prisma.driver.delete({ where: { id: bob.id } });
    created.drivers = created.drivers.filter((d) => d !== bob.id);
    h = await history(car.id);
    const bobRow = h.find((x: any) => x.driverName === "Bob Veh");
    check("driver record deleted: history keeps the name", bobRow && bobRow.driverId === null, bobRow);
  } catch (err) {
    fail++;
    console.log("FAIL  crashed", err);
  } finally {
    await prisma.driverDocument.deleteMany({ where: { vehicleId: { in: created.vehicles } } });
    await prisma.booking.deleteMany({ where: { vehicleId: { in: created.vehicles } } });
    await prisma.vehicle.deleteMany({ where: { id: { in: created.vehicles } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: created.users } } });
    await prisma.driverEngagement.deleteMany({ where: { driverId: { in: created.drivers } } });
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
