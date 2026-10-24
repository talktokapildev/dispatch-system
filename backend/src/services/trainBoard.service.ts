// backend/src/services/trainBoard.service.ts
//
// Live train times for the website (/trains/three-bridges): National Rail "Live Arrival and
// Departure Boards" (Darwin) from the Rail Data Marketplace. Free up to 5,000,000 requests
// per 4 weeks; the data licence requires "National Rail Enquiries" credited as the source
// (the website shows it under every board).
//
// Pages never call National Rail. A 1-minute tick fetches each station's next two hours
// (and the last 30 minutes, for late trains), stores it in Redis, and the website reads that.
// Calls: a few per station per minute (more pages if Darwin caps rows) ≈ 4–15/min ≈ well
// under 1,000,000 per 4 weeks. Quiet hours (01:30–04:30 UK): every 15 minutes.
//
// Env:
//   RAIL_DATA_API_KEY      the "Consumer key" from the product's page on raildata.org.uk
//                          (none → the train pages say live times aren't available)
//   RAIL_BOARD_URL         optional: the product's endpoint up to (not including) the station
//                          code, if it differs from DEFAULT_URL below
//   RAIL_DAILY_CAP=60000   hard stop per UK day
import axios from "axios";
import Redis from "ioredis";
import { ensureWeather } from "./weather.service";
import {
  mergeMessages,
  mergeServices,
  nextOffset,
  parseDarwinBoard,
  quietHours,
  Station,
  STATIONS,
  TrainBoard,
  TrainService,
  weatherKey,
} from "./trainBoardRules";

export const DEFAULT_URL =
  "https://api1.raildata.org.uk/1010-live-arrival-and-departure-boards-arr-and-dep1_1/LDBWS/api/20220120/GetArrDepBoardWithDetails";

const BACK_MIN = -30; // from 30 minutes ago (late trains still to come)
const AHEAD_MIN = 120; // to two hours ahead (Darwin's limit)
const ROWS = 150; // ask for plenty; Darwin may return fewer
const DARWIN_ROW_CAP = 10; // "with details" boards return at most this many
const MAX_PAGES = 16;
const KEEP_S = 3 * 3600; // keep the last board (shown as stale) if refreshes fail
const SEEN_S = 6 * 3600; // a train's page keeps working this long after it leaves the board
const QUIET_EVERY_MIN = 15;

const keys = {
  board: (crs: string) => `trainboard:${crs}:data`,
  lock: "trainboard:lock",
  backoff: "trainboard:backoff",
  calls: (day: string) => `trainboard:calls:${day}`,
  seen: (crs: string, id: string) => `trainseen:${crs}:${id}`,
};

type Log = { warn: (msg: string) => void; info?: (msg: string) => void };
export type TrainDeps = { redis: Redis; log: Log };

const londonDay = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);

export async function getTrainBoard(redis: Redis, crs: string): Promise<TrainBoard | null> {
  const raw = await redis.get(keys.board(crs));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TrainBoard;
  } catch {
    return null;
  }
}

