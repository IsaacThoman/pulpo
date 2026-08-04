import { z } from 'zod'
import { agentSettingsSchema, DEFAULT_OCR_SYSTEM_PROMPT, webToolsSettingsSchema } from '@pulpo/contracts'

export const DEFAULT_BALANCE_MICROS = 5_000_000
export const DEFAULT_STORAGE_LIMIT_BYTES = 5_000 * 1024 * 1024

export const authSettingsSchema = z.object({
  signupEnabled: z.boolean().default(true),
  defaultBalanceMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(DEFAULT_BALANCE_MICROS),
  defaultStorageLimitBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(DEFAULT_STORAGE_LIMIT_BYTES),
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
  modelId: z.string().min(1).max(200).nullable().default(null),
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
  encryptedApiKey: z.string().nullable().default(null),
})

export const DEFAULT_SUGGESTED_PROMPTS = [
  { id: '1', label: 'What can you help me build today?', message: 'What can you help me build today?' },
  { id: '2', label: 'Explain how KV caching speeds up decoding', message: 'Explain how KV caching speeds up decoding' },
  { id: '3', label: 'Draft a terse commit message for a sidebar refactor', message: 'Draft a terse commit message for a sidebar refactor' },
  { id: '4', label: 'Compare mixture-of-experts vs dense models', message: 'Compare mixture-of-experts vs dense models' },
] as const

export const DEFAULT_TITLE_PROMPT = `### Task:
Generate a concise, 3-5 word title with an emoji summarizing the chat history.
### Guidelines:
- The title should clearly represent the main theme or subject of the conversation.
- Use emojis that enhance understanding of the topic, but avoid quotation marks or special formatting.
- Use an emoji as the first character of the title
- Write the title in the chat's primary language; default to English if multilingual.
- Prioritize accuracy over excessive creativity; keep it clear and simple.
### Output:
JSON format: { "title": "your concise title here" }
### Examples:
- { "title": "📉 Stock Market Trends" },
- { "title": "🍪 Perfect Chocolate Chip Recipe" },
- { "title": "🎶 Evolution of Music Streaming" },
- { "title": "💻 Remote Work Productivity Tips" },
- { "title": "👀 Artificial Intelligence in Healthcare" },
- { "title": "🎮 Video Game Development Insights" }`

export const suggestedPromptItemSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(4_000),
})

export const interfaceSettingsSchema = z.object({
  localTask: z.string().min(1).max(200).default('current'),
  compaction: z.boolean().default(true),
  compactionTokens: z.number().int().min(2_000).max(1_000_000).default(12_000),
  title: z.boolean().default(true),
  titlePrompt: z.string().max(10_000).default(DEFAULT_TITLE_PROMPT),
  titleIncludeFirstCharacters: z.number().int().min(0).max(1_000_000).default(8_000),
  titleIncludeLastCharacters: z.number().int().min(0).max(1_000_000).default(8_000),
  followUp: z.boolean().default(true),
  suggestedPromptsEnabled: z.boolean().default(true),
  suggestedPromptsCount: z.number().int().min(0).max(12).default(4),
  suggestedPrompts: z.array(suggestedPromptItemSchema).max(50).default([...DEFAULT_SUGGESTED_PROMPTS]),
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
  const parsed = storedWebToolsSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : storedWebToolsSettingsSchema.parse({})
}

export function parseInterfaceSettings(value: unknown): InterfaceSettings {
  const parsed = interfaceSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : interfaceSettingsSchema.parse({})
}
