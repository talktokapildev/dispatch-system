// backend/scripts/test-flight-extras.ts
//
// Flight page extras: weather forecasts (parse, pick the right slot, when it's worth showing),
// the return-flight memory ("Coming back through Gatwick?") and drive times ("When to leave
// home"). In-memory Redis and fake Google Maps — no network.
//
//   node --env-file=.env -r ts-node/register scripts/test-flight-extras.ts
import { parseBoard } from "../src/services/flightBoardRules";
import { parseForecast, pickForecast, readForecasts, wantsForecast } from "../src/services/forecast.service";
import { mergeReturns, rankReturns, readReturns, recordReturns, returnsByOrigin, ReturnFlight } from "../src/services/returnFlights.service";
import { driveTime, TOWNS } from "../src/services/driveTime.service";
import { forecastPlacesOf } from "../src/services/flightBoard.service";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

class FakeRedis {
  store = new Map<string, string>();
  async set(k: string, v: string) {
    this.store.set(k, v);
    return "OK";
  }
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
  async mget(...ks: string[]) {
    return ks.map((k) => this.store.get(k) ?? null);
  }
  async incr(k: string) {
    const n = Number(this.store.get(k) ?? 0) + 1;
    this.store.set(k, String(n));
    return n;
  }
  async expire() {
    return 1;
  }
  async del(k: string) {
    this.store.delete(k);
    return 1;
  }
}

// ── Forecasts ───────────────────────────────────────────────────────────────
const slot = (iso: string, temp: number, id = 500, icon = "10d") => ({
  dt: Date.parse(iso) / 1000,
  main: { temp },
  weather: [{ id, description: "light rain", icon }],
  wind: { speed: 5 },
});
const fc = parseForecast({
  list: [slot("2026-10-27T09:00:00Z", 12.4), slot("2026-10-27T06:00:00Z", 8.6), { dt: 1, main: {} }, slot("2026-10-27T12:00:00Z", 15, 800, "01d")],
});
check("forecast: unusable entries dropped", fc.length === 3, String(fc.length));
check("forecast: sorted by time", fc[0].at === "2026-10-27T06:00:00.000Z");
check("forecast: rounded temp + text", fc[0].tempC === 9 && fc[0].text === "Light rain" && fc[0].kind === "rain");
check("forecast: wind in mph", fc[0].windMph === 11);
check("pick: nearest slot (07:15 → 06:00)", pickForecast(fc, "2026-10-27T07:15:00Z")?.tempC === 9);
check("pick: nearest slot (07:45 → 09:00)", pickForecast(fc, "2026-10-27T07:45:00Z")?.tempC === 12);
check("pick: nothing within 90 min → null", pickForecast(fc, "2026-10-27T16:00:00Z") === null);
check("pick: no slots → null", pickForecast(undefined, "2026-10-27T07:00:00Z") === null);
check("pick: no time → null", pickForecast(fc, null) === null);
const NOW = new Date("2026-10-26T10:00:00Z");
check("wants: 1 h ahead → no (current weather)", !wantsForecast("2026-10-26T11:00:00Z", NOW));
check("wants: 3 h ahead → yes", wantsForecast("2026-10-26T13:00:00Z", NOW));
check("wants: 6 days ahead → no (past the forecast)", !wantsForecast("2026-11-01T13:00:00Z", NOW));
check("wants: no time → no", !wantsForecast(null, NOW));

// ── Board-derived pieces ────────────────────────────────────────────────────
const tm = (utc: string) => ({ utc: utc.replace("T", " ") + "Z", local: utc + "+00:00" });
const LGW = { iata: "LGW" };
const PSA = { iata: "PSA", municipalityName: "Pisa", countryCode: "IT", location: { lat: 43.68, lon: 10.39 } };
const AMS = { iata: "AMS", municipalityName: "Amsterdam", countryCode: "NL", location: { lat: 52.3, lon: 4.76 } };
const EZY = { name: "easyJet", iata: "U2", icao: "EZY" };
const BA = { name: "British Airways", iata: "BA", icao: "BAW" };
const arr = (number: string, airline: object, from: object, at: string, terminal: string | null, codeshare = "IsOperator") => ({
  number,
  status: "Expected",
  codeshareStatus: codeshare,
  isCargo: false,
  airline,
  departure: { airport: from, scheduledTime: tm(at.replace(/T(\d\d)/, (_m, h) => `T${String(Number(h) - 2).padStart(2, "0")}`)), quality: [] },
  arrival: { airport: LGW, scheduledTime: tm(at), terminal, quality: [] },
});
const dep = (number: string, airline: object, to: object, at: string, landsAt: string) => ({
  number,
  status: "Expected",
  codeshareStatus: "IsOperator",
  isCargo: false,
  airline,
  departure: { airport: LGW, scheduledTime: tm(at), terminal: "N", quality: [] },
  arrival: { airport: to, scheduledTime: tm(landsAt), quality: [] },
});
const board = parseBoard({
  arrivals: [
    arr("U2 8316", EZY, PSA, "2026-10-26T13:40", "N"),
    arr("BA 2607", BA, PSA, "2026-10-26T11:05", "S"),
    arr("KL 9999", EZY, PSA, "2026-10-26T13:40", "N", "IsCodeshared"),
    arr("U2 8888", EZY, AMS, "2026-10-26T18:00", "N"),
  ],
  departures: [
    dep("U2 8315", EZY, PSA, "2026-10-26T09:15", "2026-10-26T10:30"), // lands in 30 min: no forecast
    dep("U2 8001", EZY, AMS, "2026-10-26T15:00", "2026-10-26T16:10"), // lands in 6 h: forecast
  ],
});
const by = returnsByOrigin(board, NOW);
check("returns: grouped by origin", by.get("PSA")?.length === 2 && by.get("AMS")?.length === 1);
check("returns: codeshare left out", !by.get("PSA")!.some((r) => r.displayNumber.startsWith("KL")));
check("returns: ticket number + usual UK time", by.get("PSA")!.some((r) => r.displayNumber === "EZY8316" && r.usualTimeUk === "13:40"));
check("returns: airline page slug", by.get("PSA")!.find((r) => r.displayNumber === "EZY8316")?.airline.slug === "easyjet");
const ranked = rankReturns(by.get("PSA")!, "easyjet");
check("rank: same airline first", ranked[0].displayNumber === "EZY8316" && ranked[1].displayNumber === "BA2607");
check("rank: no airline → by time", rankReturns(by.get("PSA")!, null)[0].displayNumber === "BA2607");
const old: ReturnFlight = { displayNumber: "EZY8316", airline: { name: "easyJet", iata: "U2", slug: "easyjet" }, usualTimeUk: "13:35", terminal: "NORTH", lastDate: "2026-10-20", seenAt: "2026-10-20T10:00:00.000Z" };
const stale: ReturnFlight = { ...old, displayNumber: "EZY1234", seenAt: "2026-10-10T10:00:00.000Z" };
const merged = mergeReturns([old, stale], [{ ...old, usualTimeUk: "13:40", terminal: null, seenAt: NOW.toISOString() }], NOW);
check("merge: newest copy wins", merged.length === 1 && merged[0].usualTimeUk === "13:40");
check("merge: stated terminal kept", merged[0].terminal === "NORTH");
check("merge: older than 7 days dropped", !merged.some((r) => r.displayNumber === "EZY1234"));

