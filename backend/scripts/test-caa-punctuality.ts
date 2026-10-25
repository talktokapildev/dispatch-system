// backend/scripts/test-caa-punctuality.ts
//
// CAA punctuality: CSV parsing, name matching, the 12-month summary, what flight and airline
// pages get, and the service (airports seen on the board, hourly rebuild) with an in-memory
// Redis and a fake database. No network, no real database.
//
//   node --env-file=.env -r ts-node/register scripts/test-caa-punctuality.ts
import {
  addMonths,
  airlineScores,
  airlineStats,
  gatwickDelays,
  buildSummary,
  CaaRow,
  matchAirline,
  matchAirport,
  norm,
  parseCaaCsv,
  routeStats,
  SeenAirport,
  splitCsv,
} from "../src/services/caaPunctualityRules";
import { getCaaSummary, rebuildCaaSummary, recordAirportsSeen } from "../src/services/caaPunctuality.service";
import type { BoardFlight } from "../src/services/flightBoardRules";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── CSV ─────────────────────────────────────────────────────────────────────
// The real 2026 header (26 columns, CAA order).
const HEADER =
  "run_date,reporting_period,reporting_airport,origin_destination_country,origin_destination,airline_name," +
  "arrival_departure,scheduled_charter,number_flights_matched,actual_flights_unmatched,number_flights_cancelled," +
  "flights_more_than_15_minutes_early_percent,flights_15_minutes_early_to_1_minute_early_percent," +
  "flights_0_to_15_minutes_late_percent,flights_between_16_and_30_minutes_late_percent," +
  "flights_between_31_and_60_minutes_late_percent,flights_between_61_and_120_minutes_late_percent," +
  "flights_between_121_and_180_minutes_late_percent,flights_between_181_and_360_minutes_late_percent," +
  "flights_more_than_360_minutes_late_percent,flights_unmatched_percent,flights_cancelled_percent," +
  "average_delay_mins,previous_year_month_flights_matched,previous_year_month_early_to_15_mins_late_percent," +
  "previous_year_month_average_delay";
// bands: >15 early, 15-1 early, 0-15, 16-30, 31-60, 61-120, 121-180, 181-360, >360, unmatched %, cancelled %
const line = (period: number, rep: string, country: string, airport: string, airline: string, ad: string, sc: string,
  m: number, u: number, c: number, bands: number[], avg: number) =>
  [`14/10/2026 11:08`, period, rep, country, airport, airline, ad, sc, m, u, c, ...bands, avg, 0, 0, ""].join(",");

