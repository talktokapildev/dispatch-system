// backend/scripts/test-train-board.ts
//
// Website train times (Three Bridges): Darwin JSON parsing, UK clock times across midnight
// and BST, paging when Darwin caps rows, the 1-minute refresh (key missing / refused, daily
// cap, quiet hours), and the two website routes. In-memory Redis and a fake National Rail —
// no network.
//
//   TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register scripts/test-train-board.ts
import axios from "axios";
import Fastify from "fastify";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

class FakeRedis {
  store = new Map<string, string>();
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
  async mget(...ks: string[]) {
    return ks.map((k) => this.store.get(k) ?? null);
  }
  async set(k: string, v: string, ...a: unknown[]) {
    if (a.includes("NX") && this.store.has(k)) return null;
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
  multi() {
    const ops: [string, string][] = [];
    const self = this;
    return {
      set(k: string, v: string) {
        ops.push([k, v]);
        return this;
      },
      async exec() {
        for (const [k, v] of ops) self.store.set(k, v);
        return [];
      },
    };
  }
}

// ── A Darwin board, shaped like the Rail Data Marketplace JSON ──
const cp = (locationName: string, crs: string, st: string, et?: string, at?: string, extra: object = {}) => ({
  locationName,
  crs,
  st,
  ...(et ? { et } : {}),
  ...(at ? { at } : {}),
  ...extra,
});
const svc = (id: string, o: any) => ({
  serviceID: id,
  operator: "Southern",
  operatorCode: "SN",
  origin: [{ locationName: "London Victoria", crs: "VIC" }],
  destination: [{ locationName: "Brighton", crs: "BTN" }],
  ...o,
});
const BOARD = {
  generatedAt: "2026-10-24T22:50:00+01:00",
  locationName: "Three Bridges",
  crs: "TBD",
  nrccMessages: [{ Value: '<p>Disruption between Three Bridges and Brighton. <a href="https://x">More details</a></p>' }],
  trainServices: [
    svc("A1", {
      sta: "22:48",
      eta: "22:56",
      std: "22:49",
      etd: "22:57",
      platform: "3",
      length: 8,
      delayReason: "This train has been delayed by a train in front",
      previousCallingPoints: [
        {
          callingPoint: [
            cp("London Victoria", "VIC", "22:10", undefined, "22:11"),
            cp("East Croydon", "ECR", "22:25", undefined, "22:33"),
            cp("Redhill", "RDH", "22:37", "22:45"),
          ],
        },
      ],
      subsequentCallingPoints: [{ callingPoint: [cp("Brighton", "BTN", "23:20", "23:28")] }],
    }),
    svc("A2", { sta: "23:18", eta: "Cancelled", std: "23:19", etd: "Cancelled", isCancelled: true, cancelReason: "A fault with the signalling system" }),
    svc("A3", {
      std: "23:59",
      etd: "On time",
      platform: "4",
      operator: "Thameslink",
      operatorCode: "TL",
      origin: [{ locationName: "Three Bridges", crs: "TBD" }],
      destination: [{ locationName: "Bedford", crs: "BDM", via: "via London Bridge" }],
      subsequentCallingPoints: [{ callingPoint: [cp("Bedford", "BDM", "00:40", "On time")] }],
    }),
    svc("A4", { sta: "23:05", eta: "Delayed", destination: [{ locationName: "Three Bridges", crs: "TBD" }] }),
    { operator: "Southern" }, // no id: dropped
  ],
  busServices: [svc("B1", { std: "23:10", etd: "On time", platform: "BUS", operator: "Southern" })],
};

async function main() {
  const r = await import("../src/services/trainBoardRules");

  // ── UK clock times ──
  const NOW = new Date("2026-10-24T21:50:00Z"); // 22:50 BST
  check("clock: same day (BST)", r.clockToIso("22:48", NOW) === "2026-10-24T21:48:00.000Z", String(r.clockToIso("22:48", NOW)));
  check("clock: after midnight → tomorrow", r.clockToIso("00:21", NOW) === "2026-10-24T23:21:00.000Z", String(r.clockToIso("00:21", NOW)));
  const justAfterMidnight = new Date("2026-10-24T23:05:00Z"); // 00:05 BST on the 25th
  check("clock: 23:58 just after midnight → yesterday", r.clockToIso("23:58", justAfterMidnight) === "2026-10-24T22:58:00.000Z");
  // Clocks go back 25 Oct 2026 at 02:00 BST → 01:00 GMT
  check("clock: GMT after the change", r.clockToIso("09:00", new Date("2026-10-25T09:30:00Z")) === "2026-10-25T09:00:00.000Z");
  check("clock: junk → null", r.clockToIso("soon", NOW) === null && r.clockToIso("25:00", NOW) === null && r.clockToIso(null, NOW) === null);

  // ── Darwin board → our shapes ──
  const parsed = r.parseDarwinBoard(BOARD, NOW);
  const byId = (id: string) => parsed.services.find((s) => s.id === id)!;
  check("messages: HTML stripped", parsed.messages[0] === "Disruption between Three Bridges and Brighton. More details", parsed.messages[0]);
  check("services: id-less dropped, bus kept", parsed.services.length === 5, String(parsed.services.length));
  const a1 = byId("A1");
  check("late arrival: 8 min", a1.arr?.status === "LATE" && a1.arr?.delayMin === 8, JSON.stringify(a1.arr));
  check("late departure: 8 min", a1.dep?.status === "LATE" && a1.dep?.delayMin === 8);
  check("platform, coaches, operator", a1.platform === "3" && a1.coaches === 8 && a1.operatorCode === "SN");
  check("delay reason kept", a1.delayReason === "This train has been delayed by a train in front");
  check("previous calling points", a1.previous.length === 3 && a1.previous[0].name === "London Victoria");
  check("calling point passed with actual", a1.previous[1].passed && a1.previous[1].delayMin === 8, JSON.stringify(a1.previous[1]));
  check("calling point not yet passed", !a1.previous[2].passed && a1.previous[2].status === "LATE");
  check("subsequent calling points", a1.subsequent[0]?.name === "Brighton" && a1.subsequent[0]?.delayMin === 8);
  const a2 = byId("A2");
  check("cancelled", a2.cancelled && a2.arr?.status === "CANCELLED" && a2.cancelReason === "A fault with the signalling system");
  const a3 = byId("A3");
  check("starts here: no arrival", a3.arr === null && a3.dep?.status === "ON_TIME" && a3.dep.delayMin === 0);
  check("via kept", a3.destinationVia === "via London Bridge");
  check("calling point after midnight", a3.subsequent[0].sched === "2026-10-24T23:40:00.000Z", String(a3.subsequent[0].sched));
  const a4 = byId("A4");
  check("'Delayed' without a time", a4.arr?.status === "DELAYED" && a4.arr.expected === null && a4.dep === null);
  check("bus service", byId("B1").kind === "BUS");
  check("unknown coaches → null", a2.coaches === null);
  check("single object (not array) tolerated", r.parseDarwinBoard({ trainServices: svc("Z", { std: "23:00", etd: "On time" }) }, NOW).services.length === 1);
  check("empty body", r.parseDarwinBoard({}, NOW).services.length === 0);

  // ── Merging and paging ──
  const merged = r.mergeServices([parsed.services, [{ ...a1, platform: "4" }]]);
  check("merge: no duplicates, latest wins", merged.filter((s) => s.id === "A1").length === 1 && merged.find((s) => s.id === "A1")!.platform === "4");
  check("merge: time order", merged.every((s, i) => i === 0 || r.serviceTime(merged[i - 1]) <= r.serviceTime(s)));
  check("messages merged unique", r.mergeMessages([["a", "b"], ["b", "c"]]).join() === "a,b,c");
  const ten = Array.from({ length: 10 }, (_, i) => ({ ...a3, id: `T${i}`, dep: { ...a3.dep!, sched: new Date(NOW.getTime() + i * 3 * 60_000).toISOString() } }));
  check("paging: page not full → end of window", r.nextOffset(ten.slice(0, 4), -30, 120, 10, NOW, 120) === 90);
  check("paging: full page → from its last train", r.nextOffset(ten, -30, 120, 10, NOW, 120) === 27, String(r.nextOffset(ten, -30, 120, 10, NOW, 120)));
  check("paging: full page stuck → moves on 5", r.nextOffset(ten.map((t) => ({ ...t, dep: { ...t.dep!, sched: NOW.toISOString() } })), 0, 120, 10, NOW, 120) === 5);
  check("paging: done at the end", r.nextOffset([], 90, 30, 10, NOW, 120) === null);

  // ── Quiet hours ──
  check("quiet 02:00 UK", r.quietHours(new Date("2026-10-24T01:00:00Z")));
  check("not quiet 05:00 UK", !r.quietHours(new Date("2026-10-24T04:00:00Z")));
  check("station lookup", r.stationBySlug("Three-Bridges")?.crs === "TBD" && r.stationBySlug("nowhere") === null);

  // ── Refresh (fake National Rail) ──
  const calls: any[] = [];
  let status = 200;
  let body: any = BOARD;
  (axios as any).get = async (url: string, opts: any) => {
    calls.push({ url, ...opts });
    if (url.includes("openweathermap")) return { status: 401, data: {} };
    return { status, data: typeof body === "function" ? body(opts.params) : body };
  };
  const svcMod = await import("../src/services/trainBoard.service");
  const redis = new FakeRedis();
  const logs: string[] = [];
  const deps = { redis: redis as any, log: { warn: (m: string) => logs.push(m) } };

  delete process.env.RAIL_DATA_API_KEY;
  check("no key: nothing fetched", (await svcMod.refreshTrainBoards(deps, NOW)) === 0 && calls.length === 0);

  process.env.RAIL_DATA_API_KEY = "secret";
  process.env.RAIL_DAILY_CAP = "1000";
  let n = await svcMod.refreshTrainBoards(deps, NOW);
  const railCalls = () => calls.filter((c) => !c.url.includes("openweathermap"));
  check("refreshed one station", n === 1, String(n));
  check("2 pages (−30..90, 90..120)", railCalls().length === 2, JSON.stringify(railCalls().map((c) => c.params)));
  check("first page: −30, 120 min", railCalls()[0].params.timeOffset === -30 && railCalls()[0].params.timeWindow === 120);
  check("second page: 90, 30 min", railCalls()[1].params.timeOffset === 90 && railCalls()[1].params.timeWindow === 30);
  check("URL ends with station code", railCalls()[0].url.endsWith("/GetArrDepBoardWithDetails/TBD"));
  check("key in x-apikey header", railCalls()[0].headers["x-apikey"] === "secret");
  const stored = await svcMod.getTrainBoard(redis as any, "TBD");
  check("board stored", stored?.services.length === 5 && stored.messages.length === 1);
  check("each train remembered", !!(await svcMod.getSeenService(redis as any, "TBD", "A1")));

  calls.length = 0;
  n = await svcMod.refreshTrainBoards(deps, new Date(NOW.getTime() + 20_000));
  check("not due after 20 s", n === 0 && railCalls().length === 0);
  n = await svcMod.refreshTrainBoards(deps, new Date(NOW.getTime() + 60_000));
  check("due after a minute", n === 1);

  // Darwin capping rows at 10: keeps paging from the last train
  calls.length = 0;
  body = (p: any) => ({
    trainServices: Array.from({ length: 10 }, (_, i) => {
      const t = new Date(NOW.getTime() + (p.timeOffset + i * 2 + 2) * 60_000);
      const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t);
      return svc(`P${p.timeOffset}-${i}`, { std: hm, etd: "On time" });
    }),
  });
  await redis.del("trainboard:TBD:data");
  n = await svcMod.refreshTrainBoards(deps, new Date(NOW.getTime() + 120_000));
  check("capped rows: more pages", railCalls().length > 3 && railCalls().length <= 16, String(railCalls().length));
  const offsets = railCalls().map((c) => c.params.timeOffset);
  check("capped rows: offsets go forward", offsets.every((o: number, i: number) => i === 0 || o > offsets[i - 1]), offsets.join(","));
  body = BOARD;

