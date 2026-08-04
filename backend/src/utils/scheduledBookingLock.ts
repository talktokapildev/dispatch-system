// backend/src/utils/scheduledBookingLock.ts
//
// Distributed lock to prevent two drivers claiming the same scheduled
// booking simultaneously. Uses ioredis SET NX PX (atomic set-if-not-exists
// with expiry) — the standard safe pattern for short-lived claim locks.
//
// NOTE: Redis is a Fastify-decorated instance (fastify.redis), not a
// standalone module export — so these functions take the Redis instance
// as a parameter rather than importing one directly.
import type Redis from "ioredis";
import { RedisKeys, RedisTTL } from "../plugins/redis";

/**
 * Attempts to acquire the claim lock for a booking.
 * Returns a unique token if successful (needed to safely release),
 * or null if another process already holds the lock.
 */
export async function acquireClaimLock(
  redis: Redis,
  bookingId: string
): Promise<string | null> {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await redis.set(
    RedisKeys.bookingLock(bookingId),
    token,
    "PX",
    RedisTTL.bookingLock * 1000, // RedisTTL values are in seconds; ioredis PX wants ms
    "NX"
  );
  return result === "OK" ? token : null;
}

/**
 * Releases the claim lock, but only if the caller still holds it
 * (token match) — prevents releasing a lock that has since expired
 * and been re-acquired by someone else.
 */
export async function releaseClaimLock(
  redis: Redis,
  bookingId: string,
  token: string
): Promise<void> {
  const luaScript = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  await redis.eval(luaScript, 1, RedisKeys.bookingLock(bookingId), token);
}
