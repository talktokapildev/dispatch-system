// backend/scripts/test-flight-board-rules.ts
//
// Pure rule check for the website flight status page (no database, network, Redis or SMS).
//
//   node --env-file=.env -r ts-node/register scripts/test-flight-board-rules.ts
import {
  displayNumberFor,
  fillTerminals,
  boardList,
  boardWindow,
  describe,
  findInBoard,
  matchKey,
  parseBoard,
  parseLookupLegs,
  BoardFlight,
} from "../src/services/flightBoardRules";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

// Times on Fri 23 Oct 2026 (UK = UTC+1). t("19:10") is 19:10 UTC = 20:10 UK.
const t = (hhmm: string, day = "2026-10-23") => `${day} ${hhmm}Z`;
const tm = (utcHm: string, localHm: string, offset = "+01:00", day = "2026-10-23") => ({
  utc: t(utcHm, day),
  local: `${day} ${localHm}${offset}`,
});
const NOW = new Date("2026-10-23T19:41:00Z"); // 20:41 UK

const AMS = {
  iata: "AMS",
  name: "Amsterdam Schiphol",
  municipalityName: "Amsterdam",
  countryCode: "nl",
  location: { lat: 52.3086, lon: 4.7639 },
  timeZone: "Europe/Amsterdam",
};
const LGW = { iata: "LGW", name: "London Gatwick", municipalityName: "London" };
const BCN = { iata: "BCN", name: "Barcelona", municipalityName: "Barcelona" };
const easyJet = { name: "easyJet", iata: "U2", icao: "EZY" };

// Arrival in the air: AMS 20:25 local (19:25 UK) → LGW due 20:10Z gate.
const ezy8687 = {
  number: "U2 8687",
  status: "EnRoute",
  codeshareStatus: "IsOperator",
  isCargo: false,
  airline: easyJet,
  aircraft: { model: "Airbus A320neo" },
  departure: {
    airport: AMS,
    scheduledTime: tm("18:25", "20:25", "+02:00"),
    runwayTime: tm("18:41", "20:41", "+02:00"),
    quality: ["Basic", "Live"],
  },
  arrival: {
    airport: LGW,
    scheduledTime: tm("20:10", "21:10"),
    revisedTime: tm("20:19", "21:19"),
    terminal: "N",
    baggageBelt: "6",
    gate: "55",
    quality: ["Basic", "Live"],
  },
};
// Same flight sold as a codeshare.
const codeshare = { ...ezy8687, number: "KL 9999", codeshareStatus: "IsCodeshared", airline: { name: "KLM", iata: "KL", icao: "KLM" } };
const cargo = { ...ezy8687, number: "FX 1", isCargo: true, airline: { name: "FedEx", iata: "FX", icao: "FDX" } };
// Departure later today.
const ezy8023 = {
  number: "U2 8023",
  status: "Expected",
  codeshareStatus: "IsOperator",
  isCargo: false,
  airline: easyJet,
  departure: {
    airport: LGW,
    scheduledTime: tm("21:35", "22:35"),
    terminal: "N",
    checkInDesk: "B1-B20",
    baggageBelt: "9",
    quality: ["Basic"],
  },
  arrival: { airport: BCN, scheduledTime: tm("23:45", "01:45", "+02:00", "2026-10-23"), quality: ["Basic"] },
};

const board = parseBoard({ arrivals: [ezy8687, codeshare, cargo], departures: [ezy8023] });

// ── Flight numbers ──────────────────────────────────────────────────────────
check("matchKey EZY8687", matchKey("EZY8687") === "EZY8687");
check("matchKey spaces + case", matchKey("ezy 8687") === "EZY8687");
check("matchKey leading zero", matchKey("BA0123") === matchKey("BA 123") && matchKey("BA123") === "BA123");
check("matchKey provider format", matchKey("U2 8687") === "U28687");
check("matchKey rejects text", matchKey("hello") === null);

