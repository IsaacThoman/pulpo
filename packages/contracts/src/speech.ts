import { z } from 'zod'

export const speechPreferencesSchema = z.object({
  modelId: z.string().max(120).nullable().default(null),
  models: z.record(z.string().max(120), z.object({
    voice: z.string().max(200).optional(),
    instructions: z.string().max(4096).default(''),
    speed: z.number().min(0.25).max(4).default(1),
  })).default({}),
}).default(() => ({ modelId: null, models: {} }))
export type SpeechPreferences = z.infer<typeof speechPreferencesSchema>

const price = z.number().int().min(0).max(1_000_000_000_000)
export const speechModelSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/),
  providerConnectionId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  upstreamModelId: z.string().trim().min(1).max(200),
  enabled: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
  voices: z.array(z.object({ id: z.string().trim().min(1).max(200), label: z.string().trim().min(1).max(120) })).min(1).max(200),
  defaultVoice: z.string().min(1).max(200),
  supportsInstructions: z.boolean().default(false),
  supportsSpeed: z.boolean().default(false),
  speedMin: z.number().min(0.25).max(1).default(0.25),
  speedMax: z.number().min(1).max(4).default(4),
  maxInputCharacters: z.number().int().min(64).max(4096).default(4096),
  maxInputTokens: z.number().int().min(64).max(32000).nullable().default(null),
  responseFormat: z.enum(['mp3', 'wav']).default('mp3'),
  supportsSse: z.boolean().default(false),
  billUsers: z.boolean().default(false),
  billingUnit: z.enum(['tokens', 'characters', 'duration']).default('characters'),
  inputPriceMicros: price.default(0),
  outputPriceMicros: price.default(0),
  characterPriceMicros: price.default(0),
  minutePriceMicros: price.default(0),
}).superRefine((model, ctx) => {
  if (!model.voices.some(v => v.id === model.defaultVoice)) ctx.addIssue({ code: 'custom', path: ['defaultVoice'], message: 'Default voice must be in the voice list' })
  if (new Set(model.voices.map(v => v.id)).size !== model.voices.length) ctx.addIssue({ code: 'custom', path: ['voices'], message: 'Voice IDs must be unique' })
  if (model.billUsers && model.billingUnit === 'tokens' && !model.supportsSse) ctx.addIssue({ code: 'custom', path: ['supportsSse'], message: 'Token billing requires speech SSE usage' })
})
export type SpeechModel = z.infer<typeof speechModelSchema>
export type SpeechModelCatalogEntry = SpeechModel & { previewAvailable?: boolean }
export type PublicSpeechModel = Omit<SpeechModelCatalogEntry, 'providerConnectionId' | 'upstreamModelId'>
export const speechRequestSchema = z.object({
  requestId: z.string().uuid(),
  modelId: z.string().min(1).max(120),
  input: z.string().min(1).max(16384),
  voice: z.string().min(1).max(200),
  instructions: z.string().max(4096).optional(),
  speed: z.number().min(0.25).max(4).optional(),
}).strict()
export type SpeechRequest = z.infer<typeof speechRequestSchema>

export const OPENAI_SPEECH_PRESET = {
  name: 'GPT-4o mini TTS', upstreamModelId: 'gpt-4o-mini-tts', enabled: false, sortOrder: 0,
  voices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse', 'marin', 'cedar'].map(id => ({ id, label: id })),
  defaultVoice: 'coral', supportsInstructions: true, supportsSpeed: true, speedMin: 0.25, speedMax: 4,
  maxInputCharacters: 4096, maxInputTokens: 2000, responseFormat: 'mp3', supportsSse: true,
  billUsers: false, billingUnit: 'tokens', inputPriceMicros: 600000, outputPriceMicros: 12000000,
  characterPriceMicros: 0, minutePriceMicros: 0,
} satisfies Omit<SpeechModel, 'id' | 'providerConnectionId'>

export function speechPriceLabel(model: PublicSpeechModel): string {
  const usd = (micros: number) => `$${micros / 1e6}`
  if (!model.billUsers) return 'Free to use'
  if (model.billingUnit === 'tokens') return `${usd(model.inputPriceMicros)} / 1M input text tokens · ${usd(model.outputPriceMicros)} / 1M output audio tokens`
  if (model.billingUnit === 'characters') return `${usd(model.characterPriceMicros)} / 1,000 characters`
  return `${usd(model.minutePriceMicros)} / generated audio minute`
}
