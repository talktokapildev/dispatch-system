import fp from 'fastify-plugin'
import { FastifyPluginAsync } from 'fastify'
import Redis from 'ioredis'
import { config } from '../config'

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis
  }
}

const redisPlugin: FastifyPluginAsync = fp(async (fastify) => {
  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  })

  redis.on('error', (err: Error) => fastify.log.error({ err }, 'Redis error'))
  redis.on('connect', () => fastify.log.info('✅ Redis connected'))

  fastify.decorate('redis', redis)

  fastify.addHook('onClose', async () => {
    await redis.quit()
  })
})

export default redisPlugin

// ─────────────────────────────────────────
// Redis key helpers
// ─────────────────────────────────────────

export const RedisKeys = {
  driverLocation: (driverId: string) => `driver:location:${driverId}`,
  driverStatus: (driverId: string) => `driver:status:${driverId}`,
  onlineDrivers: () => `drivers:online`,
  bookingLock: (bookingId: string) => `booking:lock:${bookingId}`,
  dispatchQueue: () => `dispatch:queue`,
  otpCode: (phone: string) => `otp:${phone}`,
  rateLimit: (key: string) => `rate:${key}`,
  activeBooking: (driverId: string) => `driver:active_booking:${driverId}`,
}

export const RedisTTL = {
  otp: 60 * 10,               // 10 minutes
  driverLocation: 60 * 5,     // 5 minutes
  bookingLock: 60 * 2,        // 2 minutes
  session: 60 * 60 * 24 * 7,  // 7 days
}