  // Refused key → back off
  calls.length = 0;
  status = 401;
  await redis.del("trainboard:TBD:data");
  n = await svcMod.refreshTrainBoards(deps, new Date(NOW.getTime() + 180_000));
  check("refused key: nothing stored, warned", n === 0 && logs.some((l) => l.includes("refused the key")));
  calls.length = 0;
  status = 200;
  n = await svcMod.refreshTrainBoards(deps, new Date(NOW.getTime() + 240_000));
  check("refused key: backs off", n === 0 && railCalls().length === 0);
  await redis.del("trainboard:backoff");

  // Daily cap
  process.env.RAIL_DAILY_CAP = "0";
  calls.length = 0;
  n = await svcMod.refreshTrainBoards(deps, new Date(NOW.getTime() + 300_000));
  check("daily cap: stops", n === 0 && railCalls().length === 0);
  process.env.RAIL_DAILY_CAP = "1000";

  // Server error keeps the old board
  n = await svcMod.refreshTrainBoards(deps, new Date(NOW.getTime() + 360_000));
  const before = (await svcMod.getTrainBoard(redis as any, "TBD"))!.fetchedAt;
  status = 500;
  n = await svcMod.refreshTrainBoards(deps, new Date(NOW.getTime() + 480_000));
  check("server error: old board kept", n === 0 && (await svcMod.getTrainBoard(redis as any, "TBD"))!.fetchedAt === before);
  status = 200;

