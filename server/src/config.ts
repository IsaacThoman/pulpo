import { z } from 'zod'

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true')

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_URL: z.url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1).default('postgres://pulpo:pulpo@localhost:5432/pulpo'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  SESSION_COOKIE_NAME: z.string().min(1).default('pulpo_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  ENCRYPTION_KEY: z.string().min(32).default('development-only-key-change-me-000000'),
  BOOTSTRAP_ADMIN_EMAIL: z.email().default('admin@pulpo.local'),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(8).default('change-me-now'),
  BOOTSTRAP_ADMIN_NAME: z.string().min(1).default('Pulpo Admin'),
  BOOTSTRAP_ADMIN_BALANCE_MICROS: z.coerce.number().int().nonnegative().default(100_000_000),
  OPENAI_API_KEY: z.string().optional(),
  COOKIE_SECURE: booleanString,
  ALLOW_PRIVATE_PROVIDER_URLS: booleanString,
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./data/objects'),
  S3_ENDPOINT: z.url().default('http://localhost:8333'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('pulpo'),
  S3_ACCESS_KEY_ID: z.string().default('pulpo'),
  S3_SECRET_ACCESS_KEY: z.string().default('pulpo-development-secret'),
  S3_FORCE_PATH_STYLE: booleanString.default(true),
  RESPONSE_EVENT_RETENTION_SECONDS: z.coerce.number().int().positive().default(86_400),
  RESPONSE_SNAPSHOT_INTERVAL_MS: z.coerce.number().int().positive().default(1_500),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

export type Config = z.infer<typeof configSchema>

let cached: Config | undefined

export function getConfig(): Config {
  cached ??= configSchema.parse(process.env)
  return cached
}

export function getAllowedOrigins(config = getConfig()): Set<string> {
  const origins = new Set([new URL(config.PUBLIC_URL).origin])
  if (config.NODE_ENV === 'development') {
    origins.add('http://localhost:5173')
    origins.add('http://127.0.0.1:5173')
  }
  return origins
}
