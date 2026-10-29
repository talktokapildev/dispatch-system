// backend/scripts/flight-board-live.ts
//
// Live check of the website flight status board against the REAL AeroDataBox API,
// using your LOCAL Redis (docker compose up -d redis). Costs 2 units per refresh or lookup.
//
//   node --env-file=.env -r ts-node/register scripts/flight-board-live.ts board            # refresh now (2 units) + summary
//   node --env-file=.env -r ts-node/register scripts/flight-board-live.ts show EZY8687     # one flight, from the stored board (free)
//   node --env-file=.env -r ts-node/register scripts/flight-board-live.ts lookup BA2541 2026-10-24   # outside the board (2 units, cached 30 min)
//   node --env-file=.env -r ts-node/register scripts/flight-board-live.ts evidence         # "in the air" evidence check on the stored board (free)
import Redis from "ioredis";
import { getBoard, lookupFlight, refreshBoardIfDue } from "../src/services/flightBoard.service";
import { boardList, describe, findInBoard, BoardFlight } from "../src/services/flightBoardRules";

const uk = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso))
    : "--:--";

function line(f: BoardFlight) {
  const v = describe(f);
  const where = f.direction === "ARRIVAL" ? `from ${f.other.name ?? f.other.iata}` : `to ${f.other.name ?? f.other.iata}`;
  const extra =
    f.direction === "ARRIVAL"
      ? `lands ${uk(v.landsAt)} gate ${uk(v.gateAt)} out ${uk(v.outHandAt)}/${uk(v.outBagsAt)}${f.lgw.baggageBelt ? ` belt ${f.lgw.baggageBelt}` : ""}`
      : `departs ${uk(v.expectedAt)}${f.lgw.gate ? ` gate ${f.lgw.gate}` : ""}${f.lgw.checkInDesk ? ` desks ${f.lgw.checkInDesk}` : ""}`;
  return `${uk(f.lgw.scheduledUtc)}  ${f.number.padEnd(8)} ${where.padEnd(22)} ${(f.lgw.terminal ?? "?").padEnd(5)} ${(v.state + (v.inAir ? `/${v.inAir}` : "")).padEnd(27)} ${String(v.delayMin ?? "").padStart(4)}m  ${extra}  [${f.status}]`;
}

function detail(f: BoardFlight) {
  console.log(JSON.stringify({ flight: f, view: describe(f) }, null, 1));
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  const log = { warn: (m: string) => console.log(m) };
  const deps = { redis, prisma: {} as any, log };
  try {
    if (cmd === "board") {
      process.env.FLIGHT_BOARD_ENABLED = "true";
      await redis.del("flightboard:LGW:data", "flightboard:LGW:backoff", "flightboard:LGW:lock");
      console.log("refresh:", await refreshBoardIfDue(deps));
      const board = await getBoard(redis);
      if (!board) return;
      const codeshares = board.flights.filter((f) => f.codeshare === "CODESHARE").length;
      console.log(`window ${board.fromLocal} .. ${board.toLocal} (UK), ${board.flights.length} flights incl. ${codeshares} codeshares`);
      const states: Record<string, number> = {};
      for (const f of board.flights) states[describe(f).state] = (states[describe(f).state] ?? 0) + 1;
      console.log("states:", states);
      const soon = (dir: "ARRIVAL" | "DEPARTURE") =>
        boardList(board.flights, dir).filter((f) => Date.parse(f.lgw.scheduledUtc) > Date.now() - 60 * 60_000).slice(0, 10);
      console.log("\nARRIVALS");
      soon("ARRIVAL").forEach((f) => console.log(line(f)));
      console.log("\nDEPARTURES");
      soon("DEPARTURE").forEach((f) => console.log(line(f)));
      console.log(`\nunits left: ${await redis.get("adb:units:remaining")}`);
    } else if (cmd === "show" && a) {
      const board = await getBoard(redis);
      if (!board) return console.log("No board stored - run 'board' first.");
      const found = findInBoard(board.flights, a, b ?? null);
      if (!found.length) return console.log(`${a} not in the board (${board.fromLocal} .. ${board.toLocal}).`);
      found.forEach(detail);
    } else if (cmd === "lookup" && a && b) {
      const r = await lookupFlight(deps, a, b);
      if (r.status !== "FOUND") return console.log(r.status);
      r.flights.forEach(detail);
      console.log(`units left: ${await redis.get("adb:units:remaining")}`);
    } else if (cmd === "evidence") {
      // Is "live tracking / predicted landing" a safe sign that a plane is flying? Count it on
      // arrivals that have NOT taken off yet (departure time still ahead): if many of those
      // already carry it, it isn't, and TRACKED would claim "in the air" too easily.
      const board = await getBoard(redis);
      if (!board) return console.log("No board stored - run 'board' first.");
      const now = Date.now();
      const rows = boardList(board.flights, "ARRIVAL").filter((f) => !f.other.runwayUtc && !f.lgw.runwayUtc);
      const tally = (fs: BoardFlight[]) => ({
        flights: fs.length,
        live: fs.filter((f) => f.lgw.live).length,
        predicted: fs.filter((f) => !!f.lgw.predictedUtc).length,
        status: fs.reduce<Record<string, number>>((m, f) => ((m[f.status ?? "-"] = (m[f.status ?? "-"] ?? 0) + 1), m), {}),
      });
      const depAt = (f: BoardFlight) => Date.parse(f.other.revisedUtc ?? f.other.scheduledUtc ?? "");
      const notYet = rows.filter((f) => depAt(f) > now + 30 * 60_000);
      const shouldHaveLeft = rows.filter((f) => depAt(f) <= now - 15 * 60_000);
      console.log("No take-off reported, departure 30+ min AHEAD (must NOT look tracked):", tally(notYet));
      console.log("No take-off reported, departure 15+ min AGO:", tally(shouldHaveLeft));
      shouldHaveLeft.forEach((f) => console.log(line(f)));
    } else {
      console.log("Usage: board | show <number> [YYYY-MM-DD] | lookup <number> <YYYY-MM-DD> | evidence");
    }
  } finally {
    redis.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
