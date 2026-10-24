// backend/scripts/test-airline-terminals.ts
//
// "Which Gatwick terminal?" pages: which airline a flight belongs to, what's recorded from a
// board refresh, the 7-day memory, the per-airline answer (North / South / both) and moves
// between terminals. Pure rules plus an in-memory Redis — no network.
//
//   node --env-file=.env -r ts-node/register scripts/test-airline-terminals.ts
import { parseBoard } from "../src/services/flightBoardRules";
import {
  airlineOf,
  daysCovered,
  findMove,
  mergeObservations,
  Observation,
  observationsOf,
  PAGE_MIN_FLIGHTS,
  slugify,
  summarise,
} from "../src/services/airlineTerminalRules";
import { getTerminalSummary, recordAirlineTerminals } from "../src/services/airlineTerminals.service";

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
}

// ── Airline grouping and slugs ──────────────────────────────────────────────
check("U2 → easyjet", airlineOf({ iata: "U2", name: "easyJet" })?.slug === "easyjet");
check("DS (easyJet Switzerland) → easyjet", airlineOf({ iata: "DS", name: "easyJet Switzerland" })?.slug === "easyjet");
check("EC (easyJet Europe) → easyjet, name easyJet", airlineOf({ iata: "EC", name: "easyJet Europe" })?.name === "easyJet");
check("BA → british-airways", airlineOf({ iata: "BA", name: "British Airways" })?.slug === "british-airways");
check("W4 → wizz-air", airlineOf({ iata: "W4", name: "Wizz Air Malta" })?.slug === "wizz-air");
check("unknown airline → slug from its name", airlineOf({ iata: "EI", name: "Aer Lingus" })?.slug === "aer-lingus");
check("accents dropped", slugify("Aérolíneas Argentinas") === "aerolineas-argentinas");
check("& becomes and", slugify("Jet & Co") === "jet-and-co");
check("no name → slug from the code", airlineOf({ iata: "ZZ", name: null })?.slug === "zz");
check("no airline at all → null", airlineOf({ iata: null, name: null }) === null);
check("lower-case code still groups", airlineOf({ iata: "u2", name: "x" })?.slug === "easyjet");

// ── Recording from a board refresh ──────────────────────────────────────────
const tm = (utc: string) => ({ utc: utc.replace("T", " ") + "Z", local: utc + "+01:00" });
const LGW = { iata: "LGW" };
const AMS = { iata: "AMS", municipalityName: "Amsterdam", countryCode: "NL" };
const dep = (number: string, airline: object, at: string, terminal: string | null, extra: object = {}) => ({
  number,
  status: "Expected",
  codeshareStatus: "IsOperator",
  isCargo: false,
  airline,
  departure: { airport: LGW, scheduledTime: tm(at), terminal, quality: [] },
  arrival: { airport: AMS, scheduledTime: tm(at.replace(/T(\d\d)/, (_m, h) => `T${String(Number(h) + 1).padStart(2, "0")}`)), quality: [] },
  ...extra,
});
const EZY = { name: "easyJet", iata: "U2", icao: "EZY" };
const KLM = { name: "KLM", iata: "KL", icao: "KLM" };
const board = parseBoard({
  departures: [
    dep("U2 8001", EZY, "2026-10-23T07:00", "N"),
    dep("U2 8003", EZY, "2026-10-23T08:00", "N"),
    dep("U2 8005", EZY, "2026-10-23T09:00", null), // filled in as North (inferred)
    dep("KL 1234", KLM, "2026-10-23T09:00", null, { codeshareStatus: "IsCodeshared" }),
    dep("A0 42YR", EZY, "2026-10-23T10:00", "N"), // call sign: not a flight number
  ],
});
const obs = observationsOf(board);
check("codeshare and call sign left out", obs.length === 3, `${obs.length} records`);
check("all three are easyJet", obs.every((o) => o.slug === "easyjet"));
const inferred = obs.find((o) => o.displayNumber === "EZY8005");
check("filled-in terminal is NOT counted", !!inferred && inferred.terminal === null, String(inferred?.terminal));
check("stated terminal kept", obs.find((o) => o.displayNumber === "EZY8001")?.terminal === "NORTH");
check("display number as on the ticket", obs.some((o) => o.displayNumber === "EZY8003"));

// ── Merging refreshes (7-day memory) ────────────────────────────────────────
const NOW = new Date("2026-10-23T12:00:00Z");
const o = (id: string, slug: string, at: string, terminal: "NORTH" | "SOUTH" | null, dir: "ARRIVAL" | "DEPARTURE" = "DEPARTURE"): Observation => ({
  id,
  slug,
  name: slug === "easyjet" ? "easyJet" : slug === "british-airways" ? "British Airways" : slug,
  code: null,
  direction: dir,
  scheduledUtc: new Date(at).toISOString(),
  terminal,
  displayNumber: id,
});
const merged = mergeObservations(
  [o("A", "easyjet", "2026-10-23T08:00Z", "NORTH"), o("OLD", "easyjet", "2026-10-15T08:00Z", "NORTH")],
  [o("A", "easyjet", "2026-10-23T08:00Z", null), o("B", "easyjet", "2026-10-23T09:00Z", "NORTH")],
  NOW
);
check("same flight kept once", merged.filter((x) => x.id === "A").length === 1);
check("stated terminal survives a later copy without one", merged.find((x) => x.id === "A")?.terminal === "NORTH");
check("older than 7 days dropped", !merged.some((x) => x.id === "OLD"));
check("new flight added", merged.some((x) => x.id === "B"));

