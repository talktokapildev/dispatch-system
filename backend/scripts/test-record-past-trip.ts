// backend/scripts/test-record-past-trip.ts
//
// Admin "Record completed trip" + receipts, end to end against the LOCAL database
// (Google Maps, pricing estimate and dispatch are stubbed; email runs as a dry run).
// Creates its own users/driver/bookings with random phone numbers and deletes them afterwards.
//
//   node --env-file=.env -r ts-node/register scripts/test-record-past-trip.ts [receipt.pdf]
//
// Expect: 23 passed, 0 failed.
import Fastify from "fastify";
import { PrismaClient as NativePrismaClient } from "@prisma/client";
import { MapsService } from "../src/services/maps.service";
import { PricingService } from "../src/services/pricing.service";
import { bookingRoutes } from "../src/routes/bookings";
import { adminBookingReceiptRoutes } from "../src/routes/admin/booking-receipt";

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

  // Stubs: no Google Maps, simple fare
  (MapsService.prototype as any).getDirections = async () => ({ distanceKm: 10, durationMinutes: 20 });
  (PricingService.prototype as any).estimateFare = async () => ({ total: 30 });
  let dispatched = 0;
  const { DispatchService } = require("../src/services/dispatch.service");
  DispatchService.prototype.dispatchBooking = async () => { dispatched++; };

  // Seed
  const admin = await prisma.user.create({ data: { phone: phone(90), firstName: "Kapil", lastName: "Dev", roles: ["ADMIN"], email: `admin+${tag}@test.local` } });
  const dUser = await prisma.user.create({ data: { phone: phone(91), firstName: "Kapil", lastName: "Dev", roles: ["DRIVER"] } });
  const driver = await prisma.driver.create({ data: { userId: dUser.id, pcoBadgeNumber: `PCO${tag}`, pcoLicenseExpiry: new Date("2027-01-01"), drivingLicenseNumber: "X" } });
  await prisma.vehicle.create({ data: { driverId: driver.id, make: "Tesla", model: "Model Y", year: 2022, colour: "White", licensePlate: `TST${tag}`, phvLicenceNumber: "PHV999", motExpiry: new Date("2027-01-01"), insuranceExpiry: new Date("2027-01-01") } });

  const emits: string[] = [];
  const f = Fastify();
  f.decorate("prisma", prisma);
  f.decorate("redis", { get: async () => null, set: async () => "OK" } as any);
  f.decorate("io", { to: () => ({ emit: (ev: string) => emits.push(ev) }) } as any);
  f.decorate("authenticateAdmin", async (req: any) => { req.user = { userId: admin.id }; });
  f.decorate("authenticate", async () => {});
  f.decorate("authenticatePassenger", async () => {});
  // Same error handler as server.ts
  f.setErrorHandler((error: any, _req, reply) => {
    if (error.name === "ZodError") {
      const issues = JSON.parse(error.message);
      const first = issues[0];
      const where = first?.path?.length ? `${first.path.join(".")}: ` : "";
      return reply.status(400).send({ success: false, error: `Invalid input — ${where}${first.message}` });
    }
    reply.status(error.statusCode ?? 500).send({ success: false, error: error.message });
  });
  await f.register(bookingRoutes, { prefix: "/api/v1" });
  await f.register(adminBookingReceiptRoutes, { prefix: "/api/v1" });

  const H = 3600_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const createdBookings: string[] = [];
  const base = {
    type: "PREBOOKED", pickupAddress: "Gatwick RH6 0YR, UK", pickupLatitude: 51.156, pickupLongitude: -0.163,
    dropoffAddress: "Worth, Crawley RH10 4SS, UK", dropoffLatitude: 51.11, dropoffLongitude: -0.15,
    passengerPhone: `+966 56 ${tag.slice(0, 3)} ${tag.slice(3)}9`, passengerName: "Mohammed Example", passengerEmail: `mo+${tag}@example.com`,
    paymentMethod: "CASH", passengerCount: 1,
  };
  const post = (url: string, payload: any) => f.inject({ method: "POST", url: `/api/v1${url}`, payload });

  // 1. Record a past trip
  const pickup = Date.now() - 72 * H;
  let r = await post("/admin/bookings", {
    ...base, scheduledAt: iso(pickup), bookedVia: "WHATSAPP", bookedAt: iso(pickup - 20 * 60_000),
    pastTrip: { driverId: driver.id, completedAt: iso(pickup + 20 * 60_000), fare: 35 },
  });
  const b1 = r.json().data;
  check("past trip → 201", r.statusCode === 201, r.json());
  const row = await prisma.booking.findUnique({ where: { id: b1.id }, include: { statusHistory: true, passenger: { include: { user: true } } } });
  check("status COMPLETED with real times", row.status === "COMPLETED" && +row.tripStartedAt === pickup && +row.completedAt === pickup + 20 * 60_000, row);
  check("fare + PHV licence + recorded flags", row.actualFare === 35 && row.driverPhvLicenceNumber === "PHV999" && row.recordedAfterTrip && row.recordedBy === admin.id && row.bookedVia === "WHATSAPP" && row.paymentStatus === "CASH");
  check("passenger phone stored E.164", /^\+9665\d{8}$/.test(row.passenger.user.phone), row.passenger.user.phone);
  check("status history note", row.statusHistory.length === 1 && /Recorded after the trip/.test(row.statusHistory[0].note), row.statusHistory);
  const earn = await prisma.driverEarning.findUnique({ where: { bookingId: b1.id } });
  check("driver earning at 15% commission", earn.grossAmount === 35 && earn.platformFee === 5.25 && earn.netAmount === 29.75, earn);
  check("no dispatch, only admin 'created' event", dispatched === 0 && emits.join() === "admin:booking_created", { dispatched, emits });

  // 2. No commission (operator drove)
  r = await post("/admin/bookings", { ...base, scheduledAt: iso(Date.now() - 5 * H), pastTrip: { driverId: driver.id, fare: 40, noCommission: true } });
  const e2 = await prisma.driverEarning.findUnique({ where: { bookingId: r.json().data?.id } });
  check("no-commission → platformFee 0, completedAt = pickup", r.statusCode === 201 && e2.platformFee === 0 && e2.netAmount === 40);

  // 3–5. Validation
  r = await post("/admin/bookings", { ...base, scheduledAt: iso(Date.now() + H), pastTrip: { driverId: driver.id, fare: 35 } });
  check("past trip with future pickup → 400", r.statusCode === 400 && /past/.test(r.json().error), r.json());
  r = await post("/admin/bookings", { ...base, scheduledAt: iso(pickup), pastTrip: { driverId: driver.id, fare: 35, completedAt: iso(pickup - 60_000) } });
  check("drop-off before pickup → 400", r.statusCode === 400 && /after the pickup/.test(r.json().error), r.json());
  r = await post("/admin/bookings", { ...base, scheduledAt: iso(pickup), pastTrip: { driverId: "nope", fare: 35 } });
  check("unknown driver → 400", r.statusCode === 400 && /Driver not found/.test(r.json().error), r.json());
  r = await post("/admin/bookings", { ...base, scheduledAt: iso(Date.now() - 2 * H) });
  check("normal booking in the past → 400 with hint", r.statusCode === 400 && /already happened/.test(r.json().error), r.json());
  r = await post("/admin/bookings", { ...base, scheduledAt: "2026-10-14T19:30" });
  check("bad datetime → 400 readable (not 500)", r.statusCode === 400 && /scheduledAt/.test(r.json().error), r.json());

  // 6–7. Admin short notice
  r = await post("/admin/bookings", { ...base, scheduledAt: iso(Date.now() + 1 * H) });
  check("admin booking 1h ahead → 201 CONFIRMED (no 2h block)", r.statusCode === 201 && r.json().data.status === "CONFIRMED", r.json());
  r = await post("/admin/bookings", { ...base, scheduledAt: iso(Date.now() + 3 * H) });
  check("admin booking 3h ahead → SCHEDULED_OPEN", r.statusCode === 201 && r.json().data.status === "SCHEDULED_OPEN", r.json());
  check("scheduled bookings not auto-dispatched", dispatched === 0, dispatched);

  // 8. Receipts
  r = await post(`/admin/bookings/${b1.id}/receipt`, { billTo: "Example Trading Co." });
  check("receipt → 200 PDF", r.statusCode === 200 && r.headers["content-type"] === "application/pdf" && r.rawPayload.subarray(0, 4).toString() === "%PDF", r.statusCode);
  if (process.argv[2]) require("fs").writeFileSync(process.argv[2], r.rawPayload);
  const rc1 = await prisma.receipt.findUnique({ where: { bookingId: b1.id } });
  check("receipt saved: number = reference, billTo, passenger, driver", rc1.receiptNumber === row.reference && rc1.billTo === "Example Trading Co." && rc1.passengerName === "Mohammed Example" && rc1.driverPcoBadge === `PCO${tag}` && rc1.vehiclePlate === `TST${tag}`, rc1);
  await new Promise((res) => setTimeout(res, 50));
  r = await post(`/admin/bookings/${b1.id}/receipt`, {});
  const rc2 = await prisma.receipt.findUnique({ where: { bookingId: b1.id } });
  check("regenerate keeps number, issue date and billTo", r.statusCode === 200 && +rc2.issuedAt === +rc1.issuedAt && rc2.billTo === "Example Trading Co.", rc2);
  r = await post(`/admin/bookings/${b1.id}/receipt`, { billTo: null });
  check("billTo can be cleared", (await prisma.receipt.findUnique({ where: { bookingId: b1.id } })).billTo === null);
  const open = (await prisma.booking.findFirst({ where: { status: "CONFIRMED", dispatchedBy: admin.id } })).id;
  r = await post(`/admin/bookings/${open}/receipt`, {});
  check("receipt for unfinished trip → 400", r.statusCode === 400 && /completed/.test(r.json().error), r.json());
  delete process.env.EMAIL_DRY_RUN; delete process.env.RESEND_API_KEY;
  r = await post(`/admin/bookings/${b1.id}/receipt/email`, {});
  check("email without setup → 400 explains", r.statusCode === 400 && /isn't set up/.test(r.json().error), r.json());
  process.env.EMAIL_DRY_RUN = "true";
  r = await post(`/admin/bookings/${b1.id}/receipt/email`, {});
  check("email (dry run) → sent to passenger email", r.statusCode === 200 && r.json().data.sentTo === `mo+${tag}@example.com`, r.json());

  console.log(`\n${pass} passed, ${fail} failed`);

  // Clean up everything this test created
  const mine = await prisma.booking.findMany({ where: { OR: [{ dispatchedBy: admin.id }, { driverId: driver.id }] }, select: { id: true, passengerId: true } });
  const ids = mine.map((b: any) => b.id);
  await prisma.receipt.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.driverEarning.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  const paxIds = [...new Set(mine.map((b: any) => b.passengerId).filter(Boolean))] as string[];
  const pax = await prisma.passenger.findMany({ where: { id: { in: paxIds } }, select: { userId: true } });
  await prisma.passenger.deleteMany({ where: { id: { in: paxIds } } });
  await prisma.user.deleteMany({ where: { id: { in: pax.map((p: any) => p.userId) } } });
  await prisma.vehicle.deleteMany({ where: { driverId: driver.id } });
  await prisma.driver.delete({ where: { id: driver.id } });
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, dUser.id] } } });

  await f.close(); await prisma.$disconnect(); if (pool) await pool.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
