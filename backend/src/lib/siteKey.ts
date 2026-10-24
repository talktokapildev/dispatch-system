// backend/src/lib/siteKey.ts
//
// The website's server-to-server routes (flight status, train times) must carry the header
//   x-site-key: <FLIGHT_STATUS_SITE_KEY>
// Production refuses everything while that variable is unset ("unset").
import crypto from "crypto";
import { FastifyRequest } from "fastify";

export function siteKeyOk(request: FastifyRequest): boolean | "unset" {
  const expected = process.env.FLIGHT_STATUS_SITE_KEY ?? "";
  if (!expected) return process.env.NODE_ENV === "production" ? "unset" : true;
  const got = String(request.headers["x-site-key"] ?? "");
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
