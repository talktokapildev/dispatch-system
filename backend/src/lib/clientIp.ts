// backend/src/lib/clientIp.ts
//
// The visitor's IP. Requests reach us through Railway's proxy, so request.ip is the proxy's
// address; the client is the right-most X-Forwarded-For entry (added by the proxy, so it can't
// be spoofed by the client). Returns null when only a private/proxy address is known, so we
// never put every visitor in one shared bucket.
//
// Used by the sign-in code limits (routes/auth.ts) and the website quote limits
// (routes/publicQuote.ts).

export function clientIp(request: { headers: Record<string, any>; ip: string }): string | null {
  const xff = String(request.headers["x-forwarded-for"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ip = xff.length ? xff[xff.length - 1] : request.ip;
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/, "");
  if (
    /^(10\.|127\.|192\.168\.|169\.254\.)/.test(v4) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(v4) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(v4) || // carrier-grade NAT (Railway)
    v4 === "::1" ||
    /^f[cd]/i.test(v4)
  )
    return null;
  return v4;
}

/** Count one hit in a 1-hour window; true if the limit is now exceeded. */
export async function overHourlyLimit(redis: any, key: string, max: number): Promise<boolean> {
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, 60 * 60);
  return n > max;
}
