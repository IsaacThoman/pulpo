import { z } from 'zod'

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true')

function optionalEnvironmentValue<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => value === '' ? undefined : value, schema.optional())
}

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_URL: z.url().default('http://localhost:5173'),
  INSTANCE_NAME: z.string().trim().min(1).default('Pulpo'),
  PULPO_VERSION: z.string().trim().min(1).default('0.1.0'),
  DATABASE_URL: z.string().min(1).optional(),
  POSTGRES_HOST: z.string().min(1).default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_USER: z.string().min(1).default('pulpo'),
  POSTGRES_PASSWORD: z.string().default('pulpo'),
  POSTGRES_DATABASE: z.string().min(1).default('pulpo'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  SESSION_COOKIE_NAME: z.string().min(1).default('pulpo_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  ENCRYPTION_KEY: z.string().min(32).default('development-only-key-change-me-000000'),
  OPENAI_API_KEY: z.string().optional(),
  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().default('Pulpo <noreply@pulpo.local>'),
  COOKIE_SECURE: booleanString,
  ALLOW_PRIVATE_PROVIDER_URLS: booleanString,
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./data/objects'),
  S3_ENDPOINT: z.url().default('http://localhost:8333'),
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('pulpo'),
  S3_ACCESS_KEY_ID: z.string().default('pulpo'),
  S3_SECRET_ACCESS_KEY: z.string().default('pulpo-development-secret'),
  S3_FORCE_PATH_STYLE: booleanString.default(true),
  S3_CONFIGURE_CORS: booleanString.default(true),
  RESPONSE_EVENT_RETENTION_SECONDS: z.coerce.number().int().positive().default(86_400),
  RESPONSE_SNAPSHOT_INTERVAL_MS: z.coerce.number().int().positive().default(1_500),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  WORKSPACE_CONTROLLER_URL: optionalEnvironmentValue(z.url()),
  WORKSPACE_CONTROLLER_TOKEN: optionalEnvironmentValue(z.string().min(32)),
  WORKSPACE_CONTROLLER_CA_CERT_BASE64: optionalEnvironmentValue(z.string().min(1)),
})

export type Config = z.infer<typeof configSchema>

let cached: Config | undefined

export function parseConfig(environment: NodeJS.ProcessEnv): Config {
  return configSchema.parse(environment)
}

export function getConfig(): Config {
  cached ??= parseConfig(process.env)
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
