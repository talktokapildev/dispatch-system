// backend/scripts/test-flight-seen.ts
//
// "Seen recently" memory for the website flight pages: what's recorded from a board refresh,
// how it's read back by any form of the number, the 7-day expiry and the sitemap list.
// In-memory Redis — no network.
//
//   node --env-file=.env -r ts-node/register scripts/test-flight-seen.ts
import { parseBoard } from "../src/services/flightBoardRules";
import { listSeen, readSeen, recordSeen } from "../src/services/flightSeen.service";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

class FakeRedis {
  store = new Map<string, { v: string; exp: number | null }>();
  zsets = new Map<string, Map<string, number>>();
  now = 0;
  async set(k: string, v: string, ...a: any[]) {
    const i = a.indexOf("EX");
    this.store.set(k, { v, exp: i >= 0 ? this.now + Number(a[i + 1]) * 1000 : null });
    return "OK";
  }
  async get(k: string) {
    const e = this.store.get(k);
    return e && (e.exp == null || e.exp > this.now) ? e.v : null;
  }
  async mget(...ks: string[]) {
    return Promise.all(ks.map((k) => this.get(k)));
  }
  async zadd(k: string, score: number, m: string) {
    const z = this.zsets.get(k) ?? new Map();
    z.set(m, score);
    this.zsets.set(k, z);
    return 1;
  }
  async zremrangebyscore(k: string, min: number, max: number) {
    const z = this.zsets.get(k);
    if (z) for (const [m, s] of z) if (s >= min && s <= max) z.delete(m);
    return 1;
  }
  async zrangebyscore(k: string, min: number, _max: string) {
    const z = this.zsets.get(k) ?? new Map<string, number>();
    return [...z].filter(([, s]) => s >= min).sort((a, b) => a[1] - b[1]).map(([m]) => m);
  }
}

const tm = (utc: string) => ({ utc: utc.replace("T", " ") + "Z", local: utc + "+01:00" });
const LGW = { iata: "LGW" };
const board = parseBoard({
  arrivals: [
    {
      number: "U2 8687",
      status: "EnRoute",
      codeshareStatus: "IsOperator",
      isCargo: false,
      airline: { name: "easyJet", iata: "U2", icao: "EZY" },
      aircraft: { model: "Airbus A320neo" },
      departure: { airport: { iata: "AMS", municipalityName: "Amsterdam", countryCode: "NL", timeZone: "Europe/Amsterdam" }, scheduledTime: tm("2026-10-23T18:25") },
      arrival: { airport: LGW, scheduledTime: tm("2026-10-23T20:10"), terminal: "N" },
    },
    {
      number: "KL 1234",
      status: "EnRoute",
      codeshareStatus: "IsCodeshared",
      isCargo: false,
      airline: { name: "KLM", iata: "KL", icao: "KLM" },
      departure: { airport: { iata: "AMS", municipalityName: "Amsterdam" }, scheduledTime: tm("2026-10-23T18:25") },
      arrival: { airport: LGW, scheduledTime: tm("2026-10-23T20:10"), terminal: "N" },
    },
    {
      number: "A0 42YR",
      status: "Arrived",
      codeshareStatus: "Unknown",
      isCargo: false,
      airline: { name: "BA Euroflyer", iata: "A0", icao: "EFW" },
      departure: { airport: { iata: "VCE", municipalityName: "Venice" }, scheduledTime: tm("2026-10-23T17:00") },
      arrival: { airport: LGW, scheduledTime: tm("2026-10-23T19:00") },
    },
  ],
  departures: [
    {
      number: "U2 8023",
      status: "Expected",
      codeshareStatus: "IsOperator",
      isCargo: false,
      airline: { name: "easyJet", iata: "U2", icao: "EZY" },
      departure: { airport: LGW, scheduledTime: tm("2026-10-23T21:35"), terminal: "N" },
      arrival: { airport: { iata: "BCN", municipalityName: "Barcelona", countryCode: "ES" }, scheduledTime: tm("2026-10-23T23:45") },
    },
  ],
});

async function main() {
  const r = new FakeRedis();
  const NOW = new Date("2026-10-23T19:41:00Z");
  r.now = NOW.getTime();
  const n = await recordSeen(r as any, board, NOW);
  check("records every searchable form", n >= 5, String(n));

  const byEzy = await readSeen(r as any, "ezy 8687");
  check("found by EZY number", byEzy.length === 1 && byEzy[0].displayNumber === "EZY8687");
  check("found by U2 number", (await readSeen(r as any, "U28687")).length === 1);
  const s = byEzy[0];
  check("usual time in UK clock", s.usualTimeUk === "21:10", s.usualTimeUk);
  check("route and terminal kept", s.other.name === "Amsterdam" && s.other.countryCode === "NL" && s.terminal === "NORTH");
  check("last date (UK)", s.lastDate === "2026-10-23");
  check("codeshare number searchable", (await readSeen(r as any, "KL1234")).length === 1);
  check("departure kept separately", (await readSeen(r as any, "EZY8023"))[0]?.direction === "DEPARTURE");
  check("call-sign entries not remembered", (await readSeen(r as any, "A042YR")).length === 0);
  check("bad input", (await readSeen(r as any, "hello")).length === 0);

  const list = await listSeen(r as any, NOW);
  check("sitemap: operating flights only", list.includes("EZY8687") && list.includes("EZY8023") && !list.includes("KL1234"), list.join(","));

  // 8 days later, nothing seen since: gone.
  const later = new Date(NOW.getTime() + 8 * 86_400_000);
  r.now = later.getTime();
  check("expires after 7 days", (await readSeen(r as any, "EZY8687")).length === 0);
  check("sitemap forgets it too", (await listSeen(r as any, later)).length === 0);

  console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
