// backend/src/routes/openaiWebhooks.ts
//
// POST /webhooks/openai/realtime — OpenAI tells us a phone call has arrived for Araa
// (event `realtime.call.incoming`; see services/voiceAgent.service.ts).
//
// Registered WITHOUT the /api/v1 prefix (provider callback), rate limit off.
// The body is kept raw (scoped to this plugin) because the signature covers the exact bytes.
// Security: every request must carry a valid OpenAI webhook signature (OPENAI_WEBHOOK_SECRET).
// Invalid → 400. Valid → 200 straight away; the call is accepted in the background.
// Not configured (no OPENAI_API_KEY / OPENAI_WEBHOOK_SECRET) → 503, nothing else is affected.
import { FastifyInstance } from "fastify";
import OpenAI from "openai";
import WebSocket from "ws";
import { handleIncomingCall, type VoiceDeps } from "../services/voiceAgent.service";

export const OPENAI_REALTIME_WEBHOOK_PATH = "/webhooks/openai/realtime";

export async function openaiWebhookRoutes(fastify: FastifyInstance) {
  fastify.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));

  let client: OpenAI | null = null;
  const openai = () => {
    if (client) return client;
    const { OPENAI_API_KEY, OPENAI_WEBHOOK_SECRET } = process.env;
    if (!OPENAI_API_KEY || !OPENAI_WEBHOOK_SECRET) return null;
    client = new OpenAI({ apiKey: OPENAI_API_KEY, webhookSecret: OPENAI_WEBHOOK_SECRET });
    return client;
  };

  fastify.post(
    OPENAI_REALTIME_WEBHOOK_PATH,
    { bodyLimit: 256 * 1024, config: { rateLimit: false } },
    async (request, reply) => {
      const oa = openai();
      if (!oa) return reply.status(503).send({ error: "Voice agent not configured" });

      let event: Awaited<ReturnType<OpenAI["webhooks"]["unwrap"]>>;
      try {
        event = await oa.webhooks.unwrap(String(request.body ?? ""), request.headers as Record<string, string>);
      } catch {
        fastify.log.warn("[Araa] webhook rejected: bad signature");
        return reply.status(400).send();
      }
      reply.status(200).send();

      if (event.type !== "realtime.call.incoming") return;
      const deps: VoiceDeps = {
        prisma: fastify.prisma,
        redis: fastify.redis,
        log: fastify.log,
        io: fastify.io as any,
        calls: {
          accept: (id, body) => oa.realtime.calls.accept(id, body as any),
          reject: (id, body) => oa.realtime.calls.reject(id, (body ?? {}) as any),
          hangup: (id) => oa.realtime.calls.hangup(id),
        },
        connect: (id) =>
          new WebSocket(`wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(id)}`, {
            headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          }) as any,
      };
      setImmediate(() =>
        handleIncomingCall(deps, event.data as any).catch((err) =>
          fastify.log.error({ err: err?.message }, "[Araa] incoming call failed")
        )
      );
    }
  );
}
