// backend/src/routes/twilioWebhooks.ts
//
// POST /webhooks/twilio/sms-status — Twilio message status callbacks.
//
// Registered WITHOUT the /api/v1 prefix (provider callback), rate limit off.
// Twilio posts application/x-www-form-urlencoded; the parser below is scoped
// to this plugin, so no other route's body handling changes.
//
// Security: every request must carry a valid X-Twilio-Signature (HMAC of the
// URL + params with TWILIO_AUTH_TOKEN). The URL is rebuilt from BACKEND_URL,
// not from the request — behind Railway's proxy the host/protocol differ.
// Invalid → 403. Valid → 200 straight away, then processed in the background.
import { FastifyInstance } from "fastify";
import Twilio from "twilio";
import { SMS_STATUS_PATH, statusCallbackUrl } from "../services/sms.service";
import { handleSmsStatusCallback } from "../services/smsStatus.service";

/** A callback can beat our insert of the SmsMessage row by a moment. */
const UNKNOWN_SID_RETRY_MS = 3000;

export function isValidTwilioSignature(
  signature: unknown,
  params: Record<string, string>
): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const url = statusCallbackUrl();
  if (!token || !url || typeof signature !== "string" || !signature)
    return false;
  try {
    return Twilio.validateRequest(token, signature, url, params);
  } catch {
    return false;
  }
}

export async function twilioWebhookRoutes(fastify: FastifyInstance) {
  fastify.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(body as string)));
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  fastify.post(
    SMS_STATUS_PATH,
    { bodyLimit: 64 * 1024, config: { rateLimit: false } },
    async (request, reply) => {
      const params =
        request.body && typeof request.body === "object"
          ? (request.body as Record<string, string>)
          : {};

      if (
        !isValidTwilioSignature(request.headers["x-twilio-signature"], params)
      ) {
        fastify.log.warn("[SMS] status callback rejected: bad signature");
        return reply.status(403).send();
      }

      setImmediate(async () => {
        try {
          let outcome = await handleSmsStatusCallback(
            fastify.prisma,
            fastify.log,
            params
          );
          if (outcome === "unknown sid") {
            await new Promise((r) => setTimeout(r, UNKNOWN_SID_RETRY_MS));
            outcome = await handleSmsStatusCallback(
              fastify.prisma,
              fastify.log,
              params
            );
            if (outcome === "unknown sid")
              fastify.log.warn(
                `[SMS] status callback for unknown sid ${params.MessageSid} (${params.MessageStatus})`
              );
          }
        } catch (err) {
          fastify.log.error({ err }, "[SMS] status callback processing failed");
        }
      });

      return reply.status(200).type("text/xml").send("<Response/>");
    }
  );
}
