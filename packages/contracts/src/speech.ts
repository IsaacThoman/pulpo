import { z } from 'zod'

// Transport bounds, independent of an upstream model's advertised limits.
// String lengths here use UTF-16 code units, matching Zod's string validation.
export const SPEECH_REQUEST_MAX_INPUT_LENGTH = 16_384
export const SPEECH_MAX_INSTRUCTIONS_LENGTH = 4_096
export const SPEECH_DURATION_HEADER = 'x-speech-duration-seconds'
export const SPEECH_ASSET_MAX_BYTES = 10 * 1024 * 1024
export const speechWatermarkSchema = z.object({ enabled: z.boolean().default(false), volume: z.number().min(0.01).max(1).default(0.15) })
export const speechVoiceSchema = z.object({
  id: z.string().trim().min(1).max(200), label: z.string().trim().min(1).max(120),
  kind: z.enum(['provider', 'cloned']).optional(),
  watermark: speechWatermarkSchema.optional(),
})
export interface SpeechProviderVoice { id: string; name: string; languages: string[]; custom: boolean; slug?: string }
// JSON can escape each code unit as six bytes (for example, control characters).
export const SPEECH_REQUEST_BODY_LIMIT = 6 * (SPEECH_REQUEST_MAX_INPUT_LENGTH + SPEECH_MAX_INSTRUCTIONS_LENGTH + 200 + 120) + 1024

export const speechDefaultsSchema = z.object({
  modelId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/).nullable().default(null),
})
export type SpeechDefaults = z.infer<typeof speechDefaultsSchema>
// Optional for clients connected to servers predating instance speech defaults.
export interface SpeechCatalog { data: PublicSpeechModel[]; defaultModelId?: string | null }

export const speechPreferencesSchema = z.object({
  modelId: z.string().max(120).nullable().default(null),
  models: z.record(z.string().max(120), z.object({
    voice: z.string().max(200).optional(),
    instructions: z.string().max(SPEECH_MAX_INSTRUCTIONS_LENGTH).default(''),
    speed: z.number().min(0.25).max(4).default(1),
  })).default({}),
}).default(() => ({ modelId: null, models: {} }))
export type SpeechPreferences = z.infer<typeof speechPreferencesSchema>

const price = z.number().int().min(0).max(1_000_000_000_000)
export const speechModelSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/),
  providerConnectionId: z.string().uuid(),
  adapter: z.enum(['openai', 'mistral']).default('openai'),
  name: z.string().trim().min(1).max(120),
  upstreamModelId: z.string().trim().min(1).max(200),
  enabled: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
  voices: z.array(speechVoiceSchema).max(200),
  defaultVoice: z.string().max(200).default(''),
  supportsInstructions: z.boolean().default(false),
  supportsSpeed: z.boolean().default(false),
  speedMin: z.number().min(0.25).max(1).default(0.25),
  speedMax: z.number().min(1).max(4).default(4),
  maxInputCharacters: z.number().int().positive().default(4096),
  maxInputTokens: z.number().int().positive().nullable().default(null),
  responseFormat: z.enum(['mp3', 'wav']).default('mp3'),
  supportsSse: z.boolean().default(false),
  billUsers: z.boolean().default(false),
  billingUnit: z.enum(['tokens', 'characters', 'duration']).default('characters'),
  inputPriceMicros: price.default(0),
  outputPriceMicros: price.default(0),
  characterPriceMicros: price.default(0),
  minutePriceMicros: price.default(0),
}).superRefine((model, ctx) => {
  if ((model.enabled || model.voices.length || model.defaultVoice) && !model.voices.some(v => v.id === model.defaultVoice)) ctx.addIssue({ code: 'custom', path: ['defaultVoice'], message: 'Default voice must be in the voice list' })
  if (new Set(model.voices.map(v => v.id)).size !== model.voices.length) ctx.addIssue({ code: 'custom', path: ['voices'], message: 'Voice IDs must be unique' })
  if (model.billUsers && model.billingUnit === 'tokens' && !model.supportsSse) ctx.addIssue({ code: 'custom', path: ['supportsSse'], message: 'Token billing requires speech SSE usage' })
  if (model.adapter === 'mistral' && (model.supportsInstructions || model.supportsSpeed || model.supportsSse || (model.billUsers && model.billingUnit === 'tokens'))) ctx.addIssue({ code: 'custom', path: ['adapter'], message: 'Voxtral uses voice samples for expression and supports character or duration billing' })
  if (model.adapter !== 'mistral' && model.voices.some(voice => voice.kind === 'cloned')) ctx.addIssue({ code: 'custom', path: ['voices'], message: 'Cloned voices require the Mistral adapter' })
})
export type SpeechModel = z.infer<typeof speechModelSchema>
export type SpeechModelCatalogEntry = Omit<SpeechModel, 'voices'> & { voices: Array<SpeechModel['voices'][number] & { previewAvailable?: boolean; referenceAvailable?: boolean; watermarkAvailable?: boolean }> }
export type PublicSpeechModel = Omit<SpeechModelCatalogEntry, 'providerConnectionId' | 'upstreamModelId'>
export const speechRequestSchema = z.object({
  requestId: z.string().uuid(),
  modelId: z.string().min(1).max(120),
  input: z.string().min(1).max(SPEECH_REQUEST_MAX_INPUT_LENGTH),
  voice: z.string().min(1).max(200),
  instructions: z.string().max(SPEECH_MAX_INSTRUCTIONS_LENGTH).optional(),
  speed: z.number().min(0.25).max(4).optional(),
  playbackOffsetSeconds: z.number().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
}).strict()
export type SpeechRequest = z.infer<typeof speechRequestSchema>

export const OPENAI_SPEECH_PRESET = {
  adapter: 'openai',
  name: 'GPT-4o mini TTS', upstreamModelId: 'gpt-4o-mini-tts', enabled: false, sortOrder: 0,
  voices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse', 'marin', 'cedar'].map(id => ({ id, label: id })),
  defaultVoice: 'coral', supportsInstructions: true, supportsSpeed: true, speedMin: 0.25, speedMax: 4,
  maxInputCharacters: 4096, maxInputTokens: 2000, responseFormat: 'mp3', supportsSse: true,
  billUsers: false, billingUnit: 'tokens', inputPriceMicros: 600000, outputPriceMicros: 12000000,
  characterPriceMicros: 0, minutePriceMicros: 0,
} satisfies Omit<SpeechModel, 'id' | 'providerConnectionId'>

export const VOXTRAL_SPEECH_PRESET = {
  ...OPENAI_SPEECH_PRESET, adapter: 'mistral', name: 'Voxtral TTS', upstreamModelId: 'voxtral-mini-tts-2603',
  voices: [], defaultVoice: '', supportsInstructions: false, supportsSpeed: false, supportsSse: false,
  // A conservative batching default, not a claimed upstream hard limit.
  maxInputCharacters: 1500, maxInputTokens: null, billingUnit: 'characters', inputPriceMicros: 0, outputPriceMicros: 0,
} satisfies Omit<SpeechModel, 'id' | 'providerConnectionId'>

export function speechPriceLabel(model: PublicSpeechModel): string {
  const usd = (micros: number) => `$${micros / 1e6}`
  if (!model.billUsers) return 'Free to use'
  if (model.billingUnit === 'tokens') return `${usd(model.inputPriceMicros)} / 1M input text tokens · ${usd(model.outputPriceMicros)} / 1M output audio tokens`
  if (model.billingUnit === 'characters') return `${usd(model.characterPriceMicros)} / 1,000 characters`
  return `${usd(model.minutePriceMicros)} / generated audio minute`
}