/** A train recently on the board (for its own page after it has gone). */
export async function getSeenService(redis: Redis, crs: string, id: string): Promise<{ service: TrainService; fetchedAt: string } | null> {
  const raw = await redis.get(keys.seen(crs, id));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

type PageResult = { ok: true; body: any } | { ok: false; stop: boolean };

async function fetchPage(deps: TrainDeps, st: Station, offset: number, window: number, now: Date): Promise<PageResult> {
  const apiKey = process.env.RAIL_DATA_API_KEY;
  if (!apiKey) return { ok: false, stop: true };
  const cap = Number(process.env.RAIL_DAILY_CAP ?? 60000);
  const dayKey = keys.calls(londonDay(now));
  const n = await deps.redis.incr(dayKey);
  if (n === 1) await deps.redis.expire(dayKey, 2 * 86_400);
  if (n > cap) {
    if (n === cap + 1) deps.log.warn(`[TrainBoard] daily cap (${cap}) reached`);
    return { ok: false, stop: true };
  }
  const base = (process.env.RAIL_BOARD_URL || DEFAULT_URL).replace(/\/+$/, "");
  try {
    const res = await axios.get(`${base}/${st.crs}`, {
      params: { numRows: ROWS, timeOffset: offset, timeWindow: window },
      headers: { "x-apikey": apiKey, Accept: "application/json" },
      timeout: 10_000,
      validateStatus: () => true,
    });
    if (res.status === 401 || res.status === 403) {
      deps.log.warn(
        `[TrainBoard] National Rail refused the key (${res.status}). Check RAIL_DATA_API_KEY and that the account is subscribed to "Live Arrival and Departure Boards"`
      );
      await deps.redis.set(keys.backoff, "1", "EX", 10 * 60);
      return { ok: false, stop: true };
    }
    if (res.status === 429) {
      deps.log.warn("[TrainBoard] rate limited (429)");
      await deps.redis.set(keys.backoff, "1", "EX", 5 * 60);
      return { ok: false, stop: true };
    }
    if (res.status === 404) {
      deps.log.warn(`[TrainBoard] 404 from ${base}/${st.crs}: set RAIL_BOARD_URL to the endpoint shown on the product page`);
      await deps.redis.set(keys.backoff, "1", "EX", 30 * 60);
      return { ok: false, stop: true };
    }
    if (res.status !== 200 || typeof res.data !== "object" || !res.data) {
      deps.log.warn(`[TrainBoard] ${st.crs}: HTTP ${res.status}`);
      return { ok: false, stop: false };
    }
    return { ok: true, body: res.data };
  } catch (err) {
    deps.log.warn(`[TrainBoard] ${st.crs}: ${(err as Error)?.message ?? err}`);
    return { ok: false, stop: false };
  }
}

/**
 * Fetch one station's board (several pages if Darwin caps the rows) and store it.
 * Returns "ok", "fail" (keep the old board) or "stop" (key missing/refused, cap, backoff).
 */
export async function refreshStation(deps: TrainDeps, st: Station, now: Date = new Date()): Promise<"ok" | "fail" | "stop"> {
  const pages: TrainService[][] = [];
  const messages: string[][] = [];
  let offset: number | null = BACK_MIN;
  let calls = 0;
  while (offset !== null && calls < MAX_PAGES) {
    const window: number = Math.min(120, AHEAD_MIN - offset);
    const r = await fetchPage(deps, st, offset, window, now);
    calls++;
    if (!r.ok) {
      if (r.stop) return "stop";
      return "fail";
    }
    const parsed = parseDarwinBoard(r.body, now);
    pages.push(parsed.services);
    messages.push(parsed.messages);
    const trainsOnly = parsed.services.filter((s) => s.kind === "TRAIN");
    offset = nextOffset(trainsOnly, offset, window, DARWIN_ROW_CAP, now, AHEAD_MIN);
  }
  const board: TrainBoard = {
    crs: st.crs,
    name: st.name,
    fetchedAt: now.toISOString(),
    messages: mergeMessages(messages),
    services: mergeServices(pages),
  };
  const pipe = deps.redis.multi();
  pipe.set(keys.board(st.crs), JSON.stringify(board), "EX", KEEP_S);
  for (const s of board.services)
    pipe.set(keys.seen(st.crs, s.id), JSON.stringify({ service: s, fetchedAt: board.fetchedAt }), "EX", SEEN_S);
  await pipe.exec();
  return "ok";
}

async function due(redis: Redis, st: Station, now: Date): Promise<boolean> {
  const board = await getTrainBoard(redis, st.crs);
  if (!board) return true;
  const age = now.getTime() - Date.parse(board.fetchedAt);
  return quietHours(now) ? age >= QUIET_EVERY_MIN * 60_000 - 5_000 : age >= 50_000;
}

/** One tick: refresh every station that's due (one server at a time). */
export async function refreshTrainBoards(deps: TrainDeps, now: Date = new Date()): Promise<number> {
  if (!process.env.RAIL_DATA_API_KEY) return 0;
  if (await deps.redis.get(keys.backoff)) return 0;
  const lock = await deps.redis.set(keys.lock, "1", "EX", 55, "NX");
  if (!lock) return 0;
  let done = 0;
  try {
    for (const st of STATIONS) {
      if (!(await due(deps.redis, st, now))) continue;
      const r = await refreshStation(deps, st, now);
      if (r === "stop") break;
      if (r === "ok") done++;
    }
  } finally {
    await deps.redis.del(keys.lock).catch(() => undefined);
  }
  // Station weather (cached 30 min by the weather service; no-op without an OpenWeather key).
  await ensureWeather(
    deps.redis,
    deps.log,
    STATIONS.map((s) => ({ iata: weatherKey(s), lat: s.lat, lon: s.lon })),
    now
  ).catch(() => undefined);
  return done;
}

export function startTrainBoardRefresh(deps: TrainDeps): void {
  if (!process.env.RAIL_DATA_API_KEY) {
    deps.log.warn("[TrainBoard] RAIL_DATA_API_KEY is not set - the train times pages will show no live trains");
    return;
  }
  const tick = () =>
    refreshTrainBoards(deps).catch((err) => deps.log.warn(`[TrainBoard] refresh error: ${(err as Error)?.message ?? err}`));
  setTimeout(tick, 15_000);
  setInterval(tick, 60_000);
}
