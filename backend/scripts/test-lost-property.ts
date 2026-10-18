// backend/scripts/test-lost-property.ts
//
// Lost property register (TfL Condition 9), end to end against the LOCAL database and LOCAL
// Redis, through the real routes: passenger report from the app, staff updates (history,
// passenger-visible note, status + result, reopen), items logged by staff (with and without a
// booking), refs under concurrent saves, the TfL record and register, the 12-month delete rule,
// pushes, and the record surviving when the passenger and their bookings are deleted.
// Creates its own data and deletes it afterwards.
//
//   SMS_DRY_RUN=true node --env-file=.env -r ts-node/register scripts/test-lost-property.ts
//
// Expect: all PASS, 0 failed.
import type {} from "../src/plugins/database";
import type {} from "../src/plugins/auth";
import type {} from "../src/plugins/socket";
import Fastify from "fastify";
import Redis from "ioredis";
import { PrismaClient as NativePrismaClient } from "@prisma/client";
import { driverRoutes } from "../src/routes/drivers";
import { passengerRoutes } from "../src/routes/passengers";
import { adminVehicleRoutes } from "../src/routes/admin/vehicles";
import { adminLostPropertyRoutes } from "../src/routes/admin/lostProperty";
import { logItem, updateItem } from "../src/services/lostProperty.service";
import { ukYear } from "../src/services/lostPropertyRules";
import { dayKey, ukToday } from "../src/services/driverRegisterRules";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, info?: any) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && info !== undefined ? "  → " + JSON.stringify(info) : ""}`);
};

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
  const log = { warn: () => {}, error: () => {}, info: () => {}, debug: () => {}, child: () => log } as any;
  const tag = String(Date.now()).slice(-6);
  const phone = (n: number) => `+4479310${tag}`.slice(0, 11) + String(n).padStart(2, "0");
  const created = { users: [] as string[], drivers: [] as string[], vehicles: [] as string[], passengers: [] as string[], bookings: [] as string[], items: [] as string[] };
  const year = ukYear(new Date());

  const admin = await prisma.user.create({ data: { phone: phone(90), firstName: "Admin", lastName: "Lp", roles: ["ADMIN"] } });
  created.users.push(admin.id);

  // Passenger auth: the test picks the passenger with the x-test-user header
  const f = Fastify({ logger: false });
  const sockets: any[] = [];
  f.decorate("prisma", prisma);
  f.decorate("redis", redis as any);
  f.decorate("io", { to: () => ({ emit: (ev: string, data: any) => sockets.push({ ev, data }) }), in: () => ({ disconnectSockets: () => {} }) } as any);
  f.decorate("authenticateAdmin", async (req: any) => { req.user = { userId: admin.id }; });
  f.decorate("authenticate", async (req: any) => { req.user = { userId: req.headers["x-test-user"] ?? admin.id }; });
  f.decorate("authenticatePassenger", async (req: any) => { req.user = { userId: req.headers["x-test-user"] }; });
  f.decorate("authenticateDriver", async () => {});
  (f as any).log = log;
  f.setErrorHandler((error: any, _req, reply) => {
    reply.status(error.statusCode ?? 500).send({ success: false, error: error.message });
  });
  await f.register(driverRoutes, { prefix: "/api/v1" });
  await f.register(passengerRoutes, { prefix: "/api/v1" });
  await f.register(adminVehicleRoutes, { prefix: "/api/v1" });
  await f.register(adminLostPropertyRoutes, { prefix: "/api/v1" });
  await f.ready();
  const req = (method: any, url: string, payload?: any, user?: string) =>
    f.inject({ method, url: `/api/v1${url}`, payload, headers: user ? { "x-test-user": user } : {} });

  async function addPassenger(n: number, first: string) {
    const u = await prisma.user.create({ data: { phone: phone(n), firstName: first, lastName: "Lp", roles: ["PASSENGER"] } });
    const p = await prisma.passenger.create({ data: { userId: u.id } });
    created.users.push(u.id);
    created.passengers.push(p.id);
    return { userId: u.id as string, id: p.id as string, phone: u.phone as string };
  }
  async function addBooking(n: number, passengerId: string, extra: any = {}) {
    const b = await prisma.booking.create({
      data: {
        reference: `DSMLP${tag}${n}`,
        passengerId,
        type: "ASAP",
        status: "COMPLETED",
        pickupAddress: "7 Riverside Walk, Crawley",
        pickupLatitude: 51.1,
        pickupLongitude: -0.18,
        dropoffAddress: "Gatwick South",
        dropoffLatitude: 51.15,
        dropoffLongitude: -0.16,
        estimatedFare: 10,
        completedAt: new Date(Date.now() - 3600_000),
        ...extra,
      },
    });
    created.bookings.push(b.id);
    return b;
  }

  try {
    // ── Set up: a driver with a car, two passengers, bookings ──
    let r = await req("POST", "/admin/drivers", {
      firstName: "Dee", lastName: "Lp", phone: phone(1), pcoBadgeNumber: `PL${tag}1`,
      pcoLicenseExpiry: "2099-01-01", drivingLicenseNumber: "LP1", availableFrom: dayKey(ukToday()),
    });
    check("create driver", r.statusCode === 201, r.json());
    const driver = { id: r.json().data.driver.id, userId: r.json().data.user.id };
    created.users.push(driver.userId);
    created.drivers.push(driver.id);
    const plate = `LP${tag}`;
    r = await req("POST", "/admin/vehicles", {
      make: "Tesla", model: "Model Y", year: 2022, colour: "White", licensePlate: plate,
      motExpiry: "2027-05-01", insuranceExpiry: "2027-11-14", driverId: driver.id,
    });
    check("create car", r.statusCode === 201, r.json());
    const car = r.json().data;
    created.vehicles.push(car.id);

    const ann = await addPassenger(2, "Ann");
    const bob = await addPassenger(3, "Bob");
    const b1 = await addBooking(1, ann.id, { vehicleId: car.id, driverId: driver.id });
    const b2 = await addBooking(2, ann.id, { vehicleId: null });
    const bBob = await addBooking(3, bob.id, { vehicleId: car.id });

    // ── Passenger reports from the app ──
    r = await req("POST", `/passengers/bookings/${b1.id}/lost-property`, { description: "  Black iPhone 14, rear seat " }, ann.userId);
    check("passenger report → 200", r.statusCode === 200, r.json());
    const rep = r.json().data;
    created.items.push(rep.id);
    check("report has a ref LP-<year>-NNN", new RegExp(`^LP-${year}-\\d{3,}$`).test(rep.refNo), rep.refNo);
    check("app response has nothing internal", rep.customerName === undefined && rep.vehicleReg === undefined && rep.createdByUserId === undefined, Object.keys(rep));
    check("admin socket event has the ref", sockets.some((s) => s.ev === "admin:lost_property" && s.data.refNo === rep.refNo));
    let row = await prisma.lostProperty.findUnique({ where: { id: rep.id } });
    check("copied: vehicle reg from booking.vehicleId", row.vehicleReg === plate && row.vehicleId === car.id, row);
    check("copied: customer name + phone", row.customerName === "Ann Lp" && row.contactPhone === ann.phone, row);
    check("copied: booking date/time (trip completed)", row.bookingDateTime?.getTime() === b1.completedAt.getTime());
    check("description trimmed, source passenger", row.description === "Black iPhone 14, rear seat" && row.source === "PASSENGER_REPORT");
    check("not received yet", row.receivedAt === null && row.status === "REPORTED");

    r = await req("POST", `/passengers/bookings/${b1.id}/lost-property`, { description: "again" }, ann.userId);
    check("second report on same booking → 400", r.statusCode === 400, r.json());
    r = await req("POST", `/passengers/bookings/${bBob.id}/lost-property`, { description: "not mine" }, ann.userId);
    check("someone else's booking → 403", r.statusCode === 403, r.json());
    r = await req("POST", `/passengers/bookings/${b2.id}/lost-property`, { description: "   " }, ann.userId);
    check("empty description → 400", r.statusCode === 400, r.json());

    r = await req("GET", `/passengers/bookings/${b1.id}/lost-property`, undefined, ann.userId);
    check("app GET: status + ref, nothing internal", r.json().data?.refNo === rep.refNo && r.json().data.vehicleReg === undefined, r.json());
    r = await req("GET", `/passengers/bookings?limit=50`, undefined, ann.userId);
    const hist = (r.json().data?.items ?? []).find((b: any) => b.id === b1.id);
    check("ride history: lostProperties limited fields", hist?.lostProperties?.[0]?.refNo === rep.refNo && hist.lostProperties[0].customerName === undefined, hist?.lostProperties);

    // ── Admin list ──
    r = await req("GET", "/admin/lost-property");
    let listed = r.json().data.find((x: any) => x.id === rep.id);
    check("admin list has the item + old fields", !!listed && listed.booking?.reference === b1.reference && listed.passenger?.user?.firstName === "Ann", listed);
    check("admin list: label, not overdue, history empty", listed.statusLabel === "Reported" && listed.overdue === false && listed.contacts.length === 0);

    // ── History entries ──
    r = await req("PUT", `/admin/lost-property/${rep.id}`, { note: "Called driver Dee — checking the car" });
    check("internal note → 200", r.statusCode === 200, r.json());
    check("internal note: in history, not shown to passenger", r.json().data.contacts.length === 1 && r.json().data.adminNotes === null && r.json().data.contacts[0].staffName === "Admin Lp", r.json().data);
    r = await req("PUT", `/admin/lost-property/${rep.id}`, { note: "Driver has it — we'll call you", showToPassenger: true, noteAt: "2026-01-05T10:00" });
    check("passenger note → adminNotes (app 'Update:')", r.json().data.adminNotes === "Driver has it — we'll call you", r.json().data.adminNotes);
    check("history keeps both, in time order", r.json().data.contacts.length === 2 && r.json().data.contacts[0].note.startsWith("Driver has it"), r.json().data.contacts.map((c: any) => c.note));

    // ── Status: found, returned, reopen, closed ──
    r = await req("PUT", `/admin/lost-property/${rep.id}`, { status: "FOUND", details: { handedInByDriverId: driver.id } });
    let item = r.json().data;
    check("found → received date set", item.status === "FOUND" && !!item.receivedAt, item);
    check("handed in by driver (name copied)", item.handedInByName === "Dee Lp" && item.handedInByDriverId === driver.id);
    check("status change written to history", item.contacts.some((c: any) => c.note === "Status: Reported → Found"));
    r = await req("PUT", `/admin/lost-property/${rep.id}`, { status: "RETURNED" });
    check("returned without result → 400", r.statusCode === 400 && /result/i.test(r.json().error), r.json());
    r = await req("PUT", `/admin/lost-property/${rep.id}`, { status: "RETURNED", outcome: "DISPOSED" });
    check("returned + disposed → 400", r.statusCode === 400, r.json());
    r = await req("PUT", `/admin/lost-property/${rep.id}`, { status: "RETURNED", outcome: "COLLECTED_BY_OWNER", outcomeDetails: "Collected from office" });
    item = r.json().data;
    check("returned + collected → closed fields", item.status === "RETURNED" && item.outcome === "COLLECTED_BY_OWNER" && !!item.resolvedAt && item.representativeName === "Admin Lp" && item.closedByUserId === admin.id, item);
    check("outcome label", item.outcomeLabel === "Collected by owner");
    r = await req("PUT", `/admin/lost-property/${rep.id}`, { status: "FOUND" });
    item = r.json().data;
    check("reopen clears the result", item.status === "FOUND" && item.outcome === null && item.resolvedAt === null && item.representativeName === null, item);
    r = await req("PUT", `/admin/lost-property/${rep.id}`, { status: "CLOSED", outcome: "HANDED_TO_POLICE", outcomeDetails: "Crawley police, ref 123", representativeName: "Kapil Dev", outcomeAt: "2026-01-10T14:00" });
    item = r.json().data;
    check("closed + police with typed representative", item.status === "CLOSED" && item.representativeName === "Kapil Dev" && item.outcomeDetails === "Crawley police, ref 123", item);
    check("result date from the form (UK time)", item.inputs.outcomeAt === "2026-01-10T14:00", item.inputs);
    check("status entry dated by the result date", item.contacts.some((c: any) => c.note.startsWith("Status: Found → Closed") && c.at === "2026-01-10T14:00:00.000Z"), item.contacts.map((c: any) => [c.at, c.note]));
    r = await req("PUT", `/admin/lost-property/${rep.id}`, { outcome: "DISPOSED", outcomeDetails: "Shredded", representativeName: "Kapil Dev" });
    check("correct the result of a closed item", r.json().data.outcome === "DISPOSED" && r.json().data.status === "CLOSED", r.json().data);
    r = await req("PUT", `/admin/lost-property/${rep.id}`, { details: { bookingReference: b2.reference } });
    check("passenger report can't move to another booking", r.statusCode === 400, r.json());
    r = await req("PUT", `/admin/lost-property/${rep.id}`, { details: { description: "" } });
    check("description can't be emptied", r.statusCode === 400, r.json());

    // ── Staff log: no booking ──
    r = await req("POST", "/admin/lost-property", {
      description: "Blue umbrella", handedInByName: "Gatwick South info desk", vehicleReg: plate.toLowerCase().replace(/(\d)/, "$1 "),
      customerAddress: " 8 Riverside Walk \n Crawley RH10 3SZ ",
    });
    check("log found item (no booking) → 200", r.statusCode === 200, r.json());
    const umb = r.json().data;
    created.items.push(umb.id);
    check("logged: found, received now, staff source", umb.status === "FOUND" && !!umb.receivedAt && umb.source === "ADMIN_FOUND" && umb.createdByUserId === admin.id, umb);
    check("typed reg matched to the fleet car", umb.vehicleReg === plate && umb.vehicleId === car.id, [umb.vehicleReg, umb.vehicleId]);
    check("typed handed-in name, address lines kept", umb.handedInByName === "Gatwick South info desk" && umb.customerAddress === "8 Riverside Walk\nCrawley RH10 3SZ");
    check("refs are consecutive", parseInt(umb.refNo.split("-")[2]) === parseInt(rep.refNo.split("-")[2]) + 1, [rep.refNo, umb.refNo]);
    check("no booking, no passenger, phone blank", umb.bookingId === null && umb.passengerId === null && umb.contactPhone === "");

    // ── Staff log: from a booking (phone report, reported missing) ──
    r = await req("POST", "/admin/lost-property", { bookingId: bBob.id, description: "Laptop bag", status: "REPORTED", note: "Bob phoned", showToPassenger: false });
    const bag = r.json().data;
    if (bag?.id) created.items.push(bag.id);
    check("log from booking → copies booking details", r.statusCode === 200 && bag.vehicleReg === plate && bag.customerName === "Bob Lp" && bag.passengerId === bob.id, r.json());
    check("reported missing: no received date; 2 history rows", bag.status === "REPORTED" && bag.receivedAt === null && bag.contacts.length === 2, bag);
    r = await req("POST", "/admin/lost-property", { bookingReference: b2.reference.toLowerCase(), description: "Scarf" });
    const scarf = r.json().data;
    if (scarf?.id) created.items.push(scarf.id);
    check("by booking reference (any case); no vehicle on booking → reg blank", r.statusCode === 200 && scarf.bookingId === b2.id && scarf.vehicleReg === null, r.json());

    r = await req("POST", "/admin/lost-property", { handedInByName: "x" });
    check("log without description → 400", r.statusCode === 400, r.json());
    r = await req("POST", "/admin/lost-property", { description: "x", bookingReference: "NOPE123" });
    check("unknown booking → 404", r.statusCode === 404 && /NOPE123/.test(r.json().error), r.json());
    r = await req("POST", "/admin/lost-property", { description: "x", receivedAt: "2099-01-01T10:00" });
    check("received in the future → 400", r.statusCode === 400, r.json());
    r = await req("POST", "/admin/lost-property", { description: "x", receivedAt: "yesterday" });
    check("received not a date → 400", r.statusCode === 400, r.json());
    r = await req("POST", "/admin/lost-property", { description: "x", status: "CLOSED" });
    check("can't log straight to closed → 400", r.statusCode === 400, r.json());

    // ── Refs under concurrent saves ──
    const burst = await Promise.all(Array.from({ length: 8 }, (_, i) => req("POST", "/admin/lost-property", { description: `Burst ${i}` })));
    const refs = burst.map((x) => x.json().data?.refNo).filter(Boolean);
    burst.forEach((x) => x.json().data?.id && created.items.push(x.json().data.id));
    const nums = refs.map((x: string) => parseInt(x.split("-")[2])).sort((a: number, b: number) => a - b);
    check("8 at once → 8 different refs", new Set(refs).size === 8, refs);
    check("…and no gaps", nums.every((n: number, i: number) => i === 0 || n === nums[i - 1] + 1), nums);

    // ── TfL record ──
    r = await req("GET", `/admin/lost-property/${rep.id}/tfl-record`);
    const rec = r.json().data;
    check("TfL record → 200", r.statusCode === 200, r.json());
    check("record: template fields", rec.item.refNo === rep.refNo && rec.item.handedInBy === "Dee Lp" && rec.item.vehicleReg === plate && rec.item.bookingReference === b1.reference && rec.item.customer.name === "Ann Lp", rec.item);
    check("record: enquiries + result", rec.item.enquiries.length >= 5 && rec.item.result.label === "Disposed of" && rec.item.result.details === "Shredded" && rec.item.representativeName === "Kapil Dev", rec.item.result);
    check("record: warns about missing address", rec.warnings.includes("Customer address") && !rec.warnings.includes("Vehicle registration"), rec.warnings);
    check("record: printed by admin", rec.printedBy === "Admin Lp");
    r = await req("GET", `/admin/lost-property/${umb.id}/tfl-record`);
    check("record: address lines", JSON.stringify(r.json().data.item.customer.address) === JSON.stringify(["8 Riverside Walk", "Crawley RH10 3SZ"]));
    r = await req("GET", `/admin/lost-property/nope/tfl-record`);
    check("record: unknown → 404", r.statusCode === 404);

    // ── Register ──
    const today = dayKey(ukToday());
    r = await req("GET", `/admin/tfl-records/lost-property?from=${today}&to=${today}`);
    const regRows = r.json().data.rows;
    check("register today has the new items", [umb.id, bag.id, scarf.id].every((id) => regRows.some((x: any) => x.id === id)), regRows.length);
    check("register: closed item shows result", (() => { const x = regRows.find((y: any) => y.id === rep.id); return !x || x.result === "Disposed of"; })());
    r = await req("GET", `/admin/tfl-records/lost-property?from=2001-01-01&to=2001-01-02`);
    check("register: other dates → none", r.json().data.rows.length === 0);
    r = await req("GET", `/admin/tfl-records/lost-property?from=2026-13-01`);
    check("register: bad date → 400", r.statusCode === 400);

    // ── 12-month delete rule ──
    r = await req("DELETE", `/admin/lost-property/${umb.id}`, { confirmRef: umb.refNo });
    check("delete open item → 400", r.statusCode === 400 && /closed/i.test(r.json().error), r.json());
    r = await req("DELETE", `/admin/lost-property/${rep.id}`, { confirmRef: rep.refNo });
    check("delete closed today → 400 with date", r.statusCode === 400 && /can be deleted from/.test(r.json().error), r.json());
    await prisma.lostProperty.update({ where: { id: rep.id }, data: { resolvedAt: new Date(Date.now() - 400 * 86_400_000) } });
    r = await req("DELETE", `/admin/lost-property/${rep.id}`, { confirmRef: "LP-1999-001" });
    check("delete with wrong ref → 400", r.statusCode === 400 && /Type/.test(r.json().error), r.json());
    r = await req("DELETE", `/admin/lost-property/${rep.id}`, { confirmRef: rep.refNo.toLowerCase() });
    check("delete after 12 months → 200", r.statusCode === 200, r.json());
    check("deleted with its history", !(await prisma.lostProperty.findUnique({ where: { id: rep.id } })) && (await prisma.lostPropertyContact.count({ where: { lostPropertyId: rep.id } })) === 0);

    // ── Pushes (service, with a recording push) ──
    const pushes: any[] = [];
    const deps = { prisma, log, push: async (userId: string, n: any) => { pushes.push({ userId, ...n }); return 1; } };
    await updateItem(deps, bag.id, { status: "FOUND" }, admin.id);
    check("push to the passenger when found", pushes.length === 1 && pushes[0].userId === bob.userId && pushes[0].title === "We've found your item" && pushes[0].data.refNo === bag.refNo, pushes);
    await updateItem(deps, bag.id, { note: "Called Bob" }, admin.id);
    check("no push for a note", pushes.length === 1);
    await updateItem(deps, bag.id, { status: "RETURNED", outcome: "RETURNED_BY_DRIVER" }, admin.id);
    check("push when returned", pushes.length === 2 && pushes[1].title === "Item returned");
    await updateItem(deps, scarf.id, { status: "CLOSED", outcome: "DONATED" }, admin.id);
    check("no push when closed", pushes.length === 2);
    const found = await logItem(deps, { bookingId: b2.id, description: "Gloves" }, admin.id);
    created.items.push(found.id);
    check("staff log as found on a passenger's booking → push", pushes.length === 3 && pushes[2].userId === ann.userId, pushes[2]);
    const noPax = await logItem(deps, { description: "Keys" }, admin.id);
    created.items.push(noPax.id);
    check("no passenger → no push", pushes.length === 3);
    const broken = { prisma, log, push: async () => { throw new Error("Expo down"); } };
    const ok = await logItem(broken, { bookingId: b2.id, description: "Hat" }, admin.id).then((x) => { created.items.push(x.id); return true; }, () => false);
    check("push failure doesn't fail the save", ok);

    // ── Passenger and their bookings deleted: the record stays ──
    r = await req("DELETE", `/admin/passengers/${bob.id}`);
    check("delete passenger Bob (with a lost property record) → 200", r.statusCode === 200, r.json());
    row = await prisma.lostProperty.findUnique({ where: { id: bag.id } });
    check("record kept, links cleared, copies kept", !!row && row.passengerId === null && row.bookingId === null && row.customerName === "Bob Lp" && row.vehicleReg === plate, row);
    created.users = created.users.filter((u) => u !== bob.userId);
    created.bookings = created.bookings.filter((b) => b !== bBob.id);

    // ── Vehicle deleted: reg kept ──
    await prisma.booking.updateMany({ where: { vehicleId: car.id }, data: { vehicleId: null } });
    await prisma.driverDocument.deleteMany({ where: { vehicleId: car.id } });
    await prisma.vehicle.delete({ where: { id: car.id } });
    created.vehicles = [];
    row = await prisma.lostProperty.findUnique({ where: { id: umb.id } });
    check("vehicle deleted: reg kept on the record", row.vehicleId === null && row.vehicleReg === plate, row);
  } catch (e) {
    check("no unexpected error", false, (e as Error).stack);
  } finally {
    await prisma.lostProperty.deleteMany({ where: { id: { in: created.items } } });
    await prisma.booking.deleteMany({ where: { id: { in: created.bookings } } });
    await prisma.driverDocument.deleteMany({ where: { vehicleId: { in: created.vehicles } } });
    await prisma.vehicle.deleteMany({ where: { id: { in: created.vehicles } } });
    await prisma.passenger.deleteMany({ where: { id: { in: created.passengers.filter(Boolean) }, user: { id: { in: created.users } } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: created.users } } });
    await prisma.driverEngagement.deleteMany({ where: { driverId: { in: created.drivers } } });
    await prisma.vehicleAssignment.deleteMany({ where: { driverId: { in: created.drivers } } });
    await prisma.driver.deleteMany({ where: { id: { in: created.drivers } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    await f.close();
    await prisma.$disconnect();
    if (pool) await pool.end();
    redis.disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
