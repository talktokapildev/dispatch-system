// backend/scripts/test-passenger-rights.ts
//
// UK delay/cancellation rights (passengerRightsRules.ts) and FCDO travel advice
// (travelAdviceRules.ts + travelAdvice.service.ts with an in-memory Redis and a fake GOV.UK).
// No network.
//
//   node --env-file=.env -r ts-node/register scripts/test-passenger-rights.ts
import type { BoardFlight, FlightView } from "../src/services/flightBoardRules";
import { bandFor, compensationFor, greatCircleKm, LGW_LAT, LGW_LON, passengerRights } from "../src/services/passengerRightsRules";
import { countryForCode, levelOf, normName, parseCountry, parseIndex } from "../src/services/travelAdviceRules";
import { readTravelAdvice, topUpTravelAdvice } from "../src/services/travelAdvice.service";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

// ── Distance ────────────────────────────────────────────────────────────────
const km = (lat: number, lon: number) => Math.round(greatCircleKm(LGW_LAT, LGW_LON, lat, lon));
const cdg = km(49.0097, 2.5479);
const agp = km(36.6749, -4.4991);
const jfk = km(40.6413, -73.7781);
check("distance: Paris CDG short", cdg > 280 && cdg < 350 && bandFor(cdg) === "SHORT", `${cdg} km`);
check("distance: Malaga medium", agp > 1550 && agp < 1750 && bandFor(agp) === "MEDIUM", `${agp} km`);
check("distance: New York long", jfk > 5400 && jfk < 5650 && bandFor(jfk) === "LONG", `${jfk} km`);
check("band edges", bandFor(1499) === "SHORT" && bandFor(1500) === "MEDIUM" && bandFor(3500) === "MEDIUM" && bandFor(3501) === "LONG");

// ── Amounts ─────────────────────────────────────────────────────────────────
check("under 3 hours → none", compensationFor("SHORT", 179) === null);
check("short 3h → £220", compensationFor("SHORT", 180) === 220);
check("medium → £350", compensationFor("MEDIUM", 400) === 350);
check("long 3–4h → £260, 4h+ → £520", compensationFor("LONG", 239) === 260 && compensationFor("LONG", 240) === 520);

// ── A flight page ───────────────────────────────────────────────────────────
const flight = (o: Partial<BoardFlight> & { otherPatch?: Partial<BoardFlight["other"]> }): BoardFlight =>
  ({
    id: "x",
    direction: "ARRIVAL",
    number: "U2 8182",
    displayNumber: "EZY8182",
    keys: [],
    airline: { name: "easyJet", iata: "U2", icao: "EZY" },
    codeshare: "OPERATOR",
    operatedBy: null,
    status: "EnRoute",
    aircraft: null,
    other: {
      iata: "AGP", name: "Malaga", scheduledUtc: "2026-10-30T09:00:00.000Z", revisedUtc: null, runwayUtc: null,
      scheduledLocal: null, revisedLocal: null, runwayLocal: null, countryCode: "ES", lat: 36.6749, lon: -4.4991,
      timeZone: "Europe/Madrid", ...(o.otherPatch ?? {}),
    },
    lgw: { scheduledUtc: "2026-10-30T12:00:00.000Z", revisedUtc: null, predictedUtc: null, runwayUtc: null, terminal: "NORTH",
      terminalInferred: false, gate: null, baggageBelt: null, checkInDesk: null, live: true },
    ...o,
  }) as BoardFlight;
const view = (o: Partial<FlightView>): FlightView => ({ state: "DELAYED", delayMin: 0, landed: false, ...o }) as FlightView;

const a1 = passengerRights(flight({}), view({ delayMin: 200 }));
check("arrival 3h20 late from Malaga → £350, UK/EU airline wording, no care",
  !!a1 && a1.compensationGbp === 350 && a1.covered === "UK_EU_AIRLINE" && a1.careFromMin === null && !a1.careDue && !a1.arrivalDelayFinal,
  JSON.stringify(a1));
check("arrival landed 3h late → final", passengerRights(flight({}), view({ delayMin: 185, landed: true, state: "LANDED" }))?.arrivalDelayFinal === true);
check("arrival 1h30 late → nothing to show", passengerRights(flight({}), view({ delayMin: 90 })) === null);
const a2 = passengerRights(flight({}), view({ delayMin: 150 }));
check("arrival 2h30 late → box shows, no compensation yet, £350 if 3h+", !!a2 && a2.compensationGbp === null && a2.arrivalDelayMin === 150 && a2.compensationIfLateGbp === 350);

