// backend/scripts/test-web-quote.ts
//
// Website quote calculator: pure rules + quote flow with fake Google / Redis / database
// (no network, no database, no Redis needed).
//   node -r ts-node/register scripts/test-web-quote.ts
import {
  checkPickupTime,
  defaultPricingTime,
  fromPrice,
  isQuoteRef,
  londonWallClockToUtc,
  makeQuoteRef,
  nearGatwick,
} from "../src/services/webQuoteRules";
import { DIRECTIONS_DAILY_CAP, QuoteError, quoteTrip } from "../src/services/webQuote.service";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail !== undefined ? "  → " + JSON.stringify(detail) : ""}`);
}

(async () => {
  // ── Rules ──
  check("fromPrice rounds down", fromPrice(43.99) === 43 && fromPrice(43) === 43 && fromPrice(10) === 10);
  check("ref format", isQuoteRef(makeQuoteRef()) && !isQuoteRef("Q-0O1I") && !isQuoteRef("Q-ABC"));
  check("ref uses the full alphabet ends", makeQuoteRef(() => 0) === "Q-2222" && makeQuoteRef(() => 0.9999) === "Q-ZZZZ");

  const summer = londonWallClockToUtc("2026-07-01", "05:30")!;
  check("summer UK 05:30 = 04:30Z", summer.toISOString() === "2026-07-01T04:30:00.000Z", summer);
  const winter = londonWallClockToUtc("2026-12-01", "05:30")!;
  check("winter UK 05:30 = 05:30Z", winter.toISOString() === "2026-12-01T05:30:00.000Z", winter);
  const dstEnd = londonWallClockToUtc("2026-10-25", "12:00")!;
  check("clocks-go-back day, midday = 12:00Z", dstEnd.toISOString() === "2026-10-25T12:00:00.000Z", dstEnd);
  check("31 Feb is invalid", londonWallClockToUtc("2026-02-31", "10:00") === null);
  check("25:00 is invalid", londonWallClockToUtc("2026-11-01", "25:00") === null);

  const now = new Date("2026-10-22T21:00:00Z"); // Thu 22 Oct, 22:00 UK
  const t0 = checkPickupTime(undefined, undefined, now);
  check("no time is fine", t0.ok && t0.pickupAt === null && !t0.tooSoon);
  const t1 = checkPickupTime("2026-10-23", "", now);
  check("date without time → error", !t1.ok);
  const t2 = checkPickupTime("2026-10-22", "20:00", now);
  check("past time → error", !t2.ok);
  const t3 = checkPickupTime("2026-10-23", "09:00", now);
  check("tomorrow 09:00 (11h away) → too soon", t3.ok && t3.tooSoon);
  const t4 = checkPickupTime("2026-10-24", "09:00", now);
  check("Sat 09:00 (35h away) → fine", t4.ok && !t4.tooSoon && t4.pickupAt?.toISOString() === "2026-10-24T08:00:00.000Z");
  const t5 = checkPickupTime("2028-01-01", "09:00", now);
  check("more than a year ahead → error", !t5.ok);

  check(
    "default pricing time = midday tomorrow UK",
    defaultPricingTime(now).toISOString() === "2026-10-23T11:00:00.000Z",
    defaultPricingTime(now)
  );
  // 00:30 UK on 1 Jul (still 30 Jun in UTC) counts from the UK date
  check(
    "default uses the UK date",
    defaultPricingTime(new Date("2026-06-30T23:30:00Z")).toISOString() === "2026-07-02T11:00:00.000Z"
  );

  const horsham = { lat: 51.0629, lng: -0.3259 };
  const crawley = { lat: 51.1092, lng: -0.1872 };
  const manchester = { lat: 53.4808, lng: -2.2426 };
  const leeds = { lat: 53.8008, lng: -1.5491 };
  check("Horsham → Crawley is local", nearGatwick(horsham, crawley));
  check("Gatwick area → Manchester counts (one end local)", nearGatwick(crawley, manchester));
  check("Manchester → Leeds is out of area", !nearGatwick(manchester, leeds));

  // ── Quote flow with fakes ──
  const places: Record<string, { address: string; latitude: number; longitude: number }> = {
    HORSHAM_STN: { address: "Horsham Station, Horsham RH13 5JA, UK", latitude: horsham.lat, longitude: horsham.lng },
    LGW_SOUTH: { address: "Gatwick South Terminal, Horley RH6 0NP, UK", latitude: 51.1564, longitude: -0.1611 },
    MANCHESTER: { address: "Manchester, UK", latitude: manchester.lat, longitude: manchester.lng },
    LEEDS: { address: "Leeds, UK", latitude: leeds.lat, longitude: leeds.lng },
  };
  const calls = { details: 0, directions: 0 };
  const routes: Record<string, { distanceKm: number; durationMinutes: number }> = {
    [`${horsham.lat}`]: { distanceKm: 21.4, durationMinutes: 26 },
    [`${51.1564}`]: { distanceKm: 340, durationMinutes: 280 },
  };
  const maps = {
    async getPlaceDetails(id: string) {
      calls.details++;
      const p = places[id];
      if (!p) throw new Error("NOT_FOUND");
      return { ...p, placeId: id };
    },
    async getDirections(a: { lat: number }) {
      calls.directions++;
      const r = routes[`${a.lat}`];
      return { ...r, polyline: "", steps: [] };
    },
    async autocomplete() {
      return [];
    },
  };
  const store = new Map<string, string>();
  const redis: any = {
    async get(k: string) {
      return store.get(k) ?? null;
    },
    async set(k: string, v: string) {
      store.set(k, v);
      return "OK";
    },
    async incr(k: string) {
      const n = Number(store.get(k) ?? 0) + 1;
      store.set(k, String(n));
      return n;
    },
    async expire() {
      return 1;
    },
  };
  const rows: any[] = [];
  const prisma: any = {
    webQuote: {
      async create({ data }: any) {
        if (rows.some((r) => r.ref === data.ref)) throw Object.assign(new Error("dup"), { code: "P2002" });
        rows.push(data);
        return data;
      },
    },
  };
  const priced: any[] = [];
  // Fake pricing: £2/mile + £0.20/min + £10 Gatwick; 25% premium at night or on 23 Oct (a "holiday")
  const pricing = {
    async estimateFare(i: any) {
      priced.push(i);
      const ukHour = Number(
        new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(i.scheduledAt)
      );
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(i.scheduledAt);
      const sub = 2 + i.distanceMiles * 2 + i.durationMinutes * 0.2;
      const night = ukHour >= 23 || ukHour < 6;
      const holiday = day === "2026-10-23";
      const prem = night || holiday ? sub * 0.25 : 0;
      return {
        total: Math.round((sub + prem + 10) * 100) / 100,
        timePremiumAmount: prem,
        timePremiumLabel: night ? "Night rate premium (25%)" : holiday ? "Bank holiday premium (25%)" : "",
      } as any;
    },
  };
  const deps = { prisma, redis, maps, pricing, now: () => now };
  const base = { pickupPlaceId: "HORSHAM_STN", dropoffPlaceId: "LGW_SOUTH", passengers: 2, bags: 2 };

  const q1 = await quoteTrip(deps as any, base);
  check("quoted", q1.status === "QUOTED", q1);
  if (q1.status === "QUOTED") {
    check("ref returned and stored", isQuoteRef(q1.ref) && rows[0]?.ref === q1.ref);
    check("miles 1 dp", q1.miles === 13.3, q1.miles);
    check("pricing got UNROUNDED miles", Math.abs(priced[0].distanceMiles - 21.4 * 0.621371) < 1e-9);
    check("pricing got coordinates", priced[0].pickupLatitude === horsham.lat && priced[0].dropoffLongitude === -0.1611);
    check(
      "no time: skipped the 'holiday' tomorrow → Sat midday",
      priced[priced.length - 1].scheduledAt.toISOString() === "2026-10-24T11:00:00.000Z" && priced.length === 2
    );
    const expected = Math.floor(2 + 21.4 * 0.621371 * 2 + 26 * 0.2 + 10);
    check("from price = everyday price, rounded down", q1.fromPrice === expected, { got: q1.fromPrice, expected });
    check("no premium label without a chosen time", q1.premiumLabel === null && q1.pickupAt === null && !q1.tooSoon);
    check("row has no name/phone, has route + price", rows[0].fromPrice === expected && rows[0].status === "QUOTED" && !("phone" in rows[0]));
  }
  check("one Directions call", calls.directions === 1);

  const q2 = await quoteTrip(deps as any, { ...base, date: "2026-10-24", time: "23:30" });
  check("second quote reuses cached route + places", calls.directions === 1 && calls.details === 2);
  check(
    "chosen night time → premium label",
    q2.status === "QUOTED" && q2.premiumLabel === "Night rate premium (25%)" && q2.pickupAt === "2026-10-24T22:30:00.000Z",
    q2
  );
  check("night costs more", q1.status === "QUOTED" && q2.status === "QUOTED" && q2.fromPrice > q1.fromPrice);

  const q3 = await quoteTrip(deps as any, { ...base, date: "2026-10-23", time: "15:00" });
  check("17h away → tooSoon but still priced", q3.status === "QUOTED" && q3.tooSoon);

  const before = calls.directions;
  const q4 = await quoteTrip(deps as any, { ...base, pickupPlaceId: "MANCHESTER", dropoffPlaceId: "LEEDS" });
  check("Manchester → Leeds: OUT_OF_AREA, stored, no Directions call", q4.status === "OUT_OF_AREA" && calls.directions === before && rows[rows.length - 1].status === "OUT_OF_AREA");

  const q5 = await quoteTrip(deps as any, { ...base, pickupPlaceId: "LGW_SOUTH", dropoffPlaceId: "MANCHESTER" });
  check("Gatwick → Manchester (211 mi): OUT_OF_AREA after route", q5.status === "OUT_OF_AREA" && rows[rows.length - 1].miles === 211.3, rows[rows.length - 1]);

  const err = async (name: string, input: any, re: RegExp) => {
    try {
      await quoteTrip(deps as any, input);
      check(name, false, "no error");
    } catch (e) {
      check(name, e instanceof QuoteError && re.test((e as Error).message), (e as Error).message);
    }
  };
  await err("same place → error", { ...base, dropoffPlaceId: "HORSHAM_STN" }, /same place/);
  await err("unknown place → error", { ...base, dropoffPlaceId: "NOPE_NOPE" }, /couldn't find that address/);
  await err("past time → error", { ...base, date: "2026-10-01", time: "10:00" }, /passed/);

  // Daily cap: pretend today's Directions count is at the cap; a NEW route → BUSY
  store.set("webquote:cap:directions:2026-10-22", String(DIRECTIONS_DAILY_CAP));
  places.LGW_NORTH = { address: "Gatwick North Terminal, UK", latitude: 51.162, longitude: -0.1773 };
  const rowsBefore = rows.length;
  const q6 = await quoteTrip(deps as any, { ...base, dropoffPlaceId: "LGW_NORTH" });
  check("over the daily cap → BUSY, nothing stored", q6.status === "BUSY" && rows.length === rowsBefore, q6);
  const q7 = await quoteTrip(deps as any, base);
  check("cached route still quotes when capped", q7.status === "QUOTED");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
