// Admin routes for Araa's bookings and settings (routes/admin/voiceBookings.ts), with a fake DB.
// DATABASE_URL=postgres://x JWT_SECRET=x SMS_DRY_RUN=true TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register scripts/test-voice-bookings-routes.ts
import Fastify from "fastify";
import { adminVoiceBookingRoutes } from "../src/routes/admin/voiceBookings";

let pass = 0,
  fail = 0;
const check = (n: string, ok: boolean, d?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}`, ok ? "" : JSON.stringify(d ?? "").slice(0, 500));
};

const future = new Date(Date.now() + 3 * 24 * 3_600_000);
function world() {
  const bookings = new Map<string, any>();
  const base = {
    status: "CONFIRMED",
    isOnHold: true,
    scheduledAt: future,
    pickupAddress: "Gatwick North Terminal: Car Park 6, Level 4",
    dropoffAddress: "Brighton Railway Station",
    estimatedFare: 67.42,
    reference: "DSTEST1",
    pickupOffsetMinutes: null,
    luggageType: "CHECKED",
    meetingPointId: "mp-north",
    passenger: { user: { phone: "+447587545986", firstName: "Kapil" } },
    voiceCall: { id: "vc1" },
  };
  bookings.set("b-flight", { id: "b-flight", ...base, flightNumber: "EZY8004" });
  bookings.set("b-plain", { id: "b-plain", ...base, flightNumber: null, meetingPointId: null, reference: "DSTEST2" });
  bookings.set("b-done", { id: "b-done", ...base, isOnHold: false, status: "SCHEDULED_OPEN" });
  const settings = new Map<string, string>();
  const history: any[] = [];
  const prisma: any = {
    booking: {
      findUnique: async ({ where }: any) => bookings.get(where.id) ?? null,
      update: async ({ where, data }: any) => Object.assign(bookings.get(where.id), data),
    },
    bookingStatusHistory: { create: async ({ data }: any) => history.push(data) },
    $transaction: async (ops: any[]) => Promise.all(ops),
    systemSetting: {
      findMany: async () => [...settings].map(([key, value]) => ({ key, value })),
      upsert: async ({ where, create }: any) => settings.set(where.key, create.value),
    },
    airportMeetingPoint: {
      findFirst: async () => ({ id: "mp-north", airportIata: "LGW", terminal: "NORTH", name: "Car Park 6, Level 4", latitude: 51.16, longitude: -0.17 }),
    },
    voiceCall: { findMany: async () => [], count: async () => 2, findUnique: async () => null },
  };
  const redis: any = { get: async () => null, set: async () => "OK", incr: async () => 1, expire: async () => 1 };
  return { bookings, settings, history, prisma, redis };
}

async function main() {
  delete process.env.AERODATABOX_API_KEY;
  delete process.env.RAPIDAPI_KEY;
  const w = world();
  const app = Fastify();
  app.decorate("prisma", w.prisma);
  app.decorate("redis", w.redis);
  app.decorate("io", { to: () => ({ emit: () => {} }) } as any);
  app.decorate("authenticateAdmin", async (req: any) => {
    req.user = { userId: "admin-kapil" };
  });
  app.register(adminVoiceBookingRoutes, { prefix: "/api/v1" });
  await app.ready();
  const post = (url: string, payload: any = {}) => app.inject({ method: "POST", url: `/api/v1${url}`, payload });

  // Plain booking: approved, on the board, admin recorded as dispatcher
  let r = await post("/admin/bookings/b-plain/approve-request");
  const plain = w.bookings.get("b-plain");
  check("approve: 200, job board, off hold, dispatcher = admin", r.statusCode === 200 && plain.status === "SCHEDULED_OPEN" && plain.isOnHold === false && plain.dispatchedBy === "admin-kapil", r.json());
  check("approve: history note", w.history.some((h) => h.bookingId === "b-plain" && /approved; on the job board/.test(h.note)));
  r = await post("/admin/bookings/b-plain/approve-request");
  check("approve twice → 400", r.statusCode === 400);
  r = await post("/admin/bookings/b-done/decline-request");
  check("decline a booking not waiting → 400", r.statusCode === 400);

  // Flight booking: the flight can't be checked here (no provider key) → 409, nothing changed
  r = await post("/admin/bookings/b-flight/approve-request");
  const fl = w.bookings.get("b-flight");
  check("flight check problem → 409 with the reason, booking unchanged", r.statusCode === 409 && r.json().code === "flight_check" && /EZY8004/.test(r.json().error) && fl.isOnHold === true, r.json());
  r = await post("/admin/bookings/b-flight/approve-request", { skipFlightCheck: true });
  check("approve without flight check → approved, noted", r.statusCode === 200 && fl.isOnHold === false && w.history.some((h) => h.bookingId === "b-flight" && /flight not checked/.test(h.note)), r.json());

  // Settings
  r = await app.inject({ method: "GET", url: "/api/v1/admin/voice-agent/settings" });
  const s = r.json().data;
  check("settings: defaults when nothing saved", s.settings.mode === "ALWAYS" && s.settings.voice === "marin" && s.settings.minNoticeHours === 24 && s.voices.includes("shimmer"), s);
  const good = { mode: "HOURS", hours: "06:00 - 23:00", voice: "coral", greeting: "Hello, OrangeRide, Araa speaking. How can I help?", minNoticeHours: 12, alertPhone: "07398 341839" };
  r = await app.inject({ method: "PUT", url: "/api/v1/admin/voice-agent/settings", payload: good });
  check("settings saved and normalised", r.statusCode === 200 && w.settings.get("voiceAgentHours") === "06:00-23:00" && w.settings.get("voiceAgentAlertPhone") === "+447398341839" && r.json().data.settings.voice === "coral" && r.json().data.settings.minNoticeHours === 12, r.json());
  for (const [label, bad] of [
    ["bad hours", { ...good, hours: "6pm till late" }],
    ["unknown voice", { ...good, voice: "darth" }],
    ["short greeting", { ...good, greeting: "Hi" }],
    ["notice over a week", { ...good, minNoticeHours: 500 }],
    ["bad phone", { ...good, alertPhone: "12" }],
    ["bad mode", { ...good, mode: "SOMETIMES" }],
  ] as const) {
    r = await app.inject({ method: "PUT", url: "/api/v1/admin/voice-agent/settings", payload: bad });
    check(`settings rejected: ${label}`, r.statusCode === 400, r.json());
  }

  r = await app.inject({ method: "GET", url: "/api/v1/admin/voice-calls?outcome=AWAITING" });
  check("calls list returns items + awaiting count", r.statusCode === 200 && r.json().data.awaitingApproval === 2);

  await app.close();
  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}
main();