const csv = [
  HEADER,
  line(202608, "ABERDEEN", "CZECH REPUBLIC", "PRAGUE", "GO2SKY", "A", "C", 1, 0, 0, [100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0),
  // 100 planned: 90 matched, 10 cancelled. On time 10+30+20 = 60 of 100 → 60/90 = 67%. Over 1h: 2+1 = 3 → 3.3%.
  line(202608, "GATWICK", "SPAIN", "MALAGA", "EASYJET UK LTD", "A", "S", 90, 0, 10, [10, 30, 20, 15, 12, 2, 1, 0, 0, 0, 10], 18),
  line(202608, "GATWICK", "SPAIN", "MALAGA", "EASYJET UK LTD", "D", "S", 100, 0, 0, [5, 40, 30, 15, 10, 0, 0, 0, 0, 0, 0], 9),
  // a quoted name with a comma survives
  `"14/10/2026 11:08",202608,GATWICK,"UNITED STATES","WASHINGTON (DULLES), DC","UNITED AIRLINES INC",A,S,30,0,0,0,50,30,10,10,0,0,0,0,0,0,12,0,0,`,
  // repeated key → dropped
  line(202608, "GATWICK", "SPAIN", "MALAGA", "EASYJET UK LTD", "A", "S", 1, 0, 0, [0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 0], 3),
  "",
].join("\r\n");

const p = parseCaaCsv("﻿" + csv);
check("CSV: one period", p.period === 202608);
check("CSV: Gatwick rows only, duplicate dropped", p.rows.length === 3 && p.duplicates === 1, `${p.rows.length} rows`);
check("CSV: counts all data rows", p.allRows === 5);
const mal = p.rows.find((r) => r.airport === "MALAGA" && r.direction === "A")!;
check("CSV: numbers parsed", mal.matched === 90 && mal.cancelled === 10 && mal.late15Pct === 20 && mal.avgDelayMin === 18);
check("CSV: quoted field with a comma", p.rows.some((r) => r.airport === "WASHINGTON (DULLES), DC"));
const gA = p.airports.find((t) => t.airport === "GATWICK" && t.direction === "A")!;
check("CSV: UK airport totals for every reporting airport", p.airports.some((t) => t.airport === "ABERDEEN") && p.airports.length === 3, `${p.airports.length}`);
// Gatwick arrivals: Malaga (90 matched, 10 cancelled, on time 60, over 1h 3) + Dulles (30 matched, on time 24); duplicate not counted.
check("CSV: Gatwick arrival totals", gA.matched === 120 && gA.total === 130 && gA.cancelled === 10 && Math.round(gA.onTime) === 84 && Math.round(gA.overHour) === 3 && gA.delaySum === 90 * 18 + 30 * 12,
  JSON.stringify(gA));
check("splitCsv: escaped quotes", eq(splitCsv('a,"b ""x"" c",d'), [["a", 'b "x" c', "d"]]));

let threw = "";
try {
  parseCaaCsv(HEADER.replace("arrival_departure,", "") + "\n1,2,3");
} catch (e) {
  threw = (e as Error).message;
}
check("CSV: wrong layout refused", /Arrival Departure/.test(threw), threw);
threw = "";
try {
  parseCaaCsv([HEADER, line(202607, "GATWICK", "SPAIN", "MALAGA", "X", "A", "S", 1, 0, 0, [0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 0], 0), line(202608, "GATWICK", "SPAIN", "MALAGA", "Y", "A", "S", 1, 0, 0, [0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 0], 0)].join("\n"));
} catch (e) {
  threw = (e as Error).message;
}
check("CSV: several months refused", /several months/.test(threw), threw);

// ── Months / names ──────────────────────────────────────────────────────────
check("addMonths back a year", addMonths(202608, -12) === 202508);
check("addMonths across new year", addMonths(202601, -1) === 202512 && addMonths(202512, 1) === 202601);
check("addMonths 11 back", addMonths(202608, -11) === 202509);
check("norm accents/punctuation", norm("Málaga-Costa del Sol") === "MALAGA COSTA DEL SOL" && norm("Côte d'Azur") === "COTE D AZUR");

const seen: SeenAirport[] = [
  { iata: "AGP", city: "Málaga", airportName: "Málaga Costa del Sol", municipality: "Málaga", country: "ES" },
  { iata: "CDG", city: "Paris", airportName: "Paris Charles de Gaulle", municipality: "Paris", country: "FR" },
  { iata: "ORY", city: "Paris Orly", airportName: "Paris Orly", municipality: "Paris", country: "FR" },
  { iata: "NCE", city: "Nice", airportName: "Nice Côte d'Azur", municipality: "Nice", country: "FR" },
  { iata: "VLC", city: "Valencia", airportName: "Valencia", municipality: "Valencia", country: "ES" },
  { iata: "VLN", city: "Valencia", airportName: "Arturo Michelena International", municipality: "Valencia", country: "VE" },
  { iata: "MLA", city: "Malta", airportName: "Malta International", municipality: "Luqa", country: "MT" },
  { iata: "IAD", city: "Washington", airportName: "Washington Dulles International", municipality: "Washington", country: "US" },
];
check("airport: town", eq(matchAirport("MALAGA", "SPAIN", seen), { iata: "AGP", how: "name" }));
check("airport: town (airport) picks the right one", eq(matchAirport("NICE (COTE D'AZUR)", "FRANCE", seen), { iata: "NCE", how: "name" }));
check("airport: override", eq(matchAirport("PARIS (CHARLES DE GAULLE)", "FRANCE", seen), { iata: "CDG", how: "override" }));
const paris = matchAirport("PARIS", "FRANCE", seen);
check("airport: two airports, same country → no match", paris.iata === null && "candidates" in paris && eq(paris.candidates, ["CDG", "ORY"]));
check("airport: country breaks a tie", eq(matchAirport("VALENCIA", "SPAIN", seen), { iata: "VLC", how: "name" }));
check("airport: our name for it (Malta)", matchAirport("MALTA", "MALTA", seen).iata === "MLA");
check("airport: bracket words must all be in the name", matchAirport("PARIS (BEAUVAIS)", "FRANCE", seen).iata === null);
check("airport: unknown", matchAirport("TIMBUKTU", "MALI", seen).iata === null);

const known = [
  { slug: "vueling", name: "Vueling" },
  { slug: "tap-air-portugal", name: "TAP Air Portugal" },
  { slug: "united-airlines", name: "United Airlines" },
  { slug: "aurigny", name: "Aurigny" },
  { slug: "emirates", name: "Emirates" },
  { slug: "turkish-airlines", name: "Turkish Airlines" },
  { slug: "westjet", name: "WestJet" },
  { slug: "air-china", name: "Air China" },
  { slug: "china-eastern", name: "China Eastern" },
];
check("airline: easyJet companies → one page", ["EASYJET UK LTD", "EASYJET EUROPE AIRLINE GMBH", "EASYJET SWITZERLAND SA"].every((n) => matchAirline(n, known) === "easyjet"));
check("airline: Ryanair group", matchAirline("MALTA AIR", known) === "ryanair" && matchAirline("RYANAIR UK LTD", known) === "ryanair");
check("airline: BA companies", matchAirline("BA EUROFLYER LTD", known) === "british-airways" && matchAirline("BRITISH AIRWAYS PLC", known) === "british-airways");
check("airline: TUI", matchAirline("TUI AIRWAYS LTD", known) === "tui");
check("airline: company words dropped", matchAirline("VUELING AIRLINES SA", known) === "vueling");
check("airline: alias (AIR PORTUGAL → TAP Air Portugal)", matchAirline("AIR PORTUGAL", known) === "tap-air-portugal");
check("airline: same words with company words", matchAirline("TAP AIR PORTUGAL SA", known) === "tap-air-portugal");
check("airline: extra word in the CAA name", matchAirline("THY TURKISH AIRLINES", known) === "turkish-airlines");
check("airline: spaces ignored", matchAirline("WEST JET AIRLINES", known) === "westjet");
check("airline: Air China vs China Eastern", matchAirline("AIR CHINA", known) === "air-china" && matchAirline("CHINA EASTERN AIRLINES", known) === "china-eastern");
check("airline: most words wins only when ours is fully inside", matchAirline("CHINA SOUTHERN AIRLINES", known) === null);
check("airline: longer CAA name", matchAirline("AURIGNY AIR SERVICES LTD", known) === "aurigny");
check("airline: unknown → null", matchAirline("ZZZ HOLIDAYS LTD", known) === null);

// ── Summary ─────────────────────────────────────────────────────────────────
const row = (period: number, airport: string, airline: string, dir: "A" | "D", matched: number, onTimePct: number, avg: number, extra: Partial<CaaRow> = {}): CaaRow => ({
  period, direction: dir, country: "SPAIN", airport, airline, charter: "S", matched, unmatched: 0, cancelled: 0,
  early15Pct: 0, early1Pct: 0, late15Pct: onTimePct, late30Pct: 100 - onTimePct, late60Pct: 0, late120Pct: 0, late180Pct: 0,
  late360Pct: 0, lateMorePct: 0, unmatchedPct: 0, cancelledPct: 0, avgDelayMin: avg, runDate: null, ...extra,
});
const now = new Date("2026-10-25T12:00:00Z");
const rows: CaaRow[] = [
  ...p.rows.map((r) => ({ ...r, period: 202608 })),
  // Oct 2025: in the window (Sep 2025–Aug 2026)
  row(202510, "MALAGA", "EASYJET EUROPE AIRLINE GMBH", "A", 40, 50, 30),
  // Aug 2025: OUTSIDE the window → ignored
  row(202508, "MALAGA", "EASYJET UK LTD", "A", 500, 0, 300),
  // too few flights for a 12-month figure
  row(202605, "VALENCIA", "EASYJET UK LTD", "A", 10, 100, 0),
  // unmatched airport + airline
  row(202605, "PARIS", "EASYJET UK LTD", "D", 70, 80, 10, { country: "FRANCE" }),
  row(202605, "MALAGA", "ZZZ HOLIDAYS LTD", "A", 25, 80, 10),
];
const s = buildSummary(rows, seen, known, now);
check("summary: window Sep 2025..Aug 2026", s.from === "2025-10" && s.to === "2026-08" && s.months === 3, `${s.from}..${s.to} ${s.months}`);
const ma = s.routes["A|AGP|easyjet"];
// Aug: 90 matched, on time 60 (of 100 planned), cancelled 10, avg 18. Oct 2025: 40 matched, 20 on time, avg 30.
// → 130 timed, on time 80/130 = 61.5 → 62%; avg (18*90 + 30*40)/130 = 21.7 → 22; cancelled 10/140 = 7.1%; >1h 3/130 = 2.3%
check("summary: route figures (two companies, two months, Aug 2025 ignored)",
  !!ma?.year && ma.year.flights === 130 && ma.year.onTimePct === 62 && ma.year.avgDelayMin === 22 && ma.year.cancelledPct === 7.1 && ma.year.overHourPct === 2.3,
  JSON.stringify(ma?.year));
check("summary: route name from the board", ma?.name === "Málaga");
check("summary: month entries", !!ma?.months["10"] && ma.months["10"].period === "2025-10" && ma.months["10"].onTimePct === 50 && !!ma.months["08"]);
check("summary: departures separate", s.routes["D|AGP|easyjet"]?.year?.onTimePct === 75 && s.routes["D|AGP|easyjet"]?.year?.avgDelayMin === 9);
check("summary: too few flights → no 12-month figure", s.routes["A|VLC|easyjet"]?.year === null);
check("summary: unmatched airport listed with candidates", s.unmatchedAirports.some((u) => u.name === "PARIS" && u.flights === 70 && eq(u.candidates, ["CDG", "ORY"])));
check("summary: unmatched airline listed", s.unmatchedAirlines.some((u) => u.name === "ZZZ HOLIDAYS LTD" && u.flights === 25));
const ej = s.airlines["easyjet"];
check("summary: airline totals include unmatched airports", !!ej?.departures && ej.departures.flights === 170, JSON.stringify(ej?.departures));
check("summary: airline best routes need 60+ flights", ej.best.length === 1 && ej.best[0].iata === "AGP" && ej.worst.length === 0, JSON.stringify(ej.best));
check("summary: empty rows", buildSummary([], seen, known, now).from === null);
const gs = s.gatwick!;
// Gatwick arrivals in the window: Aug 90+30 (MALAGA + DULLES), Oct 2025 40, May VLC 10, ZZZ 25 = 195 timed
check("summary: Gatwick totals include unmatched routes and airlines", gs.arrivals?.flights === 195 && gs.departures?.flights === 170,
  `${gs.arrivals?.flights}/${gs.departures?.flights}`);
check("summary: Gatwick months in order", gs.months.map((m) => m.period).join() === "2025-10,2026-05,2026-08");
const am = (airport: string, period: number, direction: "A" | "D", matched: number, onTimeShare: number, avg: number) => ({
  period, airport, direction, total: matched, matched, cancelled: 0, onTime: matched * onTimeShare, overHour: 0, delaySum: matched * avg,
});
const apRows = [
  am("HEATHROW", 202608, "A", 20000, 0.75, 14), am("GATWICK", 202608, "A", 12000, 0.7, 17), am("STANSTED", 202608, "A", 9000, 0.73, 15),
  am("MANCHESTER", 202608, "A", 9500, 0.69, 19), am("LUTON", 202608, "A", 5000, 0.66, 21), am("EDINBURGH", 202608, "A", 6000, 0.77, 13),
  am("BIRMINGHAM", 202608, "A", 4000, 0.7, 16), am("BRISTOL", 202608, "A", 3500, 0.74, 14), am("GLASGOW", 202608, "A", 3000, 0.76, 12),
  am("BELFAST CITY (GEORGE BEST)", 202608, "A", 1000, 0.9, 5),
  am("HEATHROW", 202508, "A", 99999, 0, 99), // outside the window
];
const s2 = buildSummary(rows, seen, known, now, apRows);
const uk = s2.ukAirports!;
check("summary: 8 busiest UK airports, best on time first", uk.length === 8 && uk[0].name === "Edinburgh" && uk.map((a) => a.arrivals!.onTimePct).every((v, i, a) => i === 0 || a[i - 1] >= v),
  uk.map((a) => `${a.name} ${a.arrivals?.onTimePct}`).join(", "));
check("summary: Gatwick flagged, outside-window month ignored", uk.some((a) => a.gatwick && a.name === "Gatwick") && uk.find((a) => a.name === "Heathrow")?.arrivals?.flights === 20000);
const small = buildSummary(rows, seen, known, now, apRows.filter((a) => a.airport !== "GATWICK").concat([am("GATWICK", 202608, "A", 100, 0.7, 17)]));
check("summary: Gatwick kept even when not among the busiest", small.ukAirports!.some((a) => a.gatwick) && small.ukAirports!.length === 8);
check("summary: title-cased names", s2.ukAirports!.every((a) => !/[A-Z]{3,}/.test(a.name)));

// best / worst with enough routes
const many: CaaRow[] = ["MALAGA", "VALENCIA", "NICE (COTE D'AZUR)", "MALTA", "PARIS (CHARLES DE GAULLE)", "PARIS (ORLY)"].map((a, i) =>
  row(202606, a, "VUELING AIRLINES SA", "A", 100, 50 + i * 8, 20 - i)
);
const vs = buildSummary(many, seen, known, now).airlines["vueling"];
check("summary: best 3 + worst 3", vs.best.map((r) => r.iata).join() === "ORY,CDG,MLA" && vs.worst.map((r) => r.iata).join() === "AGP,VLC,NCE",
  `${vs.best.map((r) => r.iata)} / ${vs.worst.map((r) => r.iata)}`);

// ── Pages ───────────────────────────────────────────────────────────────────
const rs = routeStats(s, "ARRIVAL", "agp", "easyjet", "2026-10-30T09:00:00Z");
check("flight page: arrival route + same month last year", !!rs && rs.year.onTimePct === 62 && rs.sameMonth?.period === "2025-10" && rs.from === "2025-10");
check("flight page: UK month (00:30 UK on 1 Nov is Nov)", routeStats(s, "ARRIVAL", "AGP", "easyjet", "2026-11-01T00:30:00Z")?.sameMonth === null);
check("flight page: no month data → year only", routeStats(s, "ARRIVAL", "AGP", "easyjet", "2026-12-10T09:00:00Z")?.sameMonth === null);
check("flight page: wrong direction / airline / thin route → null",
  routeStats(s, "DEPARTURE", "VLC", "easyjet", null) === null &&
  routeStats(s, "ARRIVAL", "AGP", "vueling", null) === null &&
  routeStats(s, "ARRIVAL", "VLC", "easyjet", null) === null &&
  routeStats(s, "ARRIVAL", null, "easyjet", null) === null &&
  routeStats(null, "ARRIVAL", "AGP", "easyjet", null) === null);
check("hub: airline scores", airlineScores(s)?.airlines["easyjet"]?.departures?.flights === 170 && airlineScores(s)?.minFlights === 300 && airlineScores(null) === null);
check("delays page: figures + airports", gatwickDelays(s2)?.airports.length === 8 && gatwickDelays(s2)?.gatwick.arrivals?.flights === 195 && gatwickDelays(buildSummary([], seen, known, now)) === null);
check("airline page: figures", airlineStats(s, "easyjet")?.departures?.flights === 170 && airlineStats(s, "nobody") === null);

// ── Service ─────────────────────────────────────────────────────────────────
class FakeRedis {
  kv = new Map<string, string>();
  h = new Map<string, Map<string, string>>();
  async get(k: string) { return this.kv.get(k) ?? null; }
  async set(k: string, v: string) { this.kv.set(k, v); return "OK"; }
  async hset(k: string, fields: Record<string, string>) { const m = this.h.get(k) ?? new Map(); for (const [f, v] of Object.entries(fields)) m.set(f, v); this.h.set(k, m); return 1; }
  async hgetall(k: string) { return Object.fromEntries(this.h.get(k) ?? []); }
  async hdel(k: string, ...f: string[]) { f.forEach((x) => this.h.get(k)?.delete(x)); return f.length; }
  async expire() { return 1; }
}
const redis = new FakeRedis();
const flight = (iata: string, name: string, airportName: string, municipality: string, cc: string) =>
  ({ other: { iata, name, airportName, municipality, countryCode: cc } } as unknown as BoardFlight);

(async () => {
  const n = await recordAirportsSeen(redis as any, [
    flight("AGP", "Málaga", "Málaga Costa del Sol", "Málaga", "ES"),
    flight("AGP", "Málaga", "Málaga Costa del Sol", "Málaga", "ES"),
    flight("MLA", "Malta", "Malta International", "Luqa", "MT"),
    { other: { iata: null } } as unknown as BoardFlight,
  ], now);
  check("service: airports recorded once each", n === 2 && redis.h.get("airports:seen")?.size === 2);
  // an airport not seen for 31 days is ignored and removed
  await redis.hset("airports:seen", { OLD: JSON.stringify({ city: "Old", airportName: null, municipality: null, country: null, seenAt: "2026-09-01T00:00:00Z" }) });
  redis.kv.set("airlineterm:summary", JSON.stringify({ updatedAt: now.toISOString(), airlines: [{ slug: "vueling", name: "Vueling" }] }));

  const store = rows.filter((r) => r.period >= 202509);
  const fakePrisma = {
    caaPunctuality: {
      aggregate: async () => ({ _max: { period: 202608 } }),
      findMany: async (q: any) => store.filter((r) => r.period >= q.where.period.gte && r.period <= q.where.period.lte),
    },
    caaAirportMonth: { findMany: async () => apRows },
  };
  const logs: string[] = [];
  const deps = { redis: redis as any, prisma: fakePrisma as any, log: { warn: (m: string) => logs.push(m) } };
  const built = await rebuildCaaSummary(deps, now);
  check("service: rebuild matches via airports seen", !!built.routes["A|AGP|easyjet"]?.year && built.routes["A|AGP|easyjet"].name === "Málaga");
  check("service: stale airport dropped", !redis.h.get("airports:seen")?.has("OLD"));
  check("service: summary stored for the pages", !!(await getCaaSummary(redis as any))?.routes["A|AGP|easyjet"]);
  check("service: UK airports in the stored summary", built.ukAirports?.length === 8);
  check("service: logs summary + unmatched", logs.some((l) => l.startsWith("[CAA] summary")) && logs.some((l) => l.includes('airport "PARIS"')), logs.join(" / "));
  const before = logs.length;
  await rebuildCaaSummary(deps, now);
  check("service: same result → no repeat log", logs.length === before);
  const noTable = { caaPunctuality: fakePrisma.caaPunctuality, caaAirportMonth: { findMany: () => Promise.reject(new Error("table missing")) } };
  const before0 = logs.length;
  const built2 = await rebuildCaaSummary({ ...deps, prisma: noTable as any }, now);
  check("service: missing UK table → no comparison, rest still built", built2.ukAirports?.length === 0 && !!built2.routes["A|AGP|easyjet"] && logs.slice(before0).some((l) => l.includes("UK airport totals unavailable")));

  console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
  process.exit(failures ? 1 : 0);
})();
