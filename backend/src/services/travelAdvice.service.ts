// backend/src/services/travelAdvice.service.ts
//
// UK government travel advice (FCDO) for the destinations of Gatwick departures, cached in Redis
// for the website's flight pages. Rules and the source's shape: travelAdviceRules.ts.
//
// Never fetched while a page loads. topUpTravelAdvice() runs on the flight board's 1-minute tick:
//   - the index (every country, its latest update line): once a day — ONE request
//   - each destination country on the board: its alert level and entry-requirements link, at most
//     every 12 hours, a few countries per tick (an hour's back-off after an error)
// GOV.UK's content API needs no key; at ~100 destinations that's roughly 200 small requests a day.
//
//   fcdo:index               { fetchedAt, countries: AdviceCountry[] }      (kept 3 days)
//   fcdo:country:<slug>      { fetchedAt, advice: TravelAdvice }            (kept 3 days)
//   fcdo:backoff:<slug|index>
import axios from "axios";
import Redis from "ioredis";
import {
  ADVICE_BASE,
  AdviceCountry,
  countryForCode,
  INDEX_PATH,
  parseCountry,
  parseIndex,
  TravelAdvice,
} from "./travelAdviceRules";

const KEY_INDEX = "fcdo:index";
const keyCountry = (slug: string) => `fcdo:country:${slug}`;
const keyBackoff = (what: string) => `fcdo:backoff:${what}`;
const INDEX_EVERY_MS = 24 * 3600_000;
const COUNTRY_EVERY_MS = 12 * 3600_000;
const KEEP_S = 3 * 86_400;
const BACKOFF_S = 3600;
const PER_TICK = 3;
const TIMEOUT_MS = 10_000;

type Log = { warn: (msg: string) => void };
export type Fetcher = (path: string) => Promise<unknown>;

/** GET a GOV.UK content API path; throws on anything but 200 JSON. */
export const govukGet: Fetcher = async (path) => {
  const res = await axios.get(`${ADVICE_BASE}${path}`, {
    timeout: TIMEOUT_MS,
    headers: { Accept: "application/json", "User-Agent": "OrangeRide flight pages (orangeride.co.uk)" },
    validateStatus: () => true,
  });
  if (res.status !== 200 || typeof res.data !== "object") throw new Error(`HTTP ${res.status}`);
  return res.data;
};

type StoredIndex = { fetchedAt: string; countries: AdviceCountry[] };
type StoredCountry = { fetchedAt: string; advice: TravelAdvice };

// Parsed once per index version per process (pages read it on every render).
let memo: { raw: string; index: StoredIndex } | null = null;
async function readIndex(redis: Redis): Promise<StoredIndex | null> {
  const raw = await redis.get(KEY_INDEX);
  if (!raw) return null;
  if (memo?.raw === raw) return memo.index;
  try {
    const index = JSON.parse(raw) as StoredIndex;
    if (!Array.isArray(index?.countries)) return null;
    memo = { raw, index };
    return index;
  } catch {
    return null;
  }
}

function parseStored(raw: string | null): StoredCountry | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as StoredCountry;
    return s?.advice ? s : null;
  } catch {
    return null;
  }
}

const age = (iso: string | undefined, now: Date) => (iso ? now.getTime() - Date.parse(iso) : Infinity);

/**
 * On the board tick: refresh the index when a day old, then up to PER_TICK destination countries
 * whose advice is missing or 12 hours old. `codes` = ISO alpha-2 country codes, soonest flights
 * first. Returns how many requests were made.
 */
export async function topUpTravelAdvice(
  redis: Redis,
  log: Log,
  codes: (string | null | undefined)[],
  now: Date = new Date(),
  fetcher: Fetcher = govukGet
): Promise<number> {
  let calls = 0;
  let index = await readIndex(redis);
  if (age(index?.fetchedAt, now) >= INDEX_EVERY_MS && !(await redis.get(keyBackoff("index")))) {
    calls++;
    try {
      const countries = parseIndex(await fetcher(INDEX_PATH));
      if (countries.length < 50) throw new Error(`only ${countries.length} countries in the index`);
      index = { fetchedAt: now.toISOString(), countries };
      await redis.set(KEY_INDEX, JSON.stringify(index), "EX", KEEP_S);
    } catch (err) {
      await redis.set(keyBackoff("index"), "1", "EX", BACKOFF_S);
      log.warn(`[TravelAdvice] index refresh failed: ${(err as Error)?.message ?? err}`);
    }
  }
  if (!index) return calls;

  const seen = new Set<string>();
  for (const code of codes) {
    if (calls >= PER_TICK) break;
    const c = countryForCode(code, index.countries);
    if (!c || seen.has(c.slug)) continue;
    seen.add(c.slug);
    const stored = parseStored(await redis.get(keyCountry(c.slug)));
    if (age(stored?.fetchedAt, now) < COUNTRY_EVERY_MS) continue;
    if (await redis.get(keyBackoff(c.slug))) continue;
    calls++;
    try {
      const advice = parseCountry(await fetcher(`${INDEX_PATH}/${c.slug}`), c);
      await redis.set(keyCountry(c.slug), JSON.stringify({ fetchedAt: now.toISOString(), advice }), "EX", KEEP_S);
    } catch (err) {
      await redis.set(keyBackoff(c.slug), "1", "EX", BACKOFF_S);
      log.warn(`[TravelAdvice] ${c.slug} refresh failed: ${(err as Error)?.message ?? err}`);
    }
  }
  return calls;
}

/** For a flight page: the destination's advice, if cached (never fetches). */
export async function readTravelAdvice(redis: Redis, code: string | null | undefined): Promise<TravelAdvice | null> {
  const index = await readIndex(redis);
  const c = index ? countryForCode(code, index.countries) : null;
  if (!c) return null;
  return parseStored(await redis.get(keyCountry(c.slug)))?.advice ?? null;
}
