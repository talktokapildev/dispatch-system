// backend/src/routes/flightWebhooks.ts
//
// POST /webhooks/flights/:secret  — AeroDataBox Flight Alert notifications.
//
// Validate the secret, redact (the payload echoes our callback URL, which
// contains the secret), de-dupe by notification id, store, reply 200 —
// then process in the background (step 5b, flightWebhookProcessor).
// Registered WITHOUT the /api/v1 prefix (it's a provider callback).
// AeroDataBox doesn't sign notifications, so the secret in the URL is the guard.
import { FastifyInstance } from "fastify";
import {
  isValidWebhookSecret,
  redactNotification,
  summariseNotification,
  LOW_BALANCE_CREDITS,
} from "../services/flightAlerts.service";
import { processFlightNotification } from "../services/flightWebhookProcessor.service";

const SEEN_TTL_S = 2 * 24 * 3600; // duplicates arrive within seconds; 2 days is plenty

export async function flightWebhookRoutes(fastify: FastifyInstance) {
  // Accept any content type here (scoped to this plugin): if the provider
  // doesn't send application/json we still want to keep what it sent.
  fastify.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) =>
    done(null, body)
  );

  fastify.post<{ Params: { secret: string } }>(
    "/webhooks/flights/:secret",
    {
      bodyLimit: 5 * 1024 * 1024,
      config: { rateLimit: false },
    },
    async (request, reply) => {
      if (!isValidWebhookSecret(request.params.secret)) {
        return reply.status(404).send(); // look like any unknown URL
      }

      let body: unknown = request.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          // not JSON — keep the text as received
        }
      }
      const clean = redactNotification(body);
      const s = summariseNotification(clean);

      // De-dupe: atomic, so two simultaneous deliveries can't both be processed.
      let duplicate = false;
      if (s.notificationId) {
        try {
          const first = await fastify.redis.set(
            `flightalert:seen:${s.notificationId}`,
            "1",
            "EX",
            SEEN_TTL_S,
            "NX"
          );
          duplicate = !first;
        } catch (err) {
          fastify.log.error({ err }, "[FlightAlert] de-dupe check failed");
        }
      }

      let eventId: string | null = null;
      try {
        const ev = await fastify.prisma.flightWebhookEvent.create({
          data: {
            notificationId: s.notificationId,
            subscriptionId: s.subscriptionId,
            flightNumber: s.flightNumber,
            flightCount: s.flightCount,
            balance: s.balance,
            payload: (typeof clean === "string"
              ? { raw: clean }
              : clean ?? {}) as any,
            ...(duplicate && {
              processedAt: new Date(),
              outcome: "duplicate",
            }),
          },
          select: { id: true },
        });
        eventId = ev.id;
      } catch (err) {
        fastify.log.error(
          { err },
          "[FlightAlert] could not store notification"
        );
      }

      fastify.log.warn(
        `[FlightAlert] received ${s.flightNumber ?? "?"} sub=${
          s.subscriptionId ?? "?"
        } flights=${s.flightCount} balance=${s.balance ?? "?"} seq=${
          s.seqNo ?? "?"
        }${duplicate ? " DUPLICATE (skipped)" : ""}`
      );
      if (s.balance !== null && s.balance < LOW_BALANCE_CREDITS) {
        fastify.log.warn(
          `[FlightAlert] LOW BALANCE: ${s.balance} credits left (auto top-up will check)`
        );
      }

      if (!duplicate) {
        setImmediate(() => {
          processFlightNotification(
            {
              prisma: fastify.prisma,
              redis: fastify.redis,
              log: fastify.log,
              io: fastify.io as any,
            },
            eventId,
            clean
          ).catch((err) =>
            fastify.log.error({ err }, "[FlightAlert] processing crashed")
          );
        });
      }

      // Always 200 for a valid secret: retries cost credits and we store first.
      return reply.status(200).send({ ok: true });
    }
  );
}