// ── Parsing ─────────────────────────────────────────────────────────────────
check("cargo dropped", board.length === 3, `${board.length} flights`);
const arr = board.find((f) => f.number === "U2 8687" && f.direction === "ARRIVAL")!;
check("arrival parsed", !!arr);
check("keys: IATA and ICAO", arr.keys.includes("U28687") && arr.keys.includes("EZY8687"), arr.keys.join(","));
check("terminal North", arr.lgw.terminal === "NORTH");
check("belt on arrival", arr.lgw.baggageBelt === "6");
check("origin city", arr.other.name === "Amsterdam");
check("take-off local time", arr.other.runwayLocal === "20:41");
check("live flag", arr.lgw.live === true);
const cs = board.find((f) => f.number === "KL 9999")!;
check("codeshare linked to operator", cs.codeshare === "CODESHARE" && cs.operatedBy === "U2 8687");
check("board lists operators only", boardList(board, "ARRIVAL").length === 1);
const dep = board.find((f) => f.direction === "DEPARTURE")!;
check("departure check-in desk", dep.lgw.checkInDesk === "B1-B20");
check("no belt on departure", dep.lgw.baggageBelt === null);

// ── Finding ─────────────────────────────────────────────────────────────────
check("find by EZY", findInBoard(board, "EZY8687", null, NOW).length === 1);
check("find by U2", findInBoard(board, "u2 8687", null, NOW).length === 1);
check("find codeshare number", findInBoard(board, "KL9999", null, NOW)[0]?.number === "KL 9999");
check("find with right date", findInBoard(board, "EZY8687", "2026-10-23", NOW).length === 1);
check("find with wrong date", findInBoard(board, "EZY8687", "2026-10-24", NOW).length === 0);

// ── Arrivals ────────────────────────────────────────────────────────────────
const B = { hand: 30, checked: 45 };
const vAir = describe(arr, NOW, B);
check("in the air", vAir.state === "EN_ROUTE", vAir.state);
check("gate = revised 20:19Z", vAir.gateAt === "2026-10-23T20:19:00.000Z", vAir.gateAt ?? "");
check("lands = gate - 7", vAir.landsAt === "2026-10-23T20:12:00.000Z", vAir.landsAt ?? "");
check("9 min late, info colour", vAir.delayMin === 9 && vAir.tone === "info", `${vAir.delayMin} ${vAir.tone}`);
check("out with bags = gate + 45", vAir.outBagsAt === "2026-10-23T21:04:00.000Z", vAir.outBagsAt ?? "");
check("out hand luggage = gate + 30", vAir.outHandAt === "2026-10-23T20:49:00.000Z");
check(
  "progress between take-off and landing",
  vAir.progress != null && vAir.progress > 0.5 && vAir.progress < 0.97,
  String(vAir.progress)
);
check("minutes to go", vAir.minutesToGo === 31, String(vAir.minutesToGo));

const with_ = (f: BoardFlight, status: string | null, lgw: Partial<BoardFlight["lgw"]>, other: Partial<BoardFlight["other"]> = {}) =>
  ({ ...f, status, lgw: { ...f.lgw, ...lgw }, other: { ...f.other, ...other } }) as BoardFlight;

const landed = with_(arr, "Arrived", { runwayUtc: "2026-10-23T20:14:00.000Z", revisedUtc: null });
const vLanded = describe(landed, new Date("2026-10-23T20:30:00Z"), B);
check("landed", vLanded.state === "LANDED" && vLanded.landed && vLanded.tone === "good");
check("landed at touchdown, gate +7", vLanded.landsAt === "2026-10-23T20:14:00.000Z" && vLanded.gateAt === "2026-10-23T20:21:00.000Z");
check("touchdown known", vLanded.arrivedTimeIsGate === false);

const arrivedNoRunway = with_(arr, "Arrived", { runwayUtc: null, revisedUtc: "2026-10-23T20:16:00.000Z" });
const vNoRw = describe(arrivedNoRunway, new Date("2026-10-23T20:30:00Z"), B);
check("arrived without touchdown: time is the gate", vNoRw.state === "LANDED" && vNoRw.arrivedTimeIsGate);

