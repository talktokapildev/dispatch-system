// backend/scripts/test-flight-board.ts
//
// Website flight status: refresh timing, units floor, back-off, lookup cap/cache and the
// routes' site-key check. In-memory Redis and a fake provider — no network, database or SMS.
//
//   SMS_DRY_RUN=true node --env-file=.env -r ts-node/register scripts/test-flight-board.ts
import Fastify from "fastify";
import axios from "axios";
import type {} from "../src/plugins/database"; // fastify.prisma type (module augmentation only)

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

// ── In-memory Redis (only what the code uses) ───────────────────────────────
class FakeRedis {
  store = new Map<string, string>();
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
  async mget(...ks: string[]) {
    return ks.map((k) => this.store.get(k) ?? null);
  }
  zsets = new Map<string, Map<string, number>>();
  async zadd(k: string, score: number, m: string) {
    const z = this.zsets.get(k) ?? new Map();
    z.set(m, score);
    this.zsets.set(k, z);
    return 1;
  }
  async zremrangebyscore(k: string, min: number, max: number) {
    const z = this.zsets.get(k);
    if (z) for (const [m, sc] of z) if (sc >= min && sc <= max) z.delete(m);
    return 1;
  }
  async zrangebyscore(k: string, min: number) {
    const z = this.zsets.get(k) ?? new Map<string, number>();
    return [...z].filter(([, sc]) => sc >= min).map(([m]) => m);
  }
  async set(k: string, v: string, ...args: unknown[]) {
    if (args.includes("NX") && this.store.has(k)) return null;
    this.store.set(k, v);
    return "OK";
  }
  async del(k: string) {
    return this.store.delete(k) ? 1 : 0;
  }
  async incr(k: string) {
    const n = Number(this.store.get(k) ?? 0) + 1;
    this.store.set(k, String(n));
    return n;
  }
  async expire() {
    return 1;
  }
}

// ── Fake provider ───────────────────────────────────────────────────────────
type Call = { url: string; params: any };
let calls: Call[] = [];
let nextStatus = 200;
let units = "4000";
const tm = (utc: string) => ({ utc: utc.replace("T", " ").slice(0, 16) + "Z", local: utc.slice(0, 16) + "+01:00" });
const boardBody = {
  arrivals: [
    {
      number: "U2 8687",
      status: "EnRoute",
      codeshareStatus: "IsOperator",
      isCargo: false,
      airline: { name: "easyJet", iata: "U2", icao: "EZY" },
      departure: { airport: { iata: "AMS", municipalityName: "Amsterdam" }, scheduledTime: tm("2026-10-23T18:25"), runwayTime: tm("2026-10-23T18:41"), quality: ["Live"] },
      arrival: { airport: { iata: "LGW" }, scheduledTime: tm("2026-10-23T20:10"), revisedTime: tm("2026-10-23T20:19"), terminal: "N", quality: ["Live"] },
    },
  ],
  departures: [],
};
const lookupBody = [
  {
    number: "BA 2541",
    status: "Expected",
    codeshareStatus: "IsOperator",
    isCargo: false,
    airline: { name: "British Airways", iata: "BA", icao: "BAW" },
    departure: { airport: { iata: "FCO", municipalityName: "Rome" }, scheduledTime: tm("2026-10-24T13:00"), quality: ["Basic"] },
    arrival: { airport: { iata: "LGW" }, scheduledTime: tm("2026-10-24T15:45"), terminal: "S", quality: ["Basic"] },
  },
];
(axios as any).get = async (url: string, opts: any) => {
  calls.push({ url, params: opts?.params });
  const body = url.includes("/flights/airports/") ? boardBody : lookupBody;
  return { status: nextStatus, data: nextStatus === 200 ? body : null, headers: { "x-ratelimit-api-units-remaining": units } };
};