const dep = (delay: number, patch: Partial<BoardFlight["other"]> = {}) =>
  passengerRights(
    flight({ direction: "DEPARTURE", otherPatch: { iata: "JFK", lat: 40.6413, lon: -73.7781, countryCode: "US", scheduledUtc: "2026-10-30T20:00:00.000Z", ...patch } }),
    view({ delayMin: delay })
  );
const d1 = dep(210);
check("departure to New York 3h30 late → £260, care from 4h not yet due", !!d1 && d1.compensationGbp === 260 && d1.careFromMin === 240 && !d1.careDue && d1.covered === "YES" && !d1.refundOption, JSON.stringify(d1));
const d2 = dep(250);
check("departure 4h10 late → £520, care due", !!d2 && d2.compensationGbp === 520 && d2.careDue);
check("departure 5h late → refund option", dep(300)?.refundOption === true);
const d3 = dep(250, { revisedUtc: "2026-10-30T22:30:00.000Z" });
check("destination's own revised time wins (made up time: 2h30 → no compensation)", d3?.arrivalDelayMin === 150 && d3?.compensationGbp === null);
const d4 = dep(250, { runwayUtc: "2026-10-31T00:10:00.000Z" });
check("landed at destination → final, gate = touchdown + 7", d4?.arrivalDelayFinal === true && d4?.arrivalDelayMin === 257);
const c1 = passengerRights(flight({ direction: "DEPARTURE" }), view({ state: "CANCELLED", delayMin: null }));
check("cancelled → cancelled box, no amount", !!c1 && c1.cancelled && c1.compensationGbp === null && c1.arrivalDelayMin === null);
check("codeshare → nothing", passengerRights(flight({ codeshare: "CODESHARE" }), view({ delayMin: 300 })) === null);
const n1 = passengerRights(flight({ otherPatch: { lat: null, lon: null } }), view({ delayMin: 200 }));
check("no airport position → box without amounts", !!n1 && n1.band === null && n1.compensationGbp === null);
const s1 = passengerRights(flight({ direction: "DEPARTURE", otherPatch: { iata: "CDG", lat: 49.0097, lon: 2.5479 } }), view({ delayMin: 125 }));
check("short-haul departure 2h05 late → care due from 2h", !!s1 && s1.careFromMin === 120 && s1.careDue && s1.compensationGbp === null);

// ── FCDO travel advice ──────────────────────────────────────────────────────
const child = (slug: string, name: string, synonyms: string[] = [], extra: any = {}) => ({
  title: `${name} travel advice`, web_url: `https://www.gov.uk/foreign-travel-advice/${slug}`, public_updated_at: "2026-08-12T15:46:24Z",
  withdrawn: false, details: { change_description: `Latest update for ${name}`, country: { name, slug, synonyms } }, ...extra,
});
const names: [string, string, string[]?][] = [
  ["spain", "Spain", ["Tenerife", "Canary Islands"]], ["usa", "USA"], ["turkey", "Turkey"], ["st-lucia", "St Lucia"],
  ["bosnia-and-herzegovina", "Bosnia and Herzegovina"], ["czechia", "Czechia"], ["france", "France"], ["portugal", "Portugal"],
];
const fillers = Array.from({ length: 50 }, (_, i) => child(`filler-${i}`, `Filler ${i}`));
const indexBody = { links: { children: [...names.map(([s, n, syn]) => child(s, n, syn)), child("old-place", "Old Place", [], { withdrawn: true }), { details: {} }, ...fillers] } };
const index = parseIndex(indexBody);
check("index: parsed, withdrawn and broken skipped", index.length === 58 && !index.some((c) => c.slug === "old-place"));
check("index: url and update line", index[0].url === "https://www.gov.uk/foreign-travel-advice/spain" && index[0].changeDescription === "Latest update for Spain");
check("country: ES → spain", countryForCode("ES", index)?.slug === "spain");
check("country: US → usa, TR → turkey", countryForCode("US", index)?.slug === "usa" && countryForCode("tr", index)?.slug === "turkey");
check("country: St Lucia (Intl 'St. Lucia')", countryForCode("LC", index)?.slug === "st-lucia");
check("country: Bosnia & Herzegovina", countryForCode("BA", index)?.slug === "bosnia-and-herzegovina");
check("country: UK / Jersey / unknown → none", countryForCode("GB", index) === null && countryForCode("JE", index) === null && countryForCode("ZZ", index) === null && countryForCode(null, index) === null);
check("normName", normName("Côte d'Ivoire") === "cotedivoire" && normName("Saint Kitts & Nevis") === "stkittsandnevis");
check("level: strongest wins", levelOf(["avoid_all_but_essential_travel_to_parts", "avoid_all_travel_to_parts"]) === "PARTS_ALL" && levelOf([]) === "NONE" && levelOf(undefined) === "NONE" && levelOf(["avoid_all_travel_to_whole_country"]) === "WHOLE_ALL");
const spain = index.find((c) => c.slug === "spain")!;
const adv = parseCountry(
  { public_updated_at: "2026-08-12T15:46:24Z", details: { alert_status: ["avoid_all_but_essential_travel_to_parts"], updated_at: "2026-08-12T15:46:24+01:00", change_description: "New fines", parts: [{ slug: "safety-and-security" }, { slug: "entry-requirements" }] } },
  spain
);
check("country item: level, entry link, update", adv.level === "PARTS_ESSENTIAL" && adv.entryUrl === "https://www.gov.uk/foreign-travel-advice/spain/entry-requirements" && adv.changeDescription === "New fines" && adv.updatedAt === "2026-08-12T14:46:24.000Z", JSON.stringify(adv));
check("country item: no parts → no entry link", parseCountry({ details: {} }, spain).entryUrl === null);