const notYet = with_(arr, "Expected", { revisedUtc: null }, { runwayUtc: null, revisedUtc: null });
const vNotYet = describe(notYet, new Date("2026-10-23T16:00:00Z"), B);
check("before take-off, on time", vNotYet.state === "SCHEDULED" && vNotYet.delayMin === 0, vNotYet.state);

const delayed = with_(arr, "Expected", { revisedUtc: "2026-10-23T21:01:00.000Z" }, { runwayUtc: null });
const vDelayed = describe(delayed, new Date("2026-10-23T19:30:00Z"), B);
check("airline delay before take-off", vDelayed.state === "DELAYED" && vDelayed.tone === "late", `${vDelayed.state} ${vDelayed.delayMin}`);

const early = with_(arr, "EnRoute", { revisedUtc: "2026-10-23T19:58:00.000Z" });
const vEarly = describe(early, NOW, B);
check("early in the air", vEarly.tone === "early" && vEarly.delayMin === -12, `${vEarly.tone} ${vEarly.delayMin}`);
// An impossible estimate (before take-off + 70% of flight time) is ignored, as for bookings.
const impossible = describe(with_(arr, "EnRoute", { revisedUtc: "2026-10-23T19:40:00.000Z" }), NOW, B);
check("impossible early estimate ignored", impossible.delayMin === 1, String(impossible.delayMin));

check("cancelled", describe(with_(arr, "Canceled", {}), NOW, B).state === "CANCELLED");
check("maybe cancelled", describe(with_(arr, "CanceledUncertain", {}), NOW, B).state === "MAYBE_CANCELLED");
check("diverted", describe(with_(arr, "Diverted", {}), NOW, B).tone === "bad");

// ── Departures ──────────────────────────────────────────────────────────────
const vDep = describe(dep, NOW, B);
check("departure scheduled", vDep.state === "SCHEDULED" && vDep.tone === "info", vDep.state);
check("be there 2h before", vDep.beThereBy === "2026-10-23T19:35:00.000Z", vDep.beThereBy ?? "");
check("gate shown ~40 min before", vDep.gateShownAt === "2026-10-23T20:55:00.000Z");
check("boarding ~30 min before", vDep.boardingAt === "2026-10-23T21:05:00.000Z");
check("short-haul", vDep.longHaul === false);

check("check-in open", describe(with_(dep, "CheckIn", {}), NOW, B).state === "CHECK_IN");
check("boarding", describe(with_(dep, "Boarding", { gate: "52" }), NOW, B).state === "BOARDING");
check("gate known → no gate estimate", describe(with_(dep, "Boarding", { gate: "52" }), NOW, B).gateShownAt === null);
check("gate closed", describe(with_(dep, "GateClosed", {}), NOW, B).state === "GATE_CLOSED");
const depLate = describe(with_(dep, "Expected", { revisedUtc: "2026-10-23T22:15:00.000Z" }), NOW, B);
check("departure delayed 40 min", depLate.state === "DELAYED" && depLate.delayMin === 40 && depLate.tone === "late");
check("delayed boarding moves too", depLate.boardingAt === "2026-10-23T21:45:00.000Z");
const departed = describe(
  with_(dep, "EnRoute", { runwayUtc: "2026-10-23T21:48:00.000Z" }),
  new Date("2026-10-23T22:00:00Z"),
  B
);
check("departed", departed.state === "DEPARTED" && departed.departedAt === "2026-10-23T21:48:00.000Z");
const forecastRunway = describe(
  with_(dep, "Boarding", { runwayUtc: "2026-10-23T21:48:00.000Z" }),
  new Date("2026-10-23T21:30:00Z"),
  B
);
check("future take-off time is not 'departed'", forecastRunway.state === "BOARDING", forecastRunway.state);
check("departure cancelled", describe(with_(dep, "Canceled", {}), NOW, B).state === "CANCELLED");
const longHaul = describe(with_(dep, "Expected", {}, { scheduledUtc: "2026-10-24T07:35:00.000Z" }), NOW, B);
check("long-haul: 3h before", longHaul.longHaul && longHaul.beThereBy === "2026-10-23T18:35:00.000Z");

