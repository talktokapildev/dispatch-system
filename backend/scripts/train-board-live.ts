// backend/scripts/train-board-live.ts
//
// Live check against National Rail (uses real requests, a handful): fetches the Three Bridges
// board the way the server does and prints what the website would show. Stores nothing.
//
//   RAIL_DATA_API_KEY=... TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register scripts/train-board-live.ts
//   (optionally RAIL_BOARD_URL=... to try a different endpoint)
import { refreshStation, getTrainBoard } from "../src/services/trainBoard.service";
import { STATIONS } from "../src/services/trainBoardRules";

class MemRedis {
  store = new Map<string, string>();
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.store.set(k, v);
    return "OK";
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
    const self = this;
    const ops: [string, string][] = [];
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

const hm = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "--:--";

async function main() {
  if (!process.env.RAIL_DATA_API_KEY) throw new Error("Set RAIL_DATA_API_KEY");
  const redis = new MemRedis();
  const st = STATIONS[0];
  const r = await refreshStation({ redis: redis as any, log: { warn: (m) => console.log("WARN", m) } }, st);
  console.log(`refresh: ${r}, requests: ${[...redis.store.entries()].find(([k]) => k.startsWith("trainboard:calls"))?.[1]}`);
  const b = await getTrainBoard(redis as any, st.crs);
  if (!b) return;
  for (const m of b.messages) console.log("MESSAGE:", m);
  for (const s of b.services) {
    console.log(
      [
        s.arr ? `arr ${hm(s.arr.sched)}→${s.arr.status}${s.arr.delayMin ? ` ${s.arr.delayMin}m` : ""}` : "starts here",
        s.dep ? `dep ${hm(s.dep.sched)}→${s.dep.status}` : "ends here",
        `${s.origin} → ${s.destination}`,
        s.operator,
        `plat ${s.platform ?? "-"}`,
        `${s.coaches ?? "?"} coaches`,
        `${s.previous.length}/${s.subsequent.length} stops`,
        s.kind !== "TRAIN" ? s.kind : "",
      ].join(" | ")
    );
  }
  console.log(`${b.services.length} services`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
