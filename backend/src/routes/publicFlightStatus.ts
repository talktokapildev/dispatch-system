// backend/src/routes/publicFlightStatus.ts
//
// Website flight status page — read by the WEBSITE SERVER only (Next.js renders the
// pages on the server, including the browser's 60-second refresh; "Check flight" goes
// through the website's /api/flight-status/lookup route).
// Every request must carry the header  x-site-key: <FLIGHT_STATUS_SITE_KEY>.
// Production refuses everything while that variable is unset.
//
//   GET  /public/flight-status/board                      Gatwick arrivals + departures (cached)
//   GET  /public/flight-status/flight/:number?date=       one flight: the cached board, else (with a
//                                                         date) a cached "Check flight" result, else
//                                                         what we remember from the last 7 days (SEEN)
//   GET  /public/flight-status/sitemap                    flight page numbers seen in the last 7 days,
//                                                         and airlines with their own terminal page
//   GET  /public/flight-status/terminals                  which terminal each airline uses (last 7 days)
//   GET  /public/flight-status/terminals/:slug            one airline: its terminal + its flights on the board
//   GET  /public/flight-status/delays                     Gatwick punctuality (CAA): overall, by month, UK airports
//   POST /public/flight-status/lookup { number, date }    a person pressed "Check flight":
//                                                         board first, else ONE provider lookup
//
// Flight and airline replies also carry CAA punctuality figures (`punctuality`, from the
// caa:summary Redis key; see caaPunctuality.service.ts) — null when we have none. Flight replies
// also carry `rights` (UK delay/cancellation rights, passengerRightsRules.ts; null when not
// relevant) and, for departures, `travelAdvice` (FCDO, travelAdvice.service.ts; cached only).
//
// None of these GETs ever calls the flight provider (see flightBoard.service.ts).
// The website forwards the visitor's IP in x-visitor-ip (trusted only because the
// site key is checked first) for the per-visitor lookup limit.
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { RedisKeys } from "../plugins/redis";
import { overHourlyLimit } from "../lib/clientIp";
import { siteKeyOk } from "../lib/siteKey";
import {
  BoardDeps,
  boardBuffers,
  cachedLookup,
  getBoard,
  lookupFlight,
} from "../services/flightBoard.service";
import {
  BoardFlight,
  boardList,
  describe,
  displayNumberFor,
  findInBoard,
  matchKey,
} from "../services/flightBoardRules";
import { readWeather } from "../services/weather.service";
import { listSeen, readSeen } from "../services/flightSeen.service";
import { getTerminalSummary } from "../services/airlineTerminals.service";
import { airlineSlug } from "../services/airlineTerminalRules";
import { pickForecast, readForecasts, wantsForecast } from "../services/forecast.service";
import { readReturns } from "../services/returnFlights.service";
import { getCaaSummary } from "../services/caaPunctuality.service";
import { passengerRights } from "../services/passengerRightsRules";
import { readTravelAdvice } from "../services/travelAdvice.service";
import { airlineScores, airlineStats, gatwickDelays, routeStats } from "../services/caaPunctualityRules";

const LOOKUPS_PER_VISITOR_PER_HOUR = 10;
const BOARD_BACK_MIN = 90; // the board shows flights from 90 min ago onwards

