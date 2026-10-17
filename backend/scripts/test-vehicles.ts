// backend/scripts/test-vehicles.ts
//
// Independent vehicles + Booking.vehicleId, end to end against the LOCAL database
// (Google Maps, notifications and Redis are stubbed). Creates its own users/drivers/vehicles/bookings
// and deletes them afterwards.
//
//   node --env-file=.env -r ts-node/register scripts/test-vehicles.ts
//
// Expect: all PASS, 0 failed.
import Fastify from "fastify";
import { PrismaClient as NativePrismaClient } from "@prisma/client";
import { bookingRoutes } from "../src/routes/bookings";
import { driverRoutes } from "../src/routes/drivers";
import { adminVehicleRoutes } from "../src/routes/admin/vehicles";
import { MapsService } from "../src/services/maps.service";
import { saveReceipt } from "../src/services/receipt.service";
import { TFL_VEHICLE_CAP } from "../src/services/vehicle.service";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, info?: any) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && info !== undefined ? "  → " + JSON.stringify(info) : ""}`);
};

(async () => {
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
  const tag = String(Date.now()).slice(-6);
  const phone = (n: number) => `+4479000${tag}`.slice(0, 11) + String(n).padStart(2, "0");
  const plate = (s: string) => `T${tag}${s}`;
  const created = { users: [] as string[], drivers: [] as string[], vehicles: [] as string[], bookings: [] as string[] };

  // Stubs
  (MapsService.prototype as any).getDirections = async () => ({ distanceKm: 10, durationMinutes: 20 });
  const { NotificationService } = require("../src/services/notification.service");
  for (const k of Object.getOwnPropertyNames(NotificationService.prototype))
    if (k !== "constructor") NotificationService.prototype[k] = async () => {};
  const redisStub: any = {
    get: async () => null, set: async () => "OK", setex: async () => "OK", del: async () => 1,
    sadd: async () => 1, srem: async () => 1, smembers: async () => [], expire: async () => 1,
  };

  // Seed: admin, two drivers
  const admin = await prisma.user.create({ data: { phone: phone(90), firstName: "Admin", lastName: "T", roles: ["ADMIN"] } });
  created.users.push(admin.id);
  async function mkDriver(n: number, first: string) {
    const u = await prisma.user.create({ data: { phone: phone(n), firstName: first, lastName: "Test", roles: ["DRIVER"] } });
    const d = await prisma.driver.create({ data: { userId: u.id, pcoBadgeNumber: `PCO${tag}${n}`, pcoLicenseExpiry: new Date("2027-01-01"), drivingLicenseNumber: "X" } });
    created.users.push(u.id); created.drivers.push(d.id);
    return d;
  }
  const kapil = await mkDriver(91, "Kapil");
  const other = await mkDriver(92, "Other");

  const f = Fastify();
  f.decorate("prisma", prisma);
  f.decorate("redis", redisStub);
  f.decorate("io", { to: () => ({ emit: () => {} }) } as any);
  f.decorate("authenticateAdmin", async (req: any) => { req.user = { userId: admin.id }; });
  f.decorate("authenticate", async (req: any) => { req.user = { userId: admin.id }; });
  f.decorate("authenticatePassenger", async () => {});
  f.decorate("authenticateDriver", async () => {});
  f.setErrorHandler((error: any, _req, reply) => {
    if (error.name === "ZodError") {
      const first = JSON.parse(error.message)[0];
      return reply.status(400).send({ success: false, error: `Invalid input — ${first?.path?.join(".")}: ${first?.message}` });
    }
    reply.status(error.statusCode ?? 500).send({ success: false, error: error.message });
  });
  await f.register(bookingRoutes, { prefix: "/api/v1" });
  await f.register(driverRoutes, { prefix: "/api/v1" });
  await f.register(adminVehicleRoutes, { prefix: "/api/v1" });
  const req = (method: any, url: string, payload?: any) => f.inject({ method, url: `/api/v1${url}`, payload });

  const vBody = (p: string, extra: any = {}) => ({
    make: "Tesla", model: "Model Y", year: 2022, colour: "White", licensePlate: p,
    motExpiry: "2027-03-01", insuranceExpiry: "2027-02-01", phvLicenceNumber: `PHV-${p}`, isUlezCompliant: true, ...extra,
  });
  const addVehicle = async (p: string, extra: any = {}) => {
    const r = await req("POST", "/admin/vehicles", vBody(p, extra));
    if (r.statusCode === 201) created.vehicles.push(r.json().data.id);
    return r;
  };

  try {
    // ── Add + assign ──
    let r = await addVehicle(plate("A"), {
      driverId: kapil.id, keeperName: "Kapil Dev", keeperAddress: "1 Test Road\nCrawley RH10 1AA", startDate: "2025-03-01",
    });
    check("add vehicle with driver → 201", r.statusCode === 201, r.json());
    const carA = r.json().data;
    check("new vehicle assigned to driver", carA.driver?.id === kapil.id, carA.driver);
    check("keeper + start date saved", carA.keeperName === "Kapil Dev" && carA.keeperAddress.includes("RH10") && carA.startDate.startsWith("2025-03-01"), carA);

    r = await addVehicle(` ${plate("A").toLowerCase().replace(/(.{3})/, "$1 ")} `);
    check("same reg with different spacing/case → 409", r.statusCode === 409, r.json());

    r = await addVehicle(plate("B"));
    check("add vehicle unassigned → 201", r.statusCode === 201 && !r.json().data.driver, r.json());
    check("start date defaults to today", r.json().data.startDate.slice(0, 10) === new Date().toISOString().slice(0, 10), r.json().data.startDate);
    const carB = r.json().data;

    r = await req("POST", "/admin/vehicles", { ...vBody(plate("X")), motExpiry: "not-a-date" });
    check("bad date → 400", r.statusCode === 400, r.json());

    // ── Bookings stamped with the car ──
    const { DispatchService } = require("../src/services/dispatch.service");
    const lockRedis = { ...redisStub, get: async () => kapil.id };
    const dispatch = new DispatchService(prisma, lockRedis, { to: () => ({ emit: () => {} }) }, new MapsService());
    const mkBooking = async (status: string, extra: any = {}) => {
      const b = await prisma.booking.create({
        data: {
          reference: `VT${tag}${created.bookings.length}`, type: "ASAP", status,
          pickupAddress: "A", pickupLatitude: 51.15, pickupLongitude: -0.16,
          dropoffAddress: "B", dropoffLatitude: 51.11, dropoffLongitude: -0.15, estimatedFare: 20, ...extra,
        },
      });
      created.bookings.push(b.id);
      return b;
    };
    const done = await mkBooking("PENDING");
    await dispatch.acceptJob(done.id, kapil.id);
    let b = await prisma.booking.findUnique({ where: { id: done.id } });
    check("acceptJob stamps vehicleId + PHV", b.vehicleId === carA.id && b.driverPhvLicenceNumber === `PHV-${plate("A")}`, b);
    await prisma.booking.update({ where: { id: done.id }, data: { status: "COMPLETED", completedAt: new Date(), actualFare: 20 } });

    const onTrip = await mkBooking("PENDING");
    await dispatch.acceptJob(onTrip.id, kapil.id);
    await dispatch.updateBookingStatus(onTrip.id, kapil.id, "IN_PROGRESS");
    const upcoming = await mkBooking("PENDING");
    await dispatch.acceptJob(upcoming.id, kapil.id);

    // ── Change Kapil's car A → B ──
    r = await req("POST", `/admin/vehicles/${carB.id}/assign`, { driverId: kapil.id });
    check("assign B to Kapil → 200", r.statusCode === 200, r.json());
    const a = await prisma.vehicle.findUnique({ where: { id: carA.id } });
    check("old car A unassigned, still on fleet", a.driverId === null && !a.archivedAt && a.isActive, a);
    const [bDone, bTrip, bUp] = await Promise.all([done, onTrip, upcoming].map((x) => prisma.booking.findUnique({ where: { id: x.id } })));
    check("completed trip keeps car A", bDone.vehicleId === carA.id, bDone.vehicleId);
    check("trip in progress keeps car A", bTrip.vehicleId === carA.id, bTrip.vehicleId);
    check("accepted-not-started job moves to car B (+PHV)", bUp.vehicleId === carB.id && bUp.driverPhvLicenceNumber === `PHV-${plate("B")}`, bUp);

    r = await req("GET", `/bookings/${done.id}`);
    check("booking API shows the car that did the trip (A)", r.json().data.driver.vehicle.licensePlate === plate("A"), r.json().data.driver?.vehicle);
    const rec = await saveReceipt(prisma, done.id);
    check("receipt shows car A", rec.vehiclePlate === plate("A"), rec.vehiclePlate);

    // En route re-stamps (car may have changed since a claim)
    await prisma.booking.update({ where: { id: upcoming.id }, data: { vehicleId: null } });
    await dispatch.updateBookingStatus(upcoming.id, kapil.id, "DRIVER_EN_ROUTE");
    b = await prisma.booking.findUnique({ where: { id: upcoming.id } });
    check("en route stamps the current car", b.vehicleId === carB.id, b.vehicleId);

    // ── Taking a car another driver has ──
    r = await req("POST", `/admin/vehicles/${carB.id}/assign`, { driverId: other.id });
    check("can't take B while it's on a trip → 409", r.statusCode === 409, r.json());
    await prisma.booking.update({ where: { id: upcoming.id }, data: { status: "COMPLETED" } });
    await prisma.booking.update({ where: { id: onTrip.id }, data: { status: "COMPLETED" } });
    r = await req("PUT", `/admin/drivers/${other.id}`, { vehicleId: carB.id });
    check("driver edit: give Other car B → 200", r.statusCode === 200 && r.json().data.vehicle?.id === carB.id, r.json());
    const k = await prisma.driver.findUnique({ where: { id: kapil.id }, include: { vehicle: true } });
    check("Kapil left without a car", k.vehicle === null, k.vehicle);

    // No car, no job
    await prisma.driver.update({ where: { id: kapil.id }, data: { status: "AVAILABLE" } });
    for (const type of ["PCO_LICENSE", "DRIVING_LICENSE", "DRIVING_LICENSE_BACK", "PHV_LICENCE", "VEHICLE_INSURANCE", "MOT_CERTIFICATE", "V5C_LOGBOOK", "DBS_CHECK"])
      await prisma.driverDocument.create({ data: { driverId: kapil.id, type, status: "APPROVED", fileUrl: "x" } });
    let err = "";
    try { await dispatch.manualAssign((await mkBooking("PENDING")).id, kapil.id); } catch (e: any) { err = e.message; }
    check("manual assign blocked without a vehicle", /no vehicle/i.test(err), err);

    // ── Retire / restore / delete ──
    r = await req("POST", `/admin/vehicles/${carB.id}/retire`);
    check("retire B → 200", r.statusCode === 200, r.json());
    const bRet = await prisma.vehicle.findUnique({ where: { id: carB.id } });
    check("retired: archived, inactive, unassigned", !!bRet.archivedAt && !bRet.isActive && bRet.driverId === null, bRet);
    r = await req("GET", "/admin/vehicles");
    check("retired car not in default list", !r.json().data.items.some((v: any) => v.id === carB.id));
    r = await req("GET", "/admin/vehicles?status=retired");
    check("retired car in retired list", r.json().data.items.some((v: any) => v.id === carB.id));
    r = await req("POST", `/admin/vehicles/${carB.id}/assign`, { driverId: kapil.id });
    check("can't assign a retired car → 400", r.statusCode === 400, r.json());
    r = await req("DELETE", `/admin/vehicles/${carB.id}`);
    check("can't delete a car with bookings → 409", r.statusCode === 409, r.json());
    r = await req("POST", `/admin/vehicles/${carB.id}/restore`);
    check("restore → 200, back on fleet", r.statusCode === 200 && r.json().data.archivedAt === null, r.json());

    r = await addVehicle(plate("C"));
    const carC = r.json().data;
    r = await req("DELETE", `/admin/vehicles/${carC.id}`);
    check("delete unused car → 200", r.statusCode === 200, r.json());
    created.vehicles = created.vehicles.filter((id) => id !== carC.id);

    r = await req("PATCH", `/admin/vehicles/${carA.id}`, { colour: "Black", motExpiry: "2027-06-01", licensePlate: plate("B") });
    check("edit to an existing reg → 409", r.statusCode === 409, r.json());
    r = await req("PATCH", `/admin/vehicles/${carA.id}`, { colour: "Black", motExpiry: "2027-06-01" });
    check("edit details → 200", r.statusCode === 200 && r.json().data.colour === "Black", r.json());

    // ── Detail + list extras ──
    const cancelled = await mkBooking("CANCELLED", { vehicleId: carA.id, driverId: kapil.id });
    const assigned = await mkBooking("DRIVER_ASSIGNED", { vehicleId: carA.id, driverId: other.id, scheduledAt: new Date(Date.now() + 86400_000) });
    r = await req("GET", `/admin/vehicles/${carA.id}`);
    const det = r.json().data;
    check("cancelled bookings not listed", !det.recentTrips.concat(det.upcoming).some((t: any) => t.id === cancelled.id));
    check("assigned job listed under upcoming", det.upcoming.length === 1 && det.upcoming[0].id === assigned.id, det.upcoming);
    await prisma.booking.update({ where: { id: assigned.id }, data: { status: "CANCELLED" } });
    check("detail lists the car's completed trips", det.completedCount === 2 && det.recentTrips.length === 2, det.completedCount);
    check("trip with a completion time listed first", det.recentTrips[0].id === done.id, det.recentTrips.map((t: any) => t.reference));
    r = await req("GET", "/admin/vehicles");
    const rowA = r.json().data.items.find((v: any) => v.id === carA.id);
    check("list shows last trip date", !!rowA?.lastTripAt, rowA);

    // ── Past trip records the chosen (retired) car ──
    await req("POST", `/admin/vehicles/${carB.id}/retire`);
    r = await req("PUT", `/admin/drivers/${kapil.id}`, { vehicleId: carA.id });
    r = await req("POST", "/admin/bookings", {
      type: "PREBOOKED", pickupAddress: "Gatwick", pickupLatitude: 51.156, pickupLongitude: -0.163,
      dropoffAddress: "Crawley", dropoffLatitude: 51.11, dropoffLongitude: -0.15,
      passengerPhone: `+447398${tag}`, passengerName: "Past Trip", paymentMethod: "CASH", passengerCount: 1,
      scheduledAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
      pastTrip: { driverId: kapil.id, vehicleId: carB.id, fare: 35, noCommission: true },
    });
    const pastId = r.json().data?.id;
    if (pastId) created.bookings.push(pastId);
    const past = pastId && (await prisma.booking.findUnique({ where: { id: pastId } }));
    check("past trip records the car chosen (retired B)", past?.vehicleId === carB.id && past?.driverPhvLicenceNumber === `PHV-${plate("B")}`, r.json());
    if (past?.passengerId) {
      const pas = await prisma.passenger.findUnique({ where: { id: past.passengerId } });
      created.users.push(pas.userId);
    }

    // ── TfL cap ──
    const fleet = await prisma.vehicle.count({ where: { archivedAt: null } });
    const fillers: string[] = [];
    for (let i = fleet; i < TFL_VEHICLE_CAP; i++) {
      const x = await addVehicle(plate(`F${i}`));
      fillers.push(x.json().data.id);
    }
    r = await addVehicle(plate("Z"));
    check(`adding vehicle ${TFL_VEHICLE_CAP + 1} → 409 cap`, r.statusCode === 409 && /cap/i.test(r.json().error), r.json());
    r = await req("POST", `/admin/vehicles/${carB.id}/restore`);
    check("restore at cap → 409", r.statusCode === 409, r.json());
    for (const id of fillers) await req("DELETE", `/admin/vehicles/${id}`);
    created.vehicles = created.vehicles.filter((id) => !fillers.includes(id));

    // ── Deleting a driver keeps their car ──
    r = await req("DELETE", `/admin/drivers/${kapil.id}`);
    check("delete driver → 200", r.statusCode === 200, r.json());
    created.drivers = created.drivers.filter((id) => id !== kapil.id);
    const aAfter = await prisma.vehicle.findUnique({ where: { id: carA.id } });
    check("their car survives, unassigned", !!aAfter && aAfter.driverId === null, aAfter);
    b = await prisma.booking.findUnique({ where: { id: done.id } });
    check("their past booking still records the car", b.vehicleId === carA.id, b.vehicleId);
  } catch (e) {
    console.error(e);
    fail++;
  } finally {
    await prisma.driverDocument.deleteMany({ where: { driverId: { in: created.drivers } } });
    await prisma.receipt.deleteMany({ where: { bookingId: { in: created.bookings } } });
    await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: { in: created.bookings } } });
    await prisma.driverEarning.deleteMany({ where: { bookingId: { in: created.bookings } } });
    await prisma.booking.deleteMany({ where: { id: { in: created.bookings } } });
    await prisma.vehicle.deleteMany({ where: { id: { in: created.vehicles } } });
    await prisma.driver.deleteMany({ where: { id: { in: created.drivers } } });
    await prisma.passenger.deleteMany({ where: { userId: { in: created.users } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    await f.close();
    await prisma.$disconnect();
    if (pool) await pool.end();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
