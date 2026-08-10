import { z } from 'zod'
import {
  agentSettingsSchema,
  authSettingsSchema,
  DEFAULT_MAX_ATTACHMENT_BYTES,
  DEFAULT_OCR_SYSTEM_PROMPT,
  DEFAULT_SUGGESTED_PROMPTS,
  DEFAULT_TITLE_PROMPT,
  instanceOcrSettingsSchema,
  interfaceSettingsSchema,
  loggingSettingsSchema,
  suggestedPromptItemSchema,
  webToolsSettingsSchema,
} from '@pulpo/contracts'

export { authSettingsSchema, DEFAULT_MAX_ATTACHMENT_BYTES, DEFAULT_SUGGESTED_PROMPTS, DEFAULT_TITLE_PROMPT, interfaceSettingsSchema, loggingSettingsSchema }

export const DEFAULT_BALANCE_MICROS = 5_000_000
export const DEFAULT_STORAGE_LIMIT_BYTES = 5_000 * 1024 * 1024

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

export type AuthSettings = z.infer<typeof authSettingsSchema>
export type InterfaceSettings = z.infer<typeof interfaceSettingsSchema>
export type SuggestedPromptItem = z.infer<typeof suggestedPromptItemSchema>

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

export function parseAgentSettings(value: unknown): z.infer<typeof agentSettingsSchema> {
  const parsed = agentSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : agentSettingsSchema.parse({})
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