const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();
const lookupSchema = z.object({
  number: z.string().trim().min(3).max(12),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Compact row for the board list (the full flight is on its own page). */
function boardRow(f: BoardFlight, now: Date, buffers: { hand: number; checked: number }) {
  const v = describe(f, now, buffers);
  return {
    id: f.id,
    number: f.number,
    displayNumber: f.displayNumber ?? displayNumberFor(f.number, f.airline.iata),
    airline: f.airline.name,
    airlineIata: f.airline.iata,
    other: { iata: f.other.iata, name: f.other.name, countryCode: f.other.countryCode ?? null },
    terminal: f.lgw.terminal,
    terminalInferred: f.lgw.terminalInferred ?? false,
    gate: f.lgw.gate,
    baggageBelt: f.lgw.baggageBelt,
    view: {
      state: v.state,
      tone: v.tone,
      scheduledAt: v.scheduledAt,
      expectedAt: v.expectedAt,
      delayMin: v.delayMin,
      landsAt: v.landsAt,
      landed: v.landed,
      departedAt: v.departedAt,
    },
  };
}

function staleAfterMin(): number {
  const n = Number(process.env.FLIGHT_BOARD_REFRESH_MIN);
  const interval = Number.isFinite(n) && n >= 5 ? n : 30;
  return Math.max(interval * 2 + 5, 65); // night refreshes are hourly
}

export async function publicFlightStatusRoutes(fastify: FastifyInstance) {
  const deps: BoardDeps = { redis: fastify.redis, prisma: fastify.prisma, log: fastify.log };

  const refuse = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const ok = siteKeyOk(request);
    if (ok === true) return false;
    if (ok === "unset") {
      fastify.log.warn("[FlightBoard] FLIGHT_STATUS_SITE_KEY is not set - refusing requests");
      reply.status(503).send({ success: false, error: "Not available" });
    } else reply.status(403).send({ success: false, error: "Not allowed" });
    return true;
  };

  const withViews = async (flights: BoardFlight[], now: Date) => {
    const buffers = await boardBuffers(deps);
    const forecasts = await readForecasts(fastify.redis, ["LGW", ...flights.map((f) => f.other.iata)]);
    const caa = await getCaaSummary(fastify.redis);
    return Promise.all(
      flights.map(async (flight) => {
        const view = describe(flight, now, buffers);
        const slug = airlineSlug(flight.airline);
        // Forecasts for the moments that matter: at Gatwick when you need to be there (departures)
        // or when it lands (arrivals); at the destination when a departure lands there.
        const lgwAt = flight.direction === "DEPARTURE" ? view.beThereBy : view.expectedAt;
        const otherAt = flight.direction === "DEPARTURE" ? flight.other.revisedUtc ?? flight.other.scheduledUtc : null;
        const cancelled = ["CANCELLED", "MAYBE_CANCELLED", "DIVERTED"].includes(view.state);
        const forecast = cancelled
          ? null
          : {
              lgwAt,
              lgw: wantsForecast(lgwAt, now) ? pickForecast(forecasts.LGW, lgwAt) : null,
              otherAt,
              other:
                flight.other.iata && wantsForecast(otherAt, now)
                  ? pickForecast(forecasts[flight.other.iata.toUpperCase()], otherAt)
                  : null,
            };
        // Departures: flights from the destination that landed at Gatwick this week (same airline first).
        const returns =
          flight.direction === "DEPARTURE" && !cancelled ? await readReturns(fastify.redis, flight.other.iata, slug, now) : [];
        return {
          flight: {
            ...flight,
            displayNumber: flight.displayNumber ?? displayNumberFor(flight.number, flight.airline.iata),
            airlineSlug: slug, // its /gatwick/terminals/<slug> page
          },
          view,
          forecast,
          returns,
          // CAA route figures for the OPERATING airline (codeshares: none, the operator differs).
          punctuality:
            flight.codeshare === "CODESHARE"
              ? null
              : routeStats(caa, flight.direction, flight.other.iata, slug, flight.lgw.scheduledUtc),
          rights: passengerRights(flight, view),
          travelAdvice: flight.direction === "DEPARTURE" ? await readTravelAdvice(fastify.redis, flight.other.countryCode) : null,
        };
      })
    );
  };

  /** FOUND reply for a flight page, with cached weather at both ends (never fetched here). */
  const found = async (source: "BOARD" | "LOOKUP", fetchedAt: string, flights: BoardFlight[], now: Date) => ({
    status: "FOUND",
    source,
    fetchedAt,
    flights: await withViews(flights, now),
    weather: await readWeather(fastify.redis, ["LGW", ...flights.map((f) => f.other.iata)]),
  });

  fastify.get("/public/flight-status/board", { config: { rateLimit: false } }, async (request, reply) => {
    if (refuse(request, reply)) return;
    const now = new Date();
    const board = await getBoard(fastify.redis);
    if (!board) return reply.send({ success: true, data: { fetchedAt: null, stale: true, arrivals: [], departures: [] } });
    const buffers = await boardBuffers(deps);
    const from = now.getTime() - BOARD_BACK_MIN * 60_000;
    const rows = (dir: "ARRIVAL" | "DEPARTURE") =>
      boardList(board.flights, dir)
        .filter((f) => Date.parse(f.lgw.scheduledUtc) >= from)
        .map((f) => boardRow(f, now, buffers));
    const ageMin = (now.getTime() - Date.parse(board.fetchedAt)) / 60_000;
    const arrivals = rows("ARRIVAL");
    const departures = rows("DEPARTURE");
    return reply.send({
      success: true,
      data: {
        fetchedAt: board.fetchedAt,
        stale: ageMin > staleAfterMin(),
        arrivals,
        departures,
        // Cached weather by airport code (LGW = Gatwick itself). Missing airports are left out.
        weather: await readWeather(fastify.redis, ["LGW", ...[...arrivals, ...departures].map((r) => r.other.iata)]),
      },
    });
  });

  fastify.get("/public/flight-status/flight/:number", { config: { rateLimit: false } }, async (request, reply) => {
    if (refuse(request, reply)) return;
    const number = String((request.params as { number?: string }).number ?? "");
    const date = dateParam.safeParse((request.query as { date?: string }).date);
    if (!matchKey(number) || !date.success)
      return reply.send({ success: true, data: { status: "INVALID" } });
    const now = new Date();
    const board = await getBoard(fastify.redis);
    const inBoard = board ? findInBoard(board.flights, number, date.data ?? null, now) : [];
    if (!inBoard.length && date.data) {
      const cached = await cachedLookup(fastify.redis, number, date.data);
      if (cached) return reply.send({ success: true, data: await found("LOOKUP", cached.fetchedAt, cached.flights, now) });
    }
    if (!inBoard.length) {
      // Not live right now: what we remember about this flight from the last 7 days, if anything.
      const seen = await readSeen(fastify.redis, number);
      const caa = seen.length ? await getCaaSummary(fastify.redis) : null;
      if (seen.length)
        return reply.send({
          success: true,
          data: {
            status: "SEEN",
            seen: await Promise.all(
              seen.map(async (s) => {
                const slug = airlineSlug(s.airline);
                return {
                  ...s,
                  airlineSlug: slug,
                  // Month of the flight's next likely date isn't known: use today's.
                  punctuality: routeStats(caa, s.direction, s.other.iata, slug, now.toISOString()),
                  travelAdvice: s.direction === "DEPARTURE" ? await readTravelAdvice(fastify.redis, s.other.countryCode) : null,
                };
              })
            ),
            boardFrom: board?.fromLocal ?? null,
            boardTo: board?.toLocal ?? null,
            weather: await readWeather(fastify.redis, ["LGW", ...seen.map((s) => s.other.iata)]),
          },
        });
      return reply.send({
        success: true,
        data: { status: "NOT_IN_BOARD", boardFrom: board?.fromLocal ?? null, boardTo: board?.toLocal ?? null },
      });
    }
    return reply.send({ success: true, data: await found("BOARD", board!.fetchedAt, inBoard, now) });
  });

  // Flight page numbers seen in the last 7 days, for the website's sitemap.
  fastify.get("/public/flight-status/sitemap", { config: { rateLimit: false } }, async (request, reply) => {
    if (refuse(request, reply)) return;
    const terminals = await getTerminalSummary(fastify.redis);
    return reply.send({
      success: true,
      data: {
        numbers: await listSeen(fastify.redis),
        airlines: (terminals?.airlines ?? []).filter((a) => a.hasPage).map((a) => a.slug),
      },
    });
  });

  // Which terminal each airline uses, from the board's last 7 days (Redis only).
  fastify.get("/public/flight-status/terminals", { config: { rateLimit: false } }, async (request, reply) => {
    if (refuse(request, reply)) return;
    const summary = await getTerminalSummary(fastify.redis);
    return reply.send({
      success: true,
      data: {
        ...(summary ?? { updatedAt: null, airlines: [] }),
        // CAA on-time figures by airline slug (ranked on the hub from `minFlights` flights), or null.
        punctuality: airlineScores(await getCaaSummary(fastify.redis)),
      },
    });
  });

  // One airline's page: its terminal, and its flights on the live board (arrivals and departures).
  fastify.get("/public/flight-status/terminals/:slug", { config: { rateLimit: false } }, async (request, reply) => {
    if (refuse(request, reply)) return;
    const slug = String((request.params as { slug?: string }).slug ?? "").toLowerCase();
    if (!/^[a-z0-9-]{1,60}$/.test(slug)) return reply.send({ success: true, data: { status: "NOT_FOUND" } });
    const summary = await getTerminalSummary(fastify.redis);
    const airline = summary?.airlines.find((a) => a.slug === slug);
    if (!summary || !airline) return reply.send({ success: true, data: { status: "NOT_FOUND" } });

    const now = new Date();
    const board = await getBoard(fastify.redis);
    const fresh = !!board && (now.getTime() - Date.parse(board.fetchedAt)) / 60_000 <= staleAfterMin();
    const buffers = await boardBuffers(deps);
    const from = now.getTime() - BOARD_BACK_MIN * 60_000;
    const rows = (dir: "ARRIVAL" | "DEPARTURE") =>
      fresh
        ? boardList(board!.flights, dir)
            .filter((f) => airlineSlug(f.airline) === slug && Date.parse(f.lgw.scheduledUtc) >= from)
            .map((f) => boardRow(f, now, buffers))
        : [];
    const arrivals = rows("ARRIVAL");
    const departures = rows("DEPARTURE");
    // Other airlines with their own page at the same terminal (links between the pages).
    const sameTerminal =
      airline.terminal === "NORTH" || airline.terminal === "SOUTH"
        ? summary.airlines
            .filter((a) => a.slug !== slug && a.hasPage && a.terminal === airline.terminal)
            .slice(0, 12)
            .map((a) => ({ slug: a.slug, name: a.name }))
        : [];
    return reply.send({
      success: true,
      data: {
        status: "FOUND",
        updatedAt: summary.updatedAt,
        airline,
        board: {
          fetchedAt: fresh ? board!.fetchedAt : null,
          stale: !fresh,
          arrivals,
          departures,
          weather: fresh
            ? await readWeather(fastify.redis, ["LGW", ...[...arrivals, ...departures].map((r) => r.other.iata)])
            : await readWeather(fastify.redis, ["LGW"]),
        },
        sameTerminal,
        // CAA figures for this airline at Gatwick (latest 12 months), or null.
        punctuality: airlineStats(await getCaaSummary(fastify.redis), slug),
      },
    });
  });

  // Gatwick punctuality page (/gatwick/delays): CAA figures only, Redis only.
  fastify.get("/public/flight-status/delays", { config: { rateLimit: false } }, async (request, reply) => {
    if (refuse(request, reply)) return;
    const d = gatwickDelays(await getCaaSummary(fastify.redis));
    return reply.send({ success: true, data: d ? { status: "FOUND", ...d } : { status: "NONE" } });
  });

  fastify.post("/public/flight-status/lookup", { config: { rateLimit: false } }, async (request, reply) => {
    if (refuse(request, reply)) return;
    const parsed = lookupSchema.safeParse(request.body);
    if (!parsed.success || !matchKey(parsed.data.number))
      return reply.send({ success: true, data: { status: "INVALID" } });
    const { number, date } = parsed.data;
    const now = new Date();

    // The board first: free, and fresher than a cached lookup.
    const board = await getBoard(fastify.redis);
    const fromBoard = board ? findInBoard(board.flights, number, date, now) : [];
    if (fromBoard.length) return reply.send({ success: true, data: await found("BOARD", board!.fetchedAt, fromBoard, now) });

    const visitor = String(request.headers["x-visitor-ip"] ?? "").trim().slice(0, 64);
    if (
      visitor &&
      (await overHourlyLimit(
        fastify.redis,
        RedisKeys.rateLimit(`flightstatus:lookup:${visitor}`),
        LOOKUPS_PER_VISITOR_PER_HOUR
      ))
    )
      return reply.status(429).send({ success: false, error: "Too many checks. Please try again later." });

    const r = await lookupFlight(deps, number, date, now);
    if (r.status !== "FOUND") return reply.send({ success: true, data: { status: r.status } });
    return reply.send({ success: true, data: await found("LOOKUP", r.fetchedAt, r.flights, now) });
  });
}
