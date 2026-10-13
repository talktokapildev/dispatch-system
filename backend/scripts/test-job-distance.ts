// backend/scripts/test-job-distance.ts
//
// Job board distances (jobDistance.service): miles conversion, caching
// (pull-to-refresh costs no Google calls), failure caching, no driver
// location → trip only. Fake Maps + in-memory Redis: no API calls, no DB.
//
//   node --env-file=.env -r ts-node/register scripts/test-job-distance.ts
//
// Expect: every line PASS, "ALL PASS" at the end.
import { jobDistances, parseCoords } from "../src/services/jobDistance.service";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const mem = new Map<string, string>();
const redis: any = {
  get: async (k: string) => mem.get(k) ?? null,
  set: async (k: string, v: string) => (mem.set(k, v), "OK"),
};
let calls = 0;
let fail = false;
const maps: any = {
  getDirections: async () => {
    calls++;
    if (fail) throw new Error("Maps API error: OVER_QUERY_LIMIT");
    return { distanceKm: 8.53, durationMinutes: 16, polyline: "", steps: [] };
  },
};
const job = (id: string) => ({
  id,
  pickupLatitude: 51.1569,
  pickupLongitude: -0.1615,
  dropoffLatitude: 51.1091,
  dropoffLongitude: -0.1872,
});
const me = { lat: 51.1132, lng: -0.1834 };

(async () => {
  let r = await jobDistances(redis, [job("a")], me, maps);
  const d = r.get("a")!;
  check("8.53 km → 5.3 mi, 16 min (trip + to pickup)",
    d.trip?.miles === 5.3 && d.trip?.minutes === 16 && d.toPickup?.miles === 5.3 && calls === 2,
    JSON.stringify(d));

  await jobDistances(redis, [job("a")], { lat: me.lat + 0.0005, lng: me.lng }, maps);
  check("refresh with small GPS jitter → served from cache", calls === 2, `calls=${calls}`);

  await jobDistances(redis, [job("a")], { lat: me.lat + 0.05, lng: me.lng }, maps);
  check("driver moved ~5 km → only to-pickup re-fetched", calls === 3, `calls=${calls}`);

  r = await jobDistances(redis, [job("b")], null, maps);
  check("no driver location → trip only", !!r.get("b")!.trip && r.get("b")!.toPickup === null && calls === 4);

  fail = true;
  r = await jobDistances(redis, [job("c")], null, maps);
  await jobDistances(redis, [job("c")], null, maps);
  check("Maps failure → null, and not retried for 5 min",
    r.get("c")!.trip === null && calls === 5, `calls=${calls}`);
  fail = false;

  const many = Array.from({ length: 40 }, (_, i) => job(`m${i}`));
  calls = 0;
  r = await jobDistances(redis, many, null, maps);
  check("busy board capped at 30 jobs", r.size === 30 && calls === 30, `size=${r.size}`);

  check("parseCoords",
    parseCoords({ lat: "51.1", lng: "-0.18" })?.lat === 51.1 &&
    parseCoords({}) === null &&
    parseCoords({ lat: "abc", lng: "1" }) === null &&
    parseCoords({ lat: "95", lng: "1" }) === null);

  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
})();