const places = forecastPlacesOf(board, NOW);
check("forecast places: Gatwick first", places[0].iata === "LGW");
check("forecast places: destination hours away", places.some((p) => p.iata === "AMS"));
check("forecast places: destination too soon left out", !places.some((p) => p.iata === "PSA"));

// ── Async: Redis + fake Maps ────────────────────────────────────────────────
(async () => {
  const redis = new FakeRedis() as any;
  check("record returns: origins updated", (await recordReturns(redis, board, NOW)) === 2);
  const r = await readReturns(redis, "PSA", "easyjet", NOW);
  check("read returns: from Redis, ranked", r.length === 2 && r[0].displayNumber === "EZY8316");
  check("read returns: unknown airport → none", (await readReturns(redis, "XXX", null, NOW)).length === 0);
  check("read returns: no airport → none", (await readReturns(redis, null, null, NOW)).length === 0);
  await redis.set("forecast:LGW", JSON.stringify({ slots: fc, fetchedAt: NOW.toISOString() }));
  await redis.set("forecast:BAD", "nope");
  const fx = await readForecasts(redis, ["lgw", "BAD", null]);
  check("read forecasts: cached, bad ones skipped", fx.LGW?.length === 3 && !fx.BAD);

  let directions = 0;
  const maps = {
    getPlaceDetails: async (id: string) =>
      id === "FAR" ? { address: "Leeds", latitude: 53.8, longitude: -1.55 } : { address: "1 High St, Crawley", latitude: 51.11, longitude: -0.19 },
    getDirections: async () => {
      directions++;
      return { distanceKm: 12.3, durationMinutes: 21, polyline: "", steps: [] };
    },
  };
  const deps = { prisma: {} as any, redis, maps: maps as any, now: () => NOW, log: { warn: () => {} } };
  const t1 = await driveTime(deps, { terminal: "NORTH", town: "crawley" });
  check("drive: town → minutes + miles", t1.status === "OK" && t1.minutes === 21 && t1.miles === 7.6 && t1.from === "Crawley", JSON.stringify(t1));
  await driveTime(deps, { terminal: "NORTH", town: "crawley" });
  check("drive: second ask from cache", directions === 1);
  await driveTime(deps, { terminal: "SOUTH", town: "crawley" });
  check("drive: other terminal is its own route", directions === 2);
  const t2 = await driveTime(deps, { terminal: "SOUTH", placeId: "ChIJplace123" });
  check("drive: address by place ID", t2.status === "OK" && t2.from === "1 High St, Crawley");
  const t3 = await driveTime(deps, { terminal: "NORTH", placeId: "FAR" });
  check("drive: far away → out of area, no Directions call", t3.status === "OUT_OF_AREA" && directions === 3);
  let threw = false;
  try {
    await driveTime(deps, { terminal: "NORTH", town: "narnia" });
  } catch {
    threw = true;
  }
  check("drive: unknown town refused", threw);
  check("towns: all within the service area", Object.values(TOWNS).every((t) => Math.abs(t.lat - 51.15) < 0.4));
  redis.store.set(`webquote:cap:directions:${new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(NOW)}`, "999999");
  const t4 = await driveTime(deps, { terminal: "NORTH", town: "horsham" });
  check("drive: over the daily cap → BUSY", t4.status === "BUSY");
  const t5 = await driveTime(deps, { terminal: "NORTH", town: "crawley" });
  check("drive: cached answers still work over the cap", t5.status === "OK");

  console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
  process.exit(failures ? 1 : 0);
})();
