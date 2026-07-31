import { z } from 'zod'

export const DEFAULT_BALANCE_MICROS = 5_000_000

export const authSettingsSchema = z.object({
  signupEnabled: z.boolean().default(true),
  defaultBalanceMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(DEFAULT_BALANCE_MICROS),
  pendingDetails: z.boolean().default(true),
  adminEmail: z.union([z.literal(''), z.email()]).default(''),
  pendingMessage: z.string().max(2_000).default('Your account is pending approval. An admin will review it shortly.'),
  defaultSignupRole: z.enum(['pending', 'user']).default('pending'),
  apiKeysEnabled: z.boolean().default(true),
})

export const loggingSettingsSchema = z.object({
  logDetailedPayloads: z.boolean().default(false),
  payloadRetention: z.enum(['1h', '24h', '7d', '30d', '90d', 'indefinite']).default('7d'),
})

export const ocrSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  cacheEnabled: z.boolean().default(true),
  cacheTtlSeconds: z.number().int().min(60).max(31_536_000).default(3600),
  providerMode: z.enum(['existing', 'custom']).default('existing'),
  providerConnectionId: z.string().uuid().nullable().default(null),
  customBaseUrl: z.string().url().nullable().default(null),
  encryptedCustomApiKey: z.string().nullable().default(null),
  model: z.string().min(1).max(200).default('gpt-4.1-mini'),
  systemPrompt: z.string().max(100_000).default('Extract all readable text from this image. Preserve structure and return only the extracted text.'),
})

export type AuthSettings = z.infer<typeof authSettingsSchema>

export function parseAuthSettings(value: unknown): AuthSettings {
  const parsed = authSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : authSettingsSchema.parse({})
}

export function parseLoggingSettings(value: unknown): z.infer<typeof loggingSettingsSchema> {
  const parsed = loggingSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : loggingSettingsSchema.parse({})
}

export function parseOcrSettings(value: unknown): z.infer<typeof ocrSettingsSchema> {
  const parsed = ocrSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : ocrSettingsSchema.parse({})
}
