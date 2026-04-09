import { z } from 'zod'

const envSchema = z.object({
  PORT: z.string().default('3001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PREFIX: z.string().default('/api/v1'),

  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: z.string(),
  JWT_EXPIRES_IN: z.string().default('7d'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('30d'),

  GOOGLE_MAPS_API_KEY: z.string().optional().default('placeholder'),
  STRIPE_SECRET_KEY: z.string().optional().default('placeholder'),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  FROM_EMAIL: z.string().default('dispatch@yourdomain.com'),

  OPERATOR_NAME: z.string().default('Dispatch Company Ltd'),
  OPERATOR_LICENSE_NUMBER: z.string().default('PHV1234'),

  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
})

function loadConfig() {
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    console.error('❌ Invalid environment variables:', result.error.flatten().fieldErrors)
    process.exit(1)
  }
  return result.data
}

export const config = loadConfig()

export const DRIVER_ACCEPT_TIMEOUT_MS = 60_000     // 60s to accept job
export const MAX_DISPATCH_ATTEMPTS = 3              // Try 3 drivers before manual
export const MAX_DRIVER_SEARCH_RADIUS_KM = 10       // Max radius to search for drivers
export const PLATFORM_FEE_PERCENT = 15              // 15% platform fee
export const PREBOOK_LEAD_TIME_MINUTES = 30         // Min advance booking time
export const OTP_EXPIRY_MINUTES = 10
export const OTP_LENGTH = 6
