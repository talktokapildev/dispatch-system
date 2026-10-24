// backend/src/routes/publicTrainTimes.ts
//
// Website live train times pages — read by the WEBSITE SERVER only, with the same
// x-site-key header as the flight status routes. Never calls National Rail (see
// trainBoard.service.ts): everything comes from the cached boards in Redis.
//
//   GET /public/train-times/:station/board          the station's next two hours (+ last 30 min)
//   GET /public/train-times/:station/train/:id      one train: live board, else the last copy
//                                                   we saw (kept 6 hours)
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { siteKeyOk } from "../lib/siteKey";
import { getSeenService, getTrainBoard } from "../services/trainBoard.service";
import { stationBySlug, weatherKey } from "../services/trainBoardRules";
import { readWeather } from "../services/weather.service";

const STALE_AFTER_MIN = 10; // quiet-hours refreshes are every 15 min: allowed for below
const QUIET_STALE_AFTER_MIN = 35;

export async function publicTrainTimesRoutes(fastify: FastifyInstance) {
  const refuse = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const ok = siteKeyOk(request);
    if (ok === true) return false;
    if (ok === "unset") reply.status(503).send({ success: false, error: "Not available" });
    else reply.status(403).send({ success: false, error: "Not allowed" });
    return true;
  };

  const stationOf = (request: FastifyRequest) => stationBySlug(String((request.params as { station?: string }).station ?? ""));
  const stationInfo = (s: NonNullable<ReturnType<typeof stationBySlug>>) => ({ slug: s.slug, crs: s.crs, name: s.name, town: s.town });

  fastify.get("/public/train-times/:station/board", { config: { rateLimit: false } }, async (request, reply) => {
    if (refuse(request, reply)) return;
    const st = stationOf(request);
    if (!st) return reply.status(404).send({ success: false, error: "Unknown station" });
    const now = new Date();
    const board = await getTrainBoard(fastify.redis, st.crs);
    const weather = (await readWeather(fastify.redis, [weatherKey(st)]))[weatherKey(st)] ?? null;
    if (!board)
      return reply.send({
        success: true,
        data: { station: stationInfo(st), fetchedAt: null, stale: true, messages: [], services: [], weather },
      });
    const ageMin = (now.getTime() - Date.parse(board.fetchedAt)) / 60_000;
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(now));
    const limit = hour >= 1 && hour < 5 ? QUIET_STALE_AFTER_MIN : STALE_AFTER_MIN;
    return reply.send({
      success: true,
      data: {
        station: stationInfo(st),
        fetchedAt: board.fetchedAt,
        stale: ageMin > limit,
        messages: board.messages,
        services: board.services,
        weather,
      },
    });
  });

  fastify.get("/public/train-times/:station/train/:id", { config: { rateLimit: false } }, async (request, reply) => {
    if (refuse(request, reply)) return;
    const st = stationOf(request);
    if (!st) return reply.status(404).send({ success: false, error: "Unknown station" });
    const id = String((request.params as { id?: string }).id ?? "").slice(0, 80);
    if (!id) return reply.send({ success: true, data: { status: "NOT_FOUND", station: stationInfo(st) } });
    const board = await getTrainBoard(fastify.redis, st.crs);
    const live = board?.services.find((s) => s.id === id);
    if (live)
      return reply.send({
        success: true,
        data: { status: "FOUND", live: true, fetchedAt: board!.fetchedAt, service: live, messages: board!.messages, station: stationInfo(st) },
      });
    const seen = await getSeenService(fastify.redis, st.crs, id);
    if (seen)
      return reply.send({
        success: true,
        data: { status: "FOUND", live: false, fetchedAt: seen.fetchedAt, service: seen.service, messages: [], station: stationInfo(st) },
      });
    return reply.send({ success: true, data: { status: "NOT_FOUND", station: stationInfo(st) } });
  });
}
