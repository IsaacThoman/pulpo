import { androidCertificateFingerprints } from './auth/android-app.js'
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
  PULPO_ANDROID_CERTIFICATE_FINGERPRINTS: z.string().default('').refine((value) => { try { androidCertificateFingerprints(value); return true } catch { return false } }, 'Use comma-separated SHA-256 signing certificate fingerprints'),
  INSTANCE_NAME: z.string().trim().min(1).default('Pulpo'),
  PULPO_VERSION: z.string().trim().min(1).default('0.1.0'),
  PULPO_BILLING_ENABLED: booleanString,
  STRIPE_SECRET_KEY: optionalEnvironmentValue(z.string().regex(/^sk_(?:test|live)_/)),
  STRIPE_WEBHOOK_SECRET: optionalEnvironmentValue(z.string().startsWith('whsec_')),
  STRIPE_CREDIT_PRODUCT_ID: optionalEnvironmentValue(z.string().startsWith('prod_')),
  STRIPE_EIGHT_PRICE_ID: optionalEnvironmentValue(z.string().startsWith('price_')),
  STRIPE_FAT_PRICE_ID: optionalEnvironmentValue(z.string().startsWith('price_')),
  DATABASE_URL: z.string().min(1).optional(),
  POSTGRES_HOST: z.string().min(1).default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_USER: z.string().min(1).default('pulpo'),
  POSTGRES_PASSWORD: z.string().default('pulpo'),
  POSTGRES_DATABASE: z.string().min(1).default('pulpo'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  PULPO_OLLAMA_URL: z.url().default('http://localhost:11434'),
  SESSION_COOKIE_NAME: z.string().min(1).default('pulpo_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  ENCRYPTION_KEY: z.string().min(32).default('development-only-key-change-me-000000'),
  OPENAI_API_KEY: z.string().optional(),
  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().default('Pulpo <noreply@pulpo.local>'),
  COOKIE_SECURE: booleanString,
  ALLOW_ANY_LOCALHOST_PORT: booleanString,
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
  PULPO_INSTANCE_ID: optionalEnvironmentValue(z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/)),
  PULPO_BOOTSTRAP_PRESET: optionalEnvironmentValue(z.literal('ci-preview')),
  PULPO_PREVIEW_ADMIN_EMAIL: optionalEnvironmentValue(z.email()),
  PULPO_PREVIEW_ADMIN_PASSWORD: optionalEnvironmentValue(z.string().min(8).max(1024)),
  PULPO_PREVIEW_PROVIDER_API_KEY: optionalEnvironmentValue(z.string().min(1)),
  PULPO_PREVIEW_WORKSPACE_IMAGE_DIGEST: optionalEnvironmentValue(
    z.string().regex(/^ghcr\.io\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/),
  ),
})

export type Config = z.infer<typeof configSchema>

let cached: Config | undefined

export function getCoolifyPreviewId(environment: NodeJS.ProcessEnv): string | undefined {
  const branch = environment.COOLIFY_BRANCH?.trim().replace(/^['"]|['"]$/g, '')
  return branch?.match(/^pull\/([1-9]\d*)\/head$/)?.[1]
}

export function parseConfig(environment: NodeJS.ProcessEnv): Config {
  const previewId = getCoolifyPreviewId(environment)
  const configuredOllamaUrl = environment.PULPO_OLLAMA_URL?.trim()
  const previewOllamaUrl = previewId && (
    !configuredOllamaUrl
    || configuredOllamaUrl === 'http://ollama:11434'
    || configuredOllamaUrl === 'http://localhost:11434'
  )
    ? `http://${environment.SERVICE_NAME_OLLAMA?.trim() || `ollama-pr-${previewId}`}:11434`
    : undefined
  const config = configSchema.parse({
    ...environment,
    ...(previewId ? {
      POSTGRES_HOST: `postgres-pr-${previewId}`,
      REDIS_URL: `redis://redis-pr-${previewId}:6379`,
      S3_ENDPOINT: `http://seaweed-s3-pr-${previewId}:8333`,
      ...(previewOllamaUrl ? { PULPO_OLLAMA_URL: previewOllamaUrl } : {}),
    } : {}),
  })
  if (config.PULPO_BILLING_ENABLED) {
    const required = [
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_CREDIT_PRODUCT_ID',
      'STRIPE_EIGHT_PRICE_ID',
      'STRIPE_FAT_PRICE_ID',
    ] as const
    const missing = required.filter((key) => !config[key])
    if (missing.length > 0) {
      throw new Error(`Billing is enabled but required configuration is missing: ${missing.join(', ')}`)
    }
  }
  return config
}

export function getConfig(): Config {
  cached ??= parseConfig(process.env)
  return cached
}

function fqdnHostname(value: string | undefined): string | undefined {
  const first = value?.split(',')[0]?.trim()
  if (!first) return undefined
  try {
    return new URL(first.includes('://') ? first : `https://${first}`).hostname
  } catch {
    return undefined
  }
}

export function getWorkspaceInstanceId(config = getConfig(), environment: NodeJS.ProcessEnv = process.env): string {
  return config.PULPO_INSTANCE_ID
    ?? fqdnHostname(environment.SERVICE_FQDN_WEB)
    ?? fqdnHostname(environment.COOLIFY_FQDN)
    ?? new URL(config.PUBLIC_URL).hostname
}

export function getAllowedOrigins(config = getConfig()): Set<string> {
  const origins = new Set([
    new URL(config.PUBLIC_URL).origin,
    'https://desktop.pulpo.invalid',
  ])
  if (config.NODE_ENV === 'development') {
    origins.add('http://localhost:5173')
    origins.add('http://127.0.0.1:5173')
    origins.add('http://localhost:5174')
    origins.add('http://127.0.0.1:5174')
  }
  return origins
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function isAllowedOrigin(origin: string, config = getConfig()): boolean {
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (getAllowedOrigins(config).has(parsed.origin)) return true
  return config.NODE_ENV === 'development'
    && config.ALLOW_ANY_LOCALHOST_PORT
    && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
    && LOOPBACK_HOSTS.has(parsed.hostname)
}

export function isAllowedRequestOrigin(origin: string, host: string | undefined, config = getConfig()): boolean {
  if (isAllowedOrigin(origin, config)) return true
  if (!host) return false
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return parsed.host === new URL(`http://${host}`).host
  } catch {
    return false
  }
}

export function getStorageCorsOrigins(config = getConfig()): string[] {
  const origins = [new URL(config.PUBLIC_URL).origin, 'https://desktop.pulpo.invalid']
  if (config.NODE_ENV === 'development') {
    origins.push('http://localhost:5174', 'http://127.0.0.1:5174')
  }
  if (config.NODE_ENV === 'development' && config.ALLOW_ANY_LOCALHOST_PORT) {
    origins.push(
      'http://localhost:*',
      'https://localhost:*',
      'http://127.0.0.1:*',
      'https://127.0.0.1:*',
      'http://[::1]:*',
      'https://[::1]:*',
    )
  }
  return origins
}
