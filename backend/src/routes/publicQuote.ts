// backend/src/routes/publicQuote.ts
//
// Website quote calculator — public, no login.
//   GET  /public/places/autocomplete?q=&session=   address suggestions (UK)
//   POST /public/quote                              { pickupPlaceId, dropoffPlaceId, date?, time?,
//                                                     passengers, bags, session? }
//   POST /public/drive-time                         { terminal, town | placeId, session? }
//                                                   driving minutes to a Gatwick terminal
//                                                   ("when to leave home" on flight pages)
// Only the website may call these: in production the Origin header must be orangeride.co.uk
// (or www). Extra origins for testing: WEB_QUOTE_EXTRA_ORIGINS="http://localhost:3100,…".
// Per-visitor limits (right-most X-Forwarded-For IP): 20 quotes / hour, 120 suggestion
// requests / hour. The global 100/min limit is off here (it keys on Railway's proxy IP, so it
// would be shared by every visitor).
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { RedisKeys } from "../plugins/redis";
import { clientIp, overHourlyLimit } from "../lib/clientIp";
import { QuoteError, autocompletePlaces, quoteTrip } from "../services/webQuote.service";
import { MAX_PASSENGERS } from "../services/webQuoteRules";
import { driveTime, TOWNS } from "../services/driveTime.service";

const QUOTES_PER_IP_PER_HOUR = 20;
const SUGGESTIONS_PER_IP_PER_HOUR = 120;
const DRIVE_TIMES_PER_IP_PER_HOUR = 30;

const SITE_ORIGINS = ["https://orangeride.co.uk", "https://www.orangeride.co.uk"];
function allowedOrigins(): string[] {
  const extra = (process.env.WEB_QUOTE_EXTRA_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...SITE_ORIGINS, ...extra];
}

const placeId = z.string().min(5).max(300).regex(/^[A-Za-z0-9_-]+$/);
const session = z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/);

const quoteSchema = z.object({
  pickupPlaceId: placeId,
  dropoffPlaceId: placeId,
  date: z.string().max(10).optional(),
  time: z.string().max(5).optional(),
  passengers: z.number().int().min(1).max(MAX_PASSENGERS),
  bags: z.number().int().min(0).max(10),
  session: session.optional(),
});

const driveSchema = z
  .object({
    terminal: z.enum(["NORTH", "SOUTH"]),
    town: z.string().max(40).optional(),
    placeId: placeId.optional(),
    session: session.optional(),
  })
  .refine((b) => !!b.town !== !!b.placeId, "town or placeId");

const suggestSchema = z.object({
  q: z.string().trim().min(3).max(100),
  session,
});

export async function publicQuoteRoutes(fastify: FastifyInstance) {
  const deps = { prisma: fastify.prisma, redis: fastify.redis, log: fastify.log };

  /** Production: only the website. Returns true if the request was refused. */
  const refuseForeignOrigin = (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (process.env.NODE_ENV !== "production") return false;
    const origin = String(request.headers.origin ?? "");
    if (allowedOrigins().includes(origin)) return false;
    reply.status(403).send({ success: false, error: "Not allowed" });
    return true;
  };

  const overLimit = async (request: FastifyRequest, name: string, max: number) => {
    const ip = clientIp(request as any);
    if (!ip) return false;
    return overHourlyLimit(fastify.redis, RedisKeys.rateLimit(`webquote:${name}:${ip}`), max);
  };

  fastify.get(
    "/public/places/autocomplete",
    { config: { rateLimit: false } },
    async (request, reply) => {
      if (refuseForeignOrigin(request, reply)) return;
      const parsed = suggestSchema.safeParse(request.query);
      if (!parsed.success) return reply.send({ success: true, data: [] });
      if (await overLimit(request, "suggest", SUGGESTIONS_PER_IP_PER_HOUR))
        return reply.status(429).send({ success: false, error: "Too many requests" });
      try {
        const list = await autocompletePlaces(deps, parsed.data.q, parsed.data.session);
        if (list === "BUSY") return reply.send({ success: true, data: [], busy: true });
        return reply.send({ success: true, data: list });
      } catch (err) {
        fastify.log.warn({ err: (err as Error).message }, "[WebQuote] autocomplete failed");
        return reply.send({ success: true, data: [] });
      }
    }
  );

  fastify.post("/public/quote", { config: { rateLimit: false } }, async (request, reply) => {
    if (refuseForeignOrigin(request, reply)) return;
    const parsed = quoteSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({ success: false, error: "Please check the trip details." });
    if (await overLimit(request, "quote", QUOTES_PER_IP_PER_HOUR))
      return reply.status(429).send({
        success: false,
        error: "You've asked for a lot of quotes. Message us on WhatsApp and we'll help.",
      });
    const b = parsed.data;
    try {
      const result = await quoteTrip(deps, {
        pickupPlaceId: b.pickupPlaceId,
        dropoffPlaceId: b.dropoffPlaceId,
        date: b.date || undefined,
        time: b.time || undefined,
        passengers: b.passengers,
        bags: b.bags,
        sessionToken: b.session,
      });
      return reply.send({ success: true, data: result });
    } catch (err) {
      if (err instanceof QuoteError)
        return reply.status(err.statusCode).send({ success: false, error: err.message });
      fastify.log.error({ err }, "[WebQuote] quote failed");
      return reply
        .status(500)
        .send({ success: false, error: "Something went wrong. Message us on WhatsApp for a quote." });
    }
  });
  fastify.post("/public/drive-time", { config: { rateLimit: false } }, async (request, reply) => {
    if (refuseForeignOrigin(request, reply)) return;
    const parsed = driveSchema.safeParse(request.body);
    if (!parsed.success || (parsed.data.town && !TOWNS[parsed.data.town]))
      return reply.status(400).send({ success: false, error: "Please choose where you're leaving from." });
    if (await overLimit(request, "drive", DRIVE_TIMES_PER_IP_PER_HOUR))
      return reply.status(429).send({ success: false, error: "Too many requests" });
    const b = parsed.data;
    try {
      const result = await driveTime(
        deps,
        b.town ? { terminal: b.terminal, town: b.town } : { terminal: b.terminal, placeId: b.placeId!, session: b.session }
      );
      return reply.send({ success: true, data: result });
    } catch (err) {
      if (err instanceof QuoteError)
        return reply.status(err.statusCode).send({ success: false, error: err.message });
      fastify.log.error({ err }, "[DriveTime] failed");
      return reply.status(500).send({ success: false, error: "Something went wrong." });
    }
  });
}
