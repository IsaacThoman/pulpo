import { z } from 'zod'
import {
  agentSettingsSchema,
  authSettingsSchema,
  dictationSettingsSchema,
  episodicMemorySettingsSchema,
  DEFAULT_MAX_ATTACHMENT_BYTES,
  DEFAULT_OCR_SYSTEM_PROMPT,
  DEFAULT_SUGGESTED_PROMPTS,
  DEFAULT_TITLE_PROMPT,
  instanceOcrSettingsSchema,
  interfaceSettingsSchema,
  loggingSettingsSchema,
  personalizationSettingsSchema,
  suggestedPromptItemSchema,
  webToolsSettingsSchema,
} from '@pulpo/contracts'

export { authSettingsSchema, DEFAULT_MAX_ATTACHMENT_BYTES, DEFAULT_SUGGESTED_PROMPTS, DEFAULT_TITLE_PROMPT, interfaceSettingsSchema, loggingSettingsSchema, personalizationSettingsSchema }

export const DEFAULT_BALANCE_MICROS = 5_000_000
export const DEFAULT_STORAGE_LIMIT_BYTES = 5_000 * 1024 * 1024
export const DEFAULT_BABY_STORAGE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024
export const DEFAULT_EIGHT_STORAGE_LIMIT_BYTES = 25 * 1024 * 1024 * 1024
export const DEFAULT_FAT_STORAGE_LIMIT_BYTES = 100 * 1024 * 1024 * 1024
export const DEFAULT_EIGHT_WEEKLY_LIMIT_MICROS = 3_000_000
export const DEFAULT_FAT_WEEKLY_LIMIT_MICROS = 4_000_000

export const billingSettingsSchema = z.object({
  eightWeeklyLimitMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(DEFAULT_EIGHT_WEEKLY_LIMIT_MICROS),
  fatWeeklyLimitMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(DEFAULT_FAT_WEEKLY_LIMIT_MICROS),
  babyStorageLimitBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(DEFAULT_BABY_STORAGE_LIMIT_BYTES),
  eightStorageLimitBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(DEFAULT_EIGHT_STORAGE_LIMIT_BYTES),
  fatStorageLimitBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(DEFAULT_FAT_STORAGE_LIMIT_BYTES),
  lastReconciledAt: z.string().nullable().default(null),
  lastReconcileError: z.string().nullable().default(null),
})

export type BillingSettings = z.infer<typeof billingSettingsSchema>

export function parseBillingSettings(value: unknown): BillingSettings {
  const parsed = billingSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : billingSettingsSchema.parse({})
}

export const ocrSettingsSchema = instanceOcrSettingsSchema.extend({
  // Retained only so provider-based settings from older releases can be mapped
  // to a configured catalog model.
  providerMode: z.enum(['existing', 'custom']).default('existing'),
  providerConnectionId: z.string().uuid().nullable().default(null),
  customBaseUrl: z.string().url().nullable().default(null),
  encryptedCustomApiKey: z.string().nullable().default(null),
  model: z.string().min(1).max(200).default('gpt-4.1-mini'),
  systemPrompt: z.string().max(100_000).default(DEFAULT_OCR_SYSTEM_PROMPT),
})

export const storedWebToolsSettingsSchema = webToolsSettingsSchema.extend({
  encryptedKagiApiKey: z.string().nullable().default(null),
  encryptedFirecrawlApiKey: z.string().nullable().default(null),
})

export const storedDictationSettingsSchema = dictationSettingsSchema.extend({
  encryptedGroqApiKey: z.string().nullable().default(null),
})

export type AuthSettings = z.infer<typeof authSettingsSchema>
export type InterfaceSettings = z.infer<typeof interfaceSettingsSchema>
export type PersonalizationSettings = z.infer<typeof personalizationSettingsSchema>
export type SuggestedPromptItem = z.infer<typeof suggestedPromptItemSchema>

export function parseAuthSettings(value: unknown): AuthSettings {
  const parsed = authSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : authSettingsSchema.parse({})
}

export function parseLoggingSettings(value: unknown): z.infer<typeof loggingSettingsSchema> {
  const parsed = loggingSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : loggingSettingsSchema.parse({})
}

export function parsePersonalizationSettings(value: unknown): PersonalizationSettings {
  const parsed = personalizationSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : personalizationSettingsSchema.parse({})
}

export function parseOcrSettings(value: unknown): z.infer<typeof ocrSettingsSchema> {
  const parsed = ocrSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : ocrSettingsSchema.parse({})
}

export function parseAgentSettings(value: unknown): z.infer<typeof agentSettingsSchema> {
  const parsed = agentSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : agentSettingsSchema.parse({})
}

export function parseEpisodicMemorySettings(value: unknown): z.infer<typeof episodicMemorySettingsSchema> {
  const parsed = episodicMemorySettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : episodicMemorySettingsSchema.parse({})
}

export function parseWebToolsSettings(value: unknown): z.infer<typeof storedWebToolsSettingsSchema> {
  const legacy = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const legacyKagi = legacy.kagi && typeof legacy.kagi === 'object' ? legacy.kagi as Record<string, unknown> : {}
  const legacyFirecrawl = legacy.firecrawl && typeof legacy.firecrawl === 'object' ? legacy.firecrawl as Record<string, unknown> : {}
  const providerBilling = (provider: Record<string, unknown>) => ({
    billSearches: provider.billSearches ?? legacy.billSearches,
    searchPriceMicros: provider.searchPriceMicros ?? legacy.searchPriceMicros,
    billExtracts: provider.billExtracts ?? legacy.billExtracts,
    extractPriceMicros: provider.extractPriceMicros ?? legacy.extractPriceMicros,
  })
  const parsed = storedWebToolsSettingsSchema.safeParse({
    ...legacy,
    kagi: { ...legacyKagi, ...providerBilling(legacyKagi) },
    firecrawl: { ...legacyFirecrawl, ...providerBilling(legacyFirecrawl) },
    encryptedKagiApiKey: legacy.encryptedKagiApiKey ?? legacy.encryptedApiKey ?? null,
  })
  return parsed.success ? parsed.data : storedWebToolsSettingsSchema.parse({})
}

export function parseDictationSettings(value: unknown): z.infer<typeof storedDictationSettingsSchema> {
  const parsed = storedDictationSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : storedDictationSettingsSchema.parse({})
}

export function publicDictationSettings(value: z.infer<typeof storedDictationSettingsSchema>) {
  return {
    enabled: value.enabled,
    billUsers: value.billUsers,
    pricePerMinuteMicros: value.pricePerMinuteMicros,
    hasApiKey: Boolean(value.encryptedGroqApiKey),
  }
}

export function publicWebToolsSettings(value: z.infer<typeof storedWebToolsSettingsSchema>) {
  const { encryptedKagiApiKey, encryptedFirecrawlApiKey, ...safe } = value
  return {
    ...safe,
    kagi: { ...safe.kagi, hasApiKey: Boolean(encryptedKagiApiKey) },
    firecrawl: { ...safe.firecrawl, hasApiKey: Boolean(encryptedFirecrawlApiKey) },
  }
}

export function parseInterfaceSettings(value: unknown): InterfaceSettings {
  const parsed = interfaceSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : interfaceSettingsSchema.parse({})
}