// ── Summaries ───────────────────────────────────────────────────────────────
const many = (slug: string, n: number, terminal: "NORTH" | "SOUTH" | null, day = "2026-10-22", prefix = slug) =>
  Array.from({ length: n }, (_, i) =>
    o(`${prefix}${i}`, slug, `${day}T${String(6 + (i % 14)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z`, terminal, i % 2 ? "ARRIVAL" : "DEPARTURE")
  );
const sum = summarise([
  ...many("easyjet", 40, "NORTH"),
  ...many("easyjet", 2, "SOUTH", "2026-10-22", "ezs"),
  ...many("british-airways", 12, "NORTH"),
  ...many("british-airways", 12, "SOUTH", "2026-10-22", "bas"),
  ...many("loganair", 3, null),
  ...many("small", 4, "SOUTH"),
]);
const ezy = sum.find((a) => a.slug === "easyjet")!;
const ba = sum.find((a) => a.slug === "british-airways")!;
const lm = sum.find((a) => a.slug === "loganair")!;
const small = sum.find((a) => a.slug === "small")!;
check("busiest first", sum[0].slug === "easyjet");
check("easyJet: 40 North + 2 South → North", ezy.terminal === "NORTH", `${ezy.terminal}`);
check("easyJet counts", ezy.north === 40 && ezy.south === 2 && ezy.flights === 42);
check("easyJet share ≈ 95%", ezy.mainShare != null && Math.abs(ezy.mainShare - 40 / 42) < 1e-9);
check("arrivals + departures add up", ezy.arrivals + ezy.departures === ezy.flights);
check("BA: half and half → BOTH", ba.terminal === "BOTH" && ba.mainShare === null);
check("no stated terminal → null", lm.terminal === null);
check(`page only from ${PAGE_MIN_FLIGHTS} flights`, ezy.hasPage && ba.hasPage && !small.hasPage && !lm.hasPage);
check("small airline still listed", small.terminal === "SOUTH" && small.flights === 4);
check("display name from the records", ba.name === "British Airways");

// ── Moves between terminals ─────────────────────────────────────────────────
const movedObs = [
  ...many("vueling", 6, "NORTH", "2026-10-17", "v17"),
  ...many("vueling", 6, "NORTH", "2026-10-18", "v18"),
  ...many("vueling", 6, "NORTH", "2026-10-19", "v19"),
  ...many("vueling", 6, "SOUTH", "2026-10-20", "v20"),
  ...many("vueling", 6, "SOUTH", "2026-10-21", "v21"),
];
const mv = findMove(movedObs);
check("North 3 days then South 2 days → moved", !!mv && mv.from === "NORTH" && mv.to === "SOUTH" && mv.since === "2026-10-20", JSON.stringify(mv));
const vy = summarise(movedObs)[0];
check("after a move the answer is the new terminal", vy.terminal === "SOUTH" && vy.moved?.since === "2026-10-20", `${vy.terminal}`);
check("…even though most of the week was North", vy.north > vy.south);

const mixedDaily = ["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"].flatMap((d) => [
  ...many("mixed", 3, "NORTH", d, `mn${d}`),
  ...many("mixed", 3, "SOUTH", d, `ms${d}`),
]);
check("both terminals every day → no move", findMove(mixedDaily) === null);
check("one day before the change isn't enough", findMove([...many("x", 4, "NORTH", "2026-10-19", "a"), ...many("x", 4, "SOUTH", "2026-10-20", "b"), ...many("x", 4, "SOUTH", "2026-10-21", "c")]) === null);
check("same terminal all week → no move", findMove([...many("y", 4, "NORTH", "2026-10-18", "a"), ...many("y", 4, "NORTH", "2026-10-19", "b"), ...many("y", 4, "NORTH", "2026-10-20", "c")]) === null);
check("a day with one stated flight is ignored", findMove([
  ...many("z", 4, "NORTH", "2026-10-17", "a"),
  ...many("z", 4, "NORTH", "2026-10-18", "b"),
  ...many("z", 1, "SOUTH", "2026-10-19", "c"),
]) === null);

// ── Days covered ────────────────────────────────────────────────────────────
check("same day → 1", daysCovered("2026-10-23", NOW) === 1);
check("4 days", daysCovered("2026-10-20", NOW) === 4);
check("capped at 7", daysCovered("2026-10-01", NOW) === 7);

// ── Service: two refreshes, read back ───────────────────────────────────────
(async () => {
  const redis = new FakeRedis() as any;
  check("nothing yet → null", (await getTerminalSummary(redis)) === null);
  await recordAirlineTerminals(redis, board, new Date("2026-10-23T06:00:00Z"));
  const later = parseBoard({
    departures: [
      dep("U2 8001", EZY, "2026-10-23T07:00", null), // terminal dropped near departure
      dep("U2 8007", EZY, "2026-10-23T11:00", "N"),
    ],
  });
  const n = await recordAirlineTerminals(redis, later, new Date("2026-10-23T06:10:00Z"));
  check("records merged across refreshes", n === 4, `${n}`);
  const s = await getTerminalSummary(redis);
  const e = s?.airlines.find((a) => a.slug === "easyjet");
  check("summary readable", !!s && s.updatedAt === "2026-10-23T06:10:00.000Z");
  check("easyJet North from stated flights only", e?.terminal === "NORTH" && e.north === 3 && e.flights === 4, JSON.stringify(e && { n: e.north, f: e.flights }));
  check("stored compactly", (redis.store.get("airlineterm:obs") ?? "").startsWith("[["));
  redis.store.set("airlineterm:summary", "not json");
  check("bad summary → null, no crash", (await getTerminalSummary(redis)) === null);

  console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
  process.exit(failures ? 1 : 0);
})();
