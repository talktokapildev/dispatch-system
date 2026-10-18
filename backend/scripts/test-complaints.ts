// backend/scripts/test-complaints.ts
//
// Complaints / compliments register (TfL Condition 7), end to end against the LOCAL database
// and LOCAL Redis, through the real routes: complaint from the app, then a rating comment (both
// kept — they used to overwrite each other), what the passenger app receives (old text format,
// never the real operator notes), staff history / status / outcome / reopen, the 48-hour flag
// and the Compliance check, items logged by staff, compliments (logged and from a rating),
// refs under concurrent saves, the TfL record and register, the 12-month delete rule, pushes,
// the safety alert, and the record surviving when the passenger is deleted.
// Creates its own data and deletes it afterwards.
//
//   SMS_DRY_RUN=true node --env-file=.env -r ts-node/register scripts/test-complaints.ts
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
import { adminComplaintRoutes } from "../src/routes/admin/complaints";
import { complianceRoutes } from "../src/routes/compliance";
import { logItem, reportByPassenger, updateItem } from "../src/services/complaint.service";
import { ukYear } from "../src/services/lostPropertyRules";
import { dayKey, ukToday } from "../src/services/driverRegisterRules";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, info?: any) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && info !== undefined ? "  → " + JSON.stringify(info) : ""}`);
};
// What passenger app ≤ 1.0.12 does with a booking
const appComplaint = (b: any) => {
  const f = b?.feedback;
  if (!f || !f.startsWith("[COMPLAINT]")) return null;
  const lines = f.replace("[COMPLAINT] ", "").split("\n");
  return { category: lines[0]?.replace("Category: ", ""), description: lines.slice(1).join("\n").trim() };
};
const appResolution = (b: any) => b?.operatorNotes?.match(/\[ACK\][^\n]*Note: ([^\n]+)/)?.[1]?.trim() ?? null;

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
  const phone = (n: number) => `+4479320${tag}`.slice(0, 11) + String(n).padStart(2, "0");
  const created = { users: [] as string[], drivers: [] as string[], vehicles: [] as string[], passengers: [] as string[], bookings: [] as string[], items: [] as string[] };
  const year = ukYear(new Date());

  const admin = await prisma.user.create({ data: { phone: phone(90), firstName: "Admin", lastName: "Cp", roles: ["ADMIN"] } });
  const dispatcher = await prisma.user.create({ data: { phone: phone(91), firstName: "Dora", lastName: "Dispatch", roles: ["DISPATCHER"] } });
  created.users.push(admin.id, dispatcher.id);

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
  await f.register(adminComplaintRoutes, { prefix: "/api/v1" });
  await f.register(complianceRoutes, { prefix: "/api/v1" });
  await f.ready();
  const req = (method: any, url: string, payload?: any, user?: string) =>
    f.inject({ method, url: `/api/v1${url}`, payload, headers: user ? { "x-test-user": user } : {} });

  async function addPassenger(n: number, first: string) {
    const u = await prisma.user.create({ data: { phone: phone(n), firstName: first, lastName: "Cp", roles: ["PASSENGER"] } });
    const p = await prisma.passenger.create({ data: { userId: u.id } });
    created.users.push(u.id);
    created.passengers.push(p.id);
    return { userId: u.id as string, id: p.id as string, phone: u.phone as string };
  }
  async function addBooking(n: number, passengerId: string, extra: any = {}) {
    const b = await prisma.booking.create({
      data: {
        reference: `DSMCP${tag}${n}`, passengerId, type: "ASAP", status: "COMPLETED",
        pickupAddress: "Gatwick South", pickupLatitude: 51.15, pickupLongitude: -0.16,
        dropoffAddress: "Crawley", dropoffLatitude: 51.1, dropoffLongitude: -0.18,
        estimatedFare: 25, completedAt: new Date(Date.now() - 3600_000), ...extra,
      },
    });
    created.bookings.push(b.id);
    return b;
  }

  try {
    // ── Set up ──
    let r = await req("POST", "/admin/drivers", {
      firstName: "Dee", lastName: "Cp", phone: phone(1), pcoBadgeNumber: `PC${tag}1`,
      pcoLicenseExpiry: "2099-01-01", drivingLicenseNumber: "CP1", availableFrom: dayKey(ukToday()),
    });
    check("create driver", r.statusCode === 201, r.json());
    const driver = { id: r.json().data.driver.id, userId: r.json().data.user.id };
    created.users.push(driver.userId);
    created.drivers.push(driver.id);
    const plate = `CP${tag}`;
    r = await req("POST", "/admin/vehicles", { make: "Tesla", model: "Model Y", year: 2022, colour: "White", licensePlate: plate, motExpiry: "2027-05-01", insuranceExpiry: "2027-11-14", driverId: driver.id });
    const car = r.json().data;
    created.vehicles.push(car.id);
    const ann = await addPassenger(2, "Ann");
    const bob = await addPassenger(3, "Bob");
    const b1 = await addBooking(1, ann.id, { driverId: driver.id, vehicleId: car.id, operatorNotes: "Gate code 1234 — internal" });
    const b2 = await addBooking(2, ann.id, { operatorNotes: "VIP, don't be late" });
    const bBob = await addBooking(3, bob.id, { driverId: driver.id, vehicleId: car.id });

    // ── Complaint from the app ──
    r = await req("POST", `/passengers/bookings/${b1.id}/complaint`, { category: "Late arrival", description: " 20 minutes late \n missed my train " }, ann.userId);
    check("app complaint → 200 with ref", r.statusCode === 200 && new RegExp(`^CC-${year}-\\d{3,}$`).test(r.json().data?.refNo), r.json());
    const ref1 = r.json().data.refNo;
    check("admin socket event has the ref", sockets.some((s) => s.ev === "admin:complaint" && s.data.refNo === ref1));
    let c1 = await prisma.complaint.findUnique({ where: { refNo: ref1 } });
    created.items.push(c1.id);
    check("copied: driver, vehicle, complainant, booking time", c1.driverName === "Dee Cp" && c1.vehicleReg === plate && c1.complainantName === "Ann Cp" && c1.complainantPhone === ann.phone && c1.bookingDateTime?.getTime() === b1.completedAt.getTime(), c1);
    check("app channel, received, details trimmed", c1.channel === "APP" && c1.status === "RECEIVED" && c1.details === "20 minutes late\nmissed my train" && c1.category === "Late arrival");
    let bk = await prisma.booking.findUnique({ where: { id: b1.id } });
    check("booking.feedback NOT touched by the complaint", bk.feedback === null);

    // ── Rating comment afterwards: both kept ──
    r = await req("POST", `/passengers/bookings/${b1.id}/rate`, { rating: 2, comment: "Driver was friendly though" }, ann.userId);
    check("rate with a comment → 200", r.statusCode === 200, r.json());
    bk = await prisma.booking.findUnique({ where: { id: b1.id } });
    check("rating comment kept in feedback", bk.feedback === "Driver was friendly though" && bk.rating === 2);
    check("complaint still there", !!(await prisma.complaint.findUnique({ where: { id: c1.id } })));

    // ── What the passenger app receives ──
    r = await req("GET", "/passengers/bookings?limit=50", undefined, ann.userId);
    const items = r.json().data.items;
    const h1 = items.find((b: any) => b.id === b1.id);
    const h2 = items.find((b: any) => b.id === b2.id);
    check("history: app still sees the complaint (old format)", JSON.stringify(appComplaint(h1)) === JSON.stringify({ category: "Late arrival", description: "20 minutes late\nmissed my train" }), h1?.feedback);
    check("history: real operator notes never sent", h1.operatorNotes === null && h2.operatorNotes === null, [h1.operatorNotes, h2.operatorNotes]);
    check("history: booking without complaint keeps its own feedback", appComplaint(h2) === null);
    r = await req("GET", `/passengers/bookings/${b1.id}`, undefined, ann.userId);
    check("single booking: same", appComplaint(r.json().data)?.category === "Late arrival" && r.json().data.operatorNotes === null, r.json().data?.operatorNotes);

    r = await req("POST", `/passengers/bookings/${b1.id}/complaint`, { category: "Other", description: "again" }, ann.userId);
    check("second app complaint on same booking → 400", r.statusCode === 400, r.json());
    r = await req("POST", `/passengers/bookings/${bBob.id}/complaint`, { category: "Other", description: "x" }, ann.userId);
    check("someone else's booking → 403", r.statusCode === 403, r.json());
    r = await req("POST", `/passengers/bookings/${b2.id}/complaint`, { description: "no category" }, ann.userId);
    check("no category → 400", r.statusCode === 400, r.json());

    // ── Admin list, 48-hour flag, Compliance ──
    r = await req("GET", "/admin/complaints");
    let row = r.json().data.find((x: any) => x.id === c1.id);
    check("admin list: labels, not overdue, nobody handling yet", row?.typeLabel === "Complaint" && row.statusLabel === "Received" && row.channelLabel === "App" && row.replyOverdue === false && row.handledByName === null, row);
    await prisma.complaint.update({ where: { id: c1.id }, data: { receivedAt: new Date(Date.now() - 50 * 3_600_000) } });
    r = await req("GET", "/admin/complaints");
    row = r.json().data.find((x: any) => x.id === c1.id);
    check("50 h, no reply → overdue", row.replyOverdue === true && row.hoursOpen >= 50, row);
    r = await req("GET", "/admin/compliance");
    const comp = (r.json().automated ?? []).find((x: any) => x.id === "complaints");
    check("Compliance: Condition 7 check warns", comp?.condition === 7 && comp.status === "WARN" && /1 reply overdue/.test(comp.value), comp ?? r.json());

    // ── Staff: note, investigating, resolve ──
    r = await req("PUT", `/admin/complaints/${c1.id}`, { note: "Called Ann, apologised; checking the trip log" });
    row = r.json().data;
    check("note → history, handled by the admin, no longer overdue", row.contacts.length === 1 && row.handledByName === "Admin Cp" && row.replyOverdue === false, row);
    r = await req("PUT", `/admin/complaints/${c1.id}`, { status: "INVESTIGATING", details: { handledByUserId: dispatcher.id } });
    row = r.json().data;
    check("investigating + handed to dispatcher", row.status === "INVESTIGATING" && row.handledByName === "Dora Dispatch" && row.contacts.some((c: any) => c.note === "Status: Received → Investigating"), row);
    r = await req("PUT", `/admin/complaints/${c1.id}`, { details: { handledByUserId: ann.userId } });
    check("handled by must be staff → 404", r.statusCode === 404, r.json());
    r = await req("PUT", `/admin/complaints/${c1.id}`, { status: "RESOLVED", resolutionNote: "Sorry" });
    check("resolve without outcome → 400", r.statusCode === 400 && /outcome/.test(r.json().error), r.json());
    r = await req("PUT", `/admin/complaints/${c1.id}`, { status: "RESOLVED", outcome: "UPHELD" });
    check("resolve without resolution → 400", r.statusCode === 400 && /resolution/i.test(r.json().error), r.json());
    r = await req("PUT", `/admin/complaints/${c1.id}`, { status: "RESOLVED", outcome: "UPHELD", resolutionNote: "Sorry Ann — £5 refunded\nand driver spoken to." });
    row = r.json().data;
    check("resolved: outcome, note, date, representative", row.status === "RESOLVED" && row.outcomeLabel === "Upheld" && !!row.resolvedAt && row.representativeName === "Admin Cp" && row.closedByUserId === admin.id, row);
    r = await req("GET", `/passengers/bookings?limit=50`, undefined, ann.userId);
    const h1r = r.json().data.items.find((b: any) => b.id === b1.id);
    check("app shows 'Resolved — <note>' (one line)", appResolution(h1r) === "Sorry Ann — £5 refunded and driver spoken to.", h1r.operatorNotes);
    r = await req("PUT", `/admin/complaints/${c1.id}`, { outcome: "PARTLY_UPHELD" });
    check("correct the outcome of a resolved complaint", r.json().data.outcome === "PARTLY_UPHELD" && r.json().data.status === "RESOLVED", r.json());
    r = await req("PUT", `/admin/complaints/${c1.id}`, { status: "INVESTIGATING" });
    row = r.json().data;
    check("reopen clears the result", row.outcome === null && row.resolutionNote === null && row.resolvedAt === null, row);
    r = await req("PUT", `/admin/complaints/${c1.id}`, { status: "RESOLVED", outcome: "NOT_UPHELD", resolutionNote: "GPS shows on time", representativeName: "Kapil Dev" });
    check("resolve again with a typed representative", r.json().data.representativeName === "Kapil Dev");
    r = await req("PUT", `/admin/complaints/${c1.id}`, { details: { bookingReference: b2.reference } });
    check("app complaint can't move booking", r.statusCode === 400, r.json());
    r = await req("PUT", `/admin/complaints/${c1.id}`, { details: { type: "COMPLIMENT" } });
    check("resolved can't switch to compliment", r.statusCode === 400, r.json());

    // ── Staff log ──
    r = await req("POST", "/admin/complaints", { details: "Charged £40 instead of £30", category: "Overcharged", complainantName: "Walk In", complainantAddress: " 1 High St \n Crawley ", complainantPhone: "+447700900111" });
    const phoneC = r.json().data;
    if (phoneC?.id) created.items.push(phoneC.id);
    check("staff log (phone default) → handled by admin", r.statusCode === 200 && phoneC.channel === "PHONE" && phoneC.handledByName === "Admin Cp" && phoneC.complainantAddress === "1 High St\nCrawley", r.json());
    check("refs consecutive", parseInt(phoneC.refNo.split("-")[2]) === parseInt(ref1.split("-")[2]) + 1, [ref1, phoneC.refNo]);
    r = await req("POST", "/admin/complaints", { details: "Driver was rude", channel: "EMAIL", bookingReference: bBob.reference.toLowerCase(), handledByUserId: dispatcher.id, note: "Email received, acknowledged" });
    const emailC = r.json().data;
    if (emailC?.id) created.items.push(emailC.id);
    check("staff log from booking: copies + chosen handler + note", r.statusCode === 200 && emailC.driverName === "Dee Cp" && emailC.complainantName === "Bob Cp" && emailC.handledByName === "Dora Dispatch" && emailC.contacts.length === 1, r.json());
    r = await req("POST", "/admin/complaints", { category: "Other" });
    check("no details → 400", r.statusCode === 400, r.json());
    r = await req("POST", "/admin/complaints", { details: "x", bookingReference: "NOPE1" });
    check("unknown booking → 404", r.statusCode === 404, r.json());
    r = await req("POST", "/admin/complaints", { details: "x", channel: "FAX" });
    check("bad channel → 400", r.statusCode === 400, r.json());
    r = await req("POST", "/admin/complaints", { details: "x", receivedAt: "2099-01-01T10:00" });
    check("received in the future → 400", r.statusCode === 400, r.json());

    // ── Compliments ──
    r = await req("POST", "/admin/complaints", { type: "COMPLIMENT", channel: "EMAIL", details: "Dee was brilliant with my luggage", bookingId: bBob.id });
    const comp1 = r.json().data;
    if (comp1?.id) created.items.push(comp1.id);
    check("log compliment", r.statusCode === 200 && comp1.type === "COMPLIMENT" && comp1.typeLabel === "Compliment", r.json());
    r = await req("PUT", `/admin/complaints/${comp1.id}`, { status: "RESOLVED", outcome: "UPHELD", resolutionNote: "x" });
    check("compliment can't be 'resolved'", r.statusCode === 400, r.json());
    r = await req("PUT", `/admin/complaints/${comp1.id}`, { status: "CLOSED", resolutionNote: "Passed to Dee" });
    check("compliment closed with note", r.json().data.status === "CLOSED" && r.json().data.resolutionNote === "Passed to Dee" && !!r.json().data.resolvedAt, r.json());
    r = await req("POST", `/admin/feedback/${b1.id}/compliment`);
    const fromRating = r.json().data;
    if (fromRating?.id) created.items.push(fromRating.id);
    check("rating comment → compliment", r.statusCode === 200 && fromRating.details === "Driver was friendly though" && fromRating.channel === "APP" && fromRating.type === "COMPLIMENT", r.json());
    r = await req("POST", `/admin/feedback/${b1.id}/compliment`);
    check("same comment twice → 400", r.statusCode === 400 && /Already recorded/.test(r.json().error), r.json());
    r = await req("POST", `/admin/feedback/${b2.id}/compliment`);
    check("no comment → 400", r.statusCode === 400, r.json());
    r = await req("GET", `/passengers/bookings/${bBob.id}`, undefined, bob.userId);
    check("app: compliments/staff-only items don't show as complaints… staff complaint does", appComplaint(r.json().data)?.description === "Driver was rude", r.json().data?.feedback);

    // ── Refs under concurrent saves ──
    const burst = await Promise.all(Array.from({ length: 8 }, (_, i) => req("POST", "/admin/complaints", { details: `Burst ${i}` })));
    const refs = burst.map((x) => x.json().data?.refNo).filter(Boolean);
    burst.forEach((x) => x.json().data?.id && created.items.push(x.json().data.id));
    const nums = refs.map((x: string) => parseInt(x.split("-")[2])).sort((a: number, b: number) => a - b);
    check("8 at once → 8 different refs, no gaps", new Set(refs).size === 8 && nums.every((n: number, i: number) => i === 0 || n === nums[i - 1] + 1), refs);

    // ── TfL record + register ──
    r = await req("GET", `/admin/complaints/${c1.id}/tfl-record`);
    const rec = r.json().data;
    check("record: template fields", rec.item.refNo === ref1 && rec.item.handledBy === "Dora Dispatch" && rec.item.bookingReference === b1.reference && rec.item.complainant.name === "Ann Cp" && rec.item.driverName === "Dee Cp", rec.item);
    check("record: history + result", rec.item.enquiries.length >= 5 && rec.item.result.outcome === "Not upheld" && rec.item.result.note === "GPS shows on time", rec.item.result);
    check("record: warns about missing address", rec.warnings.includes("Address") && !rec.warnings.includes("Handled by"), rec.warnings);
    r = await req("GET", `/admin/complaints/${phoneC.id}/tfl-record`);
    check("record: address lines", JSON.stringify(r.json().data.item.complainant.address) === JSON.stringify(["1 High St", "Crawley"]));
    const today = dayKey(ukToday());
    r = await req("GET", `/admin/tfl-records/complaints?from=${today}&to=${today}`);
    const reg = r.json().data;
    check("register today: staff items in, summary counts", [phoneC.id, emailC.id, comp1.id].every((id) => reg.rows.some((x: any) => x.id === id)) && reg.summary.compliments >= 2 && reg.summary.complaints >= 2, reg.summary);
    r = await req("GET", `/admin/tfl-records/complaints?from=2001-01-01&to=2001-01-02`);
    check("register other dates → none", r.json().data.rows.length === 0);
    r = await req("GET", `/admin/tfl-records/complaints?to=nope`);
    check("register bad date → 400", r.statusCode === 400);

    // ── Delete rule ──
    r = await req("DELETE", `/admin/complaints/${phoneC.id}`, { confirmRef: phoneC.refNo });
    check("delete open → 400", r.statusCode === 400, r.json());
    r = await req("DELETE", `/admin/complaints/${c1.id}`, { confirmRef: ref1 });
    check("delete resolved today → 400 with date", r.statusCode === 400 && /can be deleted from/.test(r.json().error), r.json());
    await prisma.complaint.update({ where: { id: c1.id }, data: { resolvedAt: new Date(Date.now() - 400 * 86_400_000) } });
    r = await req("DELETE", `/admin/complaints/${c1.id}`, { confirmRef: "CC-1999-001" });
    check("delete wrong ref → 400", r.statusCode === 400, r.json());
    r = await req("DELETE", `/admin/complaints/${c1.id}`, { confirmRef: ref1.toLowerCase() });
    check("delete after 12 months → 200, history gone", r.statusCode === 200 && (await prisma.complaintContact.count({ where: { complaintId: c1.id } })) === 0, r.json());

    // ── Push + safety alert (service with recorders) ──
    const pushes: any[] = [];
    const alerts: string[] = [];
    const deps = { prisma, log, push: async (userId: string, n: any) => { pushes.push({ userId, ...n }); return 1; }, alert: async (t: string) => { alerts.push(t); } };
    const s1 = await reportByPassenger(deps, { userId: ann.userId, bookingId: b2.id, category: "Safety concern", description: "Driver was on the phone at speed" });
    created.items.push(s1.complaint.id);
    check("safety concern → ops alert with ref + booking", alerts.length === 1 && alerts[0].includes(s1.complaint.refNo) && alerts[0].includes(b2.reference), alerts);
    await updateItem(deps, s1.complaint.id, { note: "Called Ann" }, admin.id);
    check("no push for a note", pushes.length === 0);
    await updateItem(deps, s1.complaint.id, { status: "RESOLVED", outcome: "UPHELD", resolutionNote: "Driver suspended pending review" }, admin.id);
    check("push to the passenger when resolved", pushes.length === 1 && pushes[0].userId === ann.userId && pushes[0].body.includes("Driver suspended") && pushes[0].data.refNo === s1.complaint.refNo, pushes);
    await updateItem(deps, s1.complaint.id, { outcome: "PARTLY_UPHELD" }, admin.id);
    check("no second push for a correction", pushes.length === 1);
    const noPax = await logItem(deps, { details: "Phoned in, no booking", category: "Safety concern" }, admin.id);
    created.items.push(noPax.id);
    check("staff-logged safety concern → alert too", alerts.length === 2);
    await updateItem(deps, noPax.id, { status: "RESOLVED", outcome: "WITHDRAWN", resolutionNote: "Caller withdrew" }, admin.id);
    check("no passenger → no push", pushes.length === 1);
    const broken = { prisma, log, push: async () => { throw new Error("Expo down"); }, alert: async () => { throw new Error("Twilio down"); } };
    const ok = await logItem(broken, { details: "x", category: "Safety concern" }, admin.id).then((x: any) => { created.items.push(x.id); return true; }, () => false);
    check("alert failure doesn't fail the save", ok);

    // ── Passenger deleted: record stays ──
    r = await req("DELETE", `/admin/passengers/${bob.id}`);
    check("delete passenger Bob (with complaints) → 200", r.statusCode === 200, r.json());
    const kept = await prisma.complaint.findUnique({ where: { id: emailC.id } });
    check("record kept, links cleared, copies kept", !!kept && kept.passengerId === null && kept.bookingId === null && kept.complainantName === "Bob Cp" && kept.driverName === "Dee Cp", kept);
    created.users = created.users.filter((u) => u !== bob.userId);
    created.bookings = created.bookings.filter((b) => b !== bBob.id);
  } catch (e) {
    check("no unexpected error", false, (e as Error).stack);
  } finally {
    await prisma.complaint.deleteMany({ where: { id: { in: created.items } } });
    await prisma.booking.deleteMany({ where: { id: { in: created.bookings } } });
    await prisma.driverDocument.deleteMany({ where: { vehicleId: { in: created.vehicles } } });
    await prisma.vehicle.deleteMany({ where: { id: { in: created.vehicles } } });
    await prisma.passenger.deleteMany({ where: { id: { in: created.passengers }, user: { id: { in: created.users } } } });
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