// ── Single-flight lookup response ───────────────────────────────────────────
const legs = parseLookupLegs([ezy8687, { ...ezy8687, arrival: { ...ezy8687.arrival, airport: { iata: "LTN" } } }]);
check("lookup keeps Gatwick legs only", legs.length === 1 && legs[0].direction === "ARRIVAL");

// ── v2: ticket-style numbers, airport position/country, terminal filling ─────
check("easyJet shown as EZY", arr.displayNumber === "EZY8687", arr.displayNumber);
check("BA stays BA", displayNumberFor("BA 2525", "BA") === "BA2525");
check("easyJet Switzerland as EZS", displayNumberFor("DS 1234", "DS") === "EZS1234");
check("leading zeros dropped", displayNumberFor("BA 0123", "BA") === "BA123");
check("country code upper-cased", arr.other.countryCode === "NL", String(arr.other.countryCode));
check("airport position", arr.other.lat === 52.3086 && arr.other.lon === 4.7639);
check("airport time zone", arr.other.timeZone === "Europe/Amsterdam");
check("no position → null", dep.other.lat === null && dep.other.countryCode === null);
check("provider terminal not marked inferred", arr.lgw.terminalInferred === false);
const mk = (term: "NORTH" | "SOUTH" | null, iata = "U2", n = "1", cs: BoardFlight["codeshare"] = "OPERATOR") =>
  ({ ...arr, id: `x${n}${iata}${term}`, number: `${iata} ${n}`, airline: { ...arr.airline, iata }, codeshare: cs, lgw: { ...arr.lgw, terminal: term, terminalInferred: false } }) as BoardFlight;
const filled = fillTerminals([mk("NORTH", "U2", "1"), mk("NORTH", "U2", "2"), mk(null, "U2", "3")]);
check("fills blank from same airline", filled[2].lgw.terminal === "NORTH" && filled[2].lgw.terminalInferred);
const mixed = fillTerminals([mk("NORTH", "BA", "1"), mk("SOUTH", "BA", "2"), mk(null, "BA", "3")]);
check("airline at both terminals stays blank", mixed[2].lgw.terminal === null);
const single = fillTerminals([mk("SOUTH", "W6", "1"), mk(null, "W6", "2")]);
check("needs 2 known flights", single[1].lgw.terminal === null);
const viaCodeshare = fillTerminals([mk("NORTH", "KL", "1", "CODESHARE"), mk("NORTH", "KL", "2", "CODESHARE"), mk(null, "KL", "3")]);
check("codeshares don't count", viaCodeshare[2].lgw.terminal === null);
const board2 = parseBoard({ arrivals: [ezy8687, { ...ezy8687, number: "U2 8001", arrival: { ...ezy8687.arrival, scheduledTime: tm("21:10", "22:10") } }, { ...ezy8687, number: "U2 8002", arrival: { ...ezy8687.arrival, terminal: null, scheduledTime: tm("22:10", "23:10") } }], departures: [] });
check("parseBoard fills terminals", board2.find((f) => f.number === "U2 8002")?.lgw.terminal === "NORTH");

// ── Board window (12 h of LOCAL clock time, max) ────────────────────────────
const w = boardWindow(new Date("2026-10-23T12:00:00Z")); // 13:00 UK (BST)
check("window from 2h back (UK clock)", w.fromLocal === "2026-10-23T11:00", w.fromLocal);
check("window to +11:59 local", w.toLocal === "2026-10-23T22:59", w.toLocal);
const autumn = boardWindow(new Date("2026-10-25T00:30:00Z")); // clocks go back at 01:00 UTC
check("clock-change night", autumn.fromLocal === "2026-10-24T23:30" && autumn.toLocal === "2026-10-25T11:29", `${autumn.fromLocal}..${autumn.toLocal}`);
const spring = boardWindow(new Date("2027-03-28T02:30:00Z")); // clocks went forward at 01:00 UTC
check("spring clock change", spring.fromLocal === "2027-03-28T00:30" && spring.toLocal === "2027-03-28T12:29", `${spring.fromLocal}..${spring.toLocal}`);

console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