async function main() {
  process.env.AERODATABOX_API_KEY = "test-key";
  delete process.env.ADMIN_ALERT_PHONE; // ops alerts only log
  process.env.FLIGHT_BOARD_REFRESH_MIN = "30";
  process.env.FLIGHT_BOARD_UNITS_FLOOR = "1500";
  process.env.FLIGHT_STATUS_LOOKUPS_PER_DAY = "2";
  const svc = await import("../src/services/flightBoard.service");

  const redis = new FakeRedis();
  const logs: string[] = [];
  const log = { warn: (m: string) => logs.push(m) };
  const deps = { redis: redis as any, prisma: { systemSetting: { findMany: async () => [] } } as any, log };
  const NOW = new Date("2026-10-23T12:00:00Z"); // 13:00 UK

  // ── Refresh ──
  delete process.env.FLIGHT_BOARD_ENABLED;
  check("off unless enabled", (await svc.refreshBoardIfDue(deps, NOW)) === "disabled" && calls.length === 0);
  process.env.FLIGHT_BOARD_ENABLED = "true";
  check("first refresh", (await svc.refreshBoardIfDue(deps, NOW)) === "refreshed" && calls.length === 1);
  const c = calls[0];
  check(
    "one call, both directions, with the other end",
    c.url.endsWith("/flights/airports/iata/LGW/2026-10-23T11:00/2026-10-23T22:59") &&
      c.params.direction === "Both" &&
      c.params.withLeg === true &&
      c.params.withCodeshared === true,
    c.url
  );
  check("units remembered", (await redis.get("adb:units:remaining")) === "4000");
  const stored = await svc.getBoard(redis as any);
  check("board stored", stored?.flights.length === 1 && stored.fetchedAt === NOW.toISOString());
  check("not again within 30 min", (await svc.refreshBoardIfDue(deps, new Date(NOW.getTime() + 20 * 60_000))) === "fresh" && calls.length === 1);
  check("again after 30 min", (await svc.refreshBoardIfDue(deps, new Date(NOW.getTime() + 30 * 60_000))) === "refreshed" && calls.length === 2);

  const night = new Date("2026-10-24T01:00:00Z"); // 02:00 UK
  await redis.set("flightboard:LGW:data", JSON.stringify({ ...stored, fetchedAt: new Date(night.getTime() - 40 * 60_000).toISOString() }));
  check("night: hourly at most", (await svc.refreshBoardIfDue(deps, night)) === "fresh" && calls.length === 2);

  // Provider error → 5-min back-off, old data kept.
  await redis.del("flightboard:LGW:data");
  nextStatus = 500;
  check("provider error", (await svc.refreshBoardIfDue(deps, NOW)) === "provider_error");
  check("backs off", (await svc.refreshBoardIfDue(deps, NOW)) === "backoff" && calls.length === 3);
  await redis.del("flightboard:LGW:backoff");
  nextStatus = 200;

  // Units floor: booking tracking comes first.
  await redis.set("adb:units:remaining", "1200");
  const before = calls.length;
  check("units floor stops refresh", (await svc.refreshBoardIfDue(deps, NOW)) === "units_floor" && calls.length === before);
  check("ops alert once a day", logs.filter((l) => l.includes("paused")).length === 1);
  await svc.refreshBoardIfDue(deps, NOW);
  check("no second alert", logs.filter((l) => l.includes("paused")).length === 1);
  await redis.set("adb:units:remaining", "4000");
  check("resumes above floor", (await svc.refreshBoardIfDue(deps, NOW)) === "refreshed");

  // ── On-demand lookup ──
  calls = [];
  const lk = await svc.lookupFlight(deps, "BA2541", "2026-10-24", NOW);
  check("lookup found", lk.status === "FOUND" && calls.length === 1, lk.status);
  check(
    "lookup call by number and date",
    calls[0].url.endsWith("/flights/number/BA2541/2026-10-24") && calls[0].params.dateLocalRole === "Both"
  );
  await svc.lookupFlight(deps, "ba 2541", "2026-10-24", NOW);
  check("second lookup from cache", calls.length === 1);
  check("wrong date → not found", (await svc.lookupFlight(deps, "BA2541", "2026-10-25", NOW)).status === "NOT_FOUND");
  check("daily cap", (await svc.lookupFlight(deps, "BA2542", "2026-10-24", NOW)).status === "BUSY" && calls.length === 2);
  check("bad input", (await svc.lookupFlight(deps, "hello", "2026-10-24", NOW)).status === "INVALID");
  check("too far ahead", (await svc.lookupFlight(deps, "BA2541", "2027-12-01", NOW)).status === "INVALID");

  // ── Routes ──
  const { publicFlightStatusRoutes } = await import("../src/routes/publicFlightStatus");
  const app = Fastify();
  app.decorate("redis", redis as any);
  app.decorate("prisma", deps.prisma);
  await app.register(publicFlightStatusRoutes, { prefix: "/api/v1" });
  await app.ready();

  process.env.NODE_ENV = "production";
  delete process.env.FLIGHT_STATUS_SITE_KEY;
  let r = await app.inject({ method: "GET", url: "/api/v1/public/flight-status/board" });
  check("production without key set → 503", r.statusCode === 503);
  process.env.FLIGHT_STATUS_SITE_KEY = "s3cret-site-key";
  r = await app.inject({ method: "GET", url: "/api/v1/public/flight-status/board", headers: { "x-site-key": "wrong" } });
  check("wrong key → 403", r.statusCode === 403);
  const H = { "x-site-key": "s3cret-site-key" };

  // Board relative to the stored data (fetched at NOW).
  const realNow = Date.now;
  Date.now = () => new Date("2026-10-23T19:41:00Z").getTime();
  const RealDate = Date;
  (global as any).Date = class extends RealDate {
    constructor(...a: any[]) {
      super(...((a.length ? a : [RealDate.now()]) as []));
    }
    static now() {
      return new RealDate("2026-10-23T19:41:00Z").getTime();
    }
  };
  r = await app.inject({ method: "GET", url: "/api/v1/public/flight-status/board", headers: H });
  const board = r.json().data;
  check("board ok", r.statusCode === 200 && board.arrivals.length === 1 && board.departures.length === 0);
  check("board row is compact", board.arrivals[0].view.state === "EN_ROUTE" && !("keys" in board.arrivals[0]));
  check("board marked stale (7 h old)", board.stale === true);
  check("row: ticket-style number", board.arrivals[0].displayNumber === "EZY8687", board.arrivals[0].displayNumber);
  check("row: airline code + country", board.arrivals[0].airlineIata === "U2" && "countryCode" in board.arrivals[0].other);
  check("board: weather map present", typeof board.weather === "object");

  r = await app.inject({ method: "GET", url: "/api/v1/public/flight-status/flight/EZY8687", headers: H });
  check("flight page from board", r.json().data.status === "FOUND" && r.json().data.source === "BOARD");
  check("flight has view", r.json().data.flights[0].view.gateAt === "2026-10-23T20:19:00.000Z");
  await redis.set("weather:LGW", JSON.stringify({ w: { tempC: 11, kind: "rain", night: true, text: "Light rain", windMph: 18, at: "x" }, fetchedAt: "x" }));
  r = await app.inject({ method: "GET", url: "/api/v1/public/flight-status/flight/EZY8687", headers: H });
  check("flight page: cached Gatwick weather", r.json().data.weather?.LGW?.tempC === 11);
  check("flight page: ticket-style number", r.json().data.flights[0].flight.displayNumber === "EZY8687");
  const callsBefore = calls.length;
  r = await app.inject({ method: "GET", url: "/api/v1/public/flight-status/flight/BA9999?date=2026-10-24", headers: H });
  check("page load never calls provider", r.json().data.status === "NOT_IN_BOARD" && calls.length === callsBefore);
  r = await app.inject({ method: "GET", url: "/api/v1/public/flight-status/flight/EZY8687?date=2026-10-30", headers: H });
  check("remembered flight on another day → SEEN", r.json().data.status === "SEEN" && r.json().data.seen[0].usualTimeUk === "21:10", r.json().data.status);
  r = await app.inject({ method: "GET", url: "/api/v1/public/flight-status/sitemap", headers: H });
  check("sitemap lists seen flights", r.json().data.numbers.includes("EZY8687"), JSON.stringify(r.json().data));
  check("sitemap: no airline page below the flight minimum", Array.isArray(r.json().data.airlines) && r.json().data.airlines.length === 0);

  // ── Which terminal (airline pages) ──
  r = await app.inject({ method: "GET", url: "/api/v1/public/flight-status/flight/EZY8687", headers: H });
  check("flight reply carries its airline page", r.json().data.flights[0].flight.airlineSlug === "easyjet");
  const fx = r.json().data.flights[0];
  check("flight reply: forecast block (arrival: Gatwick only)", !!fx.forecast && "lgw" in fx.forecast && fx.forecast.otherAt === null);
  check("flight reply: no return flights for an arrival", Array.isArray(fx.returns) && fx.returns.length === 0);
  r = await app.inject({ method: "GET", url: "/api/v1/public/flight-status/flight/EZY8687?date=2026-10-30", headers: H });
  check("seen reply carries its airline page", r.json().data.seen[0].airlineSlug === "easyjet");
  r = await app.inject({ method: "GET", url: "/api/v1/public/flight-status/terminals", headers: { "x-site-key": "wrong" } });
  check("terminals: wrong key → 403", r.statusCode === 403);
  r = await app.inject({ method: "GET", url: "/api/v1/public/flight-status/terminals", headers: H });
  const ezyLine = r.json().data.airlines.find((a: any) => a.slug === "easyjet");
  check("terminals: easyJet recorded by the refresh", !!ezyLine && ezyLine.flights === 1 && ezyLine.hasPage === false, JSON.stringify(ezyLine));
  r = await app.inject({ method: "GET", url: "/api/v1/public/flight-status/terminals/easyjet", headers: H });
  check("airline page: found, old board not used", r.json().data.status === "FOUND" && r.json().data.board.stale === true && r.json().data.board.arrivals.length === 0);
  const storedBoard = JSON.parse((await redis.get("flightboard:LGW:data"))!);
  await redis.set("flightboard:LGW:data", JSON.stringify({ ...storedBoard, fetchedAt: "2026-10-23T19:35:00.000Z" }));
  r = await app.inject({ method: "GET", url: "/api/v1/public/flight-status/terminals/easyjet", headers: H });
  const ap = r.json().data;
  check("airline page: its flights from a fresh board", ap.board.stale === false && ap.board.arrivals.length === 1 && ap.board.arrivals[0].displayNumber === "EZY8687");
  check("airline page: no other airline's flights", ap.board.departures.length === 0);
  r = await app.inject({ method: "GET", url: "/api/v1/public/flight-status/terminals/no-such-airline", headers: H });
  check("airline page: unknown → NOT_FOUND", r.json().data.status === "NOT_FOUND");
  r = await app.inject({ method: "GET", url: "/api/v1/public/flight-status/terminals/BAD%20slug!", headers: H });
  check("airline page: bad slug → NOT_FOUND", r.json().data.status === "NOT_FOUND");
  await redis.set("flightboard:LGW:data", JSON.stringify(storedBoard));
  r = await app.inject({ method: "GET", url: "/api/v1/public/flight-status/flight/nonsense", headers: H });
  check("bad number", r.json().data.status === "INVALID");

  r = await app.inject({
    method: "POST",
    url: "/api/v1/public/flight-status/lookup",
    headers: { ...H, "x-visitor-ip": "203.0.113.9" },
    payload: { number: "EZY8687", date: "2026-10-23" },
  });
  check("lookup uses board first (free)", r.json().data.source === "BOARD" && calls.length === callsBefore);
  r = await app.inject({
    method: "POST",
    url: "/api/v1/public/flight-status/lookup",
    headers: { ...H, "x-visitor-ip": "203.0.113.9" },
    payload: { number: "BA2541", date: "2026-10-24" },
  });
  check("lookup outside board (cached)", r.json().data.status === "FOUND" && r.json().data.source === "LOOKUP");
  const callsNow = calls.length;
  r = await app.inject({ method: "GET", url: "/api/v1/public/flight-status/flight/BA2541?date=2026-10-24", headers: H });
  check("shared link serves the cached lookup", r.json().data.source === "LOOKUP" && calls.length === callsNow);
  r = await app.inject({ method: "GET", url: "/api/v1/public/flight-status/flight/BA2541", headers: H });
  check("no date: board only", r.json().data.status === "NOT_IN_BOARD");
  for (let i = 0; i < 10; i++)
    r = await app.inject({
      method: "POST",
      url: "/api/v1/public/flight-status/lookup",
      headers: { ...H, "x-visitor-ip": "203.0.113.9" },
      payload: { number: "BA2541", date: "2026-10-24" },
    });
  check("per-visitor limit", r.statusCode === 429);

  (global as any).Date = RealDate;
  Date.now = realNow;
  await app.close();
  console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
