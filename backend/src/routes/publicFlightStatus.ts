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
//                                                         date) a cached "Check flight" result
//   POST /public/flight-status/lookup { number, date }    a person pressed "Check flight":
//                                                         board first, else ONE provider lookup
//
// None of these GETs ever calls the flight provider (see flightBoard.service.ts).
// The website forwards the visitor's IP in x-visitor-ip (trusted only because the
// site key is checked first) for the per-visitor lookup limit.
import crypto from "crypto";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { RedisKeys } from "../plugins/redis";
import { overHourlyLimit } from "../lib/clientIp";
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
  findInBoard,
  matchKey,
} from "../services/flightBoardRules";

const LOOKUPS_PER_VISITOR_PER_HOUR = 10;
const BOARD_BACK_MIN = 90; // the board shows flights from 90 min ago onwards

function siteKeyOk(request: FastifyRequest): boolean | "unset" {
  const expected = process.env.FLIGHT_STATUS_SITE_KEY ?? "";
  if (!expected) return process.env.NODE_ENV === "production" ? "unset" : true;
  const got = String(request.headers["x-site-key"] ?? "");
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

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
    airline: f.airline.name,
    other: { iata: f.other.iata, name: f.other.name },
    terminal: f.lgw.terminal,
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
    return flights.map((flight) => ({ flight, view: describe(flight, now, buffers) }));
  };

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
    return reply.send({
      success: true,
      data: {
        fetchedAt: board.fetchedAt,
        stale: ageMin > staleAfterMin(),
        arrivals: rows("ARRIVAL"),
        departures: rows("DEPARTURE"),
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
    const found = board ? findInBoard(board.flights, number, date.data ?? null, now) : [];
    if (!found.length && date.data) {
      const cached = await cachedLookup(fastify.redis, number, date.data);
      if (cached)
        return reply.send({
          success: true,
          data: { status: "FOUND", source: "LOOKUP", fetchedAt: cached.fetchedAt, flights: await withViews(cached.flights, now) },
        });
    }
    if (!found.length)
      return reply.send({
        success: true,
        data: { status: "NOT_IN_BOARD", boardFrom: board?.fromLocal ?? null, boardTo: board?.toLocal ?? null },
      });
    return reply.send({
      success: true,
      data: { status: "FOUND", source: "BOARD", fetchedAt: board!.fetchedAt, flights: await withViews(found, now) },
    });
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
    if (fromBoard.length)
      return reply.send({
        success: true,
        data: { status: "FOUND", source: "BOARD", fetchedAt: board!.fetchedAt, flights: await withViews(fromBoard, now) },
      });

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
    return reply.send({
      success: true,
      data: { status: "FOUND", source: "LOOKUP", fetchedAt: r.fetchedAt, flights: await withViews(r.flights, now) },
    });
  });
}