  // Quiet hours: every 15 min
  const night = new Date("2026-10-26T02:00:00Z"); // 02:00 GMT
  await svcMod.refreshTrainBoards(deps, night);
  calls.length = 0;
  check("quiet hours: not after 5 min", (await svcMod.refreshTrainBoards(deps, new Date(night.getTime() + 5 * 60_000))) === 0);
  check("quiet hours: after 15 min", (await svcMod.refreshTrainBoards(deps, new Date(night.getTime() + 15 * 60_000))) === 1);

  // ── Website routes ──
  await svcMod.refreshTrainBoards(deps, new Date(Date.now() + 3600_000)); // fresh board stamped "now-ish"
  await redis.set("trainboard:TBD:data", JSON.stringify({ ...JSON.parse((await redis.get("trainboard:TBD:data"))!), fetchedAt: new Date().toISOString() }));
  await redis.set("weather:RAIL-TBD", JSON.stringify({ w: { tempC: 8, kind: "clear", night: true, text: "Clear sky", windMph: 22, at: "x" }, fetchedAt: "x" }));
  const { publicTrainTimesRoutes } = await import("../src/routes/publicTrainTimes");
  const app = Fastify();
  app.decorate("redis", redis as any);
  await app.register(publicTrainTimesRoutes);
  process.env.FLIGHT_STATUS_SITE_KEY = "site";
  let res = await app.inject({ url: "/public/train-times/three-bridges/board" });
  check("route: no site key → 403", res.statusCode === 403);
  const H = { "x-site-key": "site" };
  res = await app.inject({ url: "/public/train-times/three-bridges/board", headers: H });
  const b = res.json().data;
  check("route: board", res.statusCode === 200 && b.services.length === 5 && b.station.name === "Three Bridges" && b.stale === false, JSON.stringify(b).slice(0, 120));
  check("route: weather", b.weather?.tempC === 8);
  res = await app.inject({ url: "/public/train-times/gatwick-airport/board", headers: H });
  check("route: unknown station 404", res.statusCode === 404);
  res = await app.inject({ url: "/public/train-times/three-bridges/train/A1", headers: H });
  check("route: one train live", res.json().data.status === "FOUND" && res.json().data.live === true);
  await redis.set("trainboard:TBD:data", JSON.stringify({ ...JSON.parse((await redis.get("trainboard:TBD:data"))!), services: [] }));
  res = await app.inject({ url: "/public/train-times/three-bridges/train/A1", headers: H });
  check("route: gone from board → last copy", res.json().data.status === "FOUND" && res.json().data.live === false);
  res = await app.inject({ url: "/public/train-times/three-bridges/train/NOPE", headers: H });
  check("route: unknown train", res.json().data.status === "NOT_FOUND");
  await redis.del("trainboard:TBD:data");
  res = await app.inject({ url: "/public/train-times/three-bridges/board", headers: H });
  check("route: no board yet → stale, empty", res.json().data.stale === true && res.json().data.services.length === 0);
  await app.close();

  console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