// ── Service ─────────────────────────────────────────────────────────────────
class FakeRedis {
  kv = new Map<string, string>();
  async get(k: string) { return this.kv.get(k) ?? null; }
  async set(k: string, v: string) { this.kv.set(k, v); return "OK"; }
}
(async () => {
  const redis = new FakeRedis();
  const calls: string[] = [];
  const failing = new Set<string>();
  const fetcher = async (path: string) => {
    calls.push(path);
    if (failing.has(path)) throw new Error("HTTP 503");
    if (path === "/api/content/foreign-travel-advice") return indexBody;
    return { details: { alert_status: path.endsWith("/usa") ? ["avoid_all_travel_to_parts"] : [], parts: [{ slug: "entry-requirements" }] } };
  };
  const logs: string[] = [];
  const log = { warn: (m: string) => logs.push(m) };
  const now = new Date("2026-10-25T12:00:00Z");
  const codes = ["ES", "ES", "GB", "US", "FR", "PT", "TR"];

  const n1 = await topUpTravelAdvice(redis as any, log, codes, now, fetcher);
  check("tick 1: index + 2 countries (3 calls max), duplicates and UK skipped", n1 === 3 && calls.join() === "/api/content/foreign-travel-advice,/api/content/foreign-travel-advice/spain,/api/content/foreign-travel-advice/usa", calls.join());
  const n2 = await topUpTravelAdvice(redis as any, log, codes, now, fetcher);
  check("tick 2: no index, next 3 countries", n2 === 3 && calls.slice(3).join() === "/api/content/foreign-travel-advice/france,/api/content/foreign-travel-advice/portugal,/api/content/foreign-travel-advice/turkey", calls.slice(3).join());
  const n3 = await topUpTravelAdvice(redis as any, log, codes, new Date(now.getTime() + 3600_000), fetcher);
  check("an hour later: nothing to fetch", n3 === 0);
  const usa = await readTravelAdvice(redis as any, "US");
  check("read: USA advice with level", usa?.level === "PARTS_ALL" && usa?.name === "USA" && !!usa?.entryUrl);
  check("read: not cached / UK → null", (await readTravelAdvice(redis as any, "CZ")) === null && (await readTravelAdvice(redis as any, "GB")) === null);

  failing.add("/api/content/foreign-travel-advice/czechia");
  const before = calls.length;
  await topUpTravelAdvice(redis as any, log, ["CZ"], now, fetcher);
  await topUpTravelAdvice(redis as any, log, ["CZ"], now, fetcher);
  check("error → logged once, backed off", calls.length === before + 1 && logs.some((l) => l.includes("czechia refresh failed")));

  const later = new Date(now.getTime() + 25 * 3600_000);
  await topUpTravelAdvice(redis as any, log, [], later, fetcher);
  check("a day later: index refreshed", calls[calls.length - 1] === "/api/content/foreign-travel-advice");
  const r2 = new FakeRedis();
  await topUpTravelAdvice(r2 as any, log, ["ES"], now, async () => ({ links: { children: [] } }));
  check("thin index refused (not stored)", !(await r2.get("fcdo:index")) && logs.some((l) => l.includes("only 0 countries")));

  console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
  process.exit(failures ? 1 : 0);
})();
