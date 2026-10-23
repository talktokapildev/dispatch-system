// backend/scripts/test-weather.ts
//
// Weather for the website flight status page: OpenWeather parsing, the per-tick throttle,
// 30-minute cache, daily cap and "stop on a refused key". In-memory Redis and a fake
// OpenWeather — no network.
//
//   node --env-file=.env -r ts-node/register scripts/test-weather.ts
import axios from "axios";

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
}

let calls: any[] = [];
let status = 200;
(axios as any).get = async (url: string, opts: any) => {
  calls.push(opts.params);
  return {
    status,
    data: {
      dt: 1792795200,
      weather: [{ id: 500, main: "Rain", description: "light rain", icon: "10n" }],
      main: { temp: 10.6 },
      wind: { speed: 8.05 },
    },
  };
};

async function main() {
  const w = await import("../src/services/weather.service");

  // ── Parsing ──
  check("kind: thunder", w.kindFor(211) === "thunder");
  check("kind: drizzle", w.kindFor(301) === "drizzle");
  check("kind: snow", w.kindFor(601) === "snow");
  check("kind: fog", w.kindFor(741) === "fog");
  check("kind: clear", w.kindFor(800) === "clear");
  check("kind: partly", w.kindFor(802) === "partly");
  check("kind: cloudy", w.kindFor(804) === "cloudy");
  const p = w.parseWeather({ weather: [{ id: 500, description: "light rain", icon: "10n" }], main: { temp: 10.6 }, wind: { speed: 8.05 }, dt: 0 });
  check("temp rounded", p?.tempC === 11, String(p?.tempC));
  check("text capitalised", p?.text === "Light rain");
  check("night from icon", p?.night === true);
  check("wind m/s → mph", p?.windMph === 18, String(p?.windMph));
  check("bad body → null", w.parseWeather({}) === null);

  // ── Refresh ──
  const redis = new FakeRedis();
  const logs: string[] = [];
  const log = { warn: (m: string) => logs.push(m) };
  const places = Array.from({ length: 60 }, (_, i) => ({ iata: `A${String(i).padStart(2, "0")}`, lat: 40 + i / 10, lon: i / 10 }));
  const NOW = new Date("2026-10-23T20:00:00Z");

  delete process.env.OPENWEATHER_API_KEY;
  check("no key: nothing fetched", (await w.refreshWeather(redis as any, log, places, NOW)) === 0 && calls.length === 0);

  process.env.OPENWEATHER_API_KEY = "k";
  process.env.WEATHER_DAILY_CAP = "70";
  let n = await w.refreshWeather(redis as any, log, places, NOW);
  check("max 40 per tick", n === 40 && calls.length === 40, String(n));
  check("Gatwick first", calls[0].lat === "51.1481" && calls[0].units === "metric");
  n = await w.refreshWeather(redis as any, log, places, new Date(NOW.getTime() + 60_000));
  check("next tick does the rest (cap 70 stops at 70)", calls.length === 61 && n === 21, `${calls.length} ${n}`);
  n = await w.refreshWeather(redis as any, log, places, new Date(NOW.getTime() + 2 * 60_000));
  check("all fresh: no calls", n === 0 && calls.length === 61);

  const later = new Date(NOW.getTime() + 31 * 60_000);
  n = await w.refreshWeather(redis as any, log, places, later);
  check("after 30 min: refreshes until the daily cap", calls.length === 70 && logs.some((l) => l.includes("daily cap")), `${calls.length}`);

  const read = await w.readWeather(redis as any, ["LGW", "a00", "ZZZ", null]);
  check("read: cached airports only", !!read.LGW && !!read.A00 && !read.ZZZ);
  check("read: weather values", read.LGW.tempC === 11 && read.LGW.kind === "rain");

  // A refused key stops the tick at once.
  const r2 = new FakeRedis();
  calls = [];
  status = 401;
  process.env.WEATHER_DAILY_CAP = "20000";
  await w.refreshWeather(r2 as any, log, places, NOW);
  check("401 stops the tick after 1 call", calls.length === 1 && logs.some((l) => l.includes("401")));
  status = 200;

  // "Check flight": only the flight's own airports.
  calls = [];
  await w.ensureWeather(r2 as any, log, [w.LGW_PLACE, { iata: "FCO", lat: 41.8, lon: 12.25 }], NOW);
  check("lookup tops up its airports", calls.length === 2);
  await w.ensureWeather(r2 as any, log, [w.LGW_PLACE, { iata: "FCO", lat: 41.8, lon: 12.25 }], NOW);
  check("…and not again while fresh", calls.length === 2);

  console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
