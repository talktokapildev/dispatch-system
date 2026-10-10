// backend/src/routes/flightWebhooks.ts
//
// POST /webhooks/flights/:secret  — AeroDataBox Flight Alert notifications.
//
// Step 5a (capture): validate the secret, store the raw payload, reply 200.
// Nothing is applied to bookings yet — that's step 5b, once we've seen real
// payloads. Registered WITHOUT the /api/v1 prefix (it's a provider callback).
// AeroDataBox doesn't sign notifications, so the secret in the URL is the guard.
import { FastifyInstance } from "fastify";
import {
  isValidWebhookSecret,
  summariseNotification,
  LOW_BALANCE_CREDITS,
} from "../services/flightAlerts.service";

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

      const body = request.body as unknown;
      const s = summariseNotification(body);
      try {
        await fastify.prisma.flightWebhookEvent.create({
          data: {
            subscriptionId: s.subscriptionId,
            flightNumber: s.flightNumber,
            flightCount: s.flightCount,
            balance: s.balance,
            payload: (typeof body === "string"
              ? { raw: body }
              : body ?? {}) as any,
          },
        });
      } catch (err) {
        fastify.log.error(
          { err },
          "[FlightAlert] could not store notification"
        );
      }

      fastify.log.warn(
        `[FlightAlert] received ${s.flightNumber ?? "?"} sub=${
          s.subscriptionId ?? "?"
        } flights=${s.flightCount} balance=${
          s.balance ?? "?"
        } keys=${s.topLevelKeys.join(",")}`
      );
      if (s.balance !== null && s.balance < LOW_BALANCE_CREDITS) {
        fastify.log.warn(
          `[FlightAlert] LOW BALANCE: ${s.balance} credits left — top up with scripts/flight-alerts.ts refill`
        );
      }

      // Always 200 for a valid secret: retries cost credits and we store first.
      return reply.status(200).send({ ok: true });
    }
  );
}
