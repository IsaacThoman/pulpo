import { describe, expect, it } from 'vitest'
import { managementAccountSettingsSchema } from './index.js'
import { OPENAI_SPEECH_PRESET, speechModelSchema, speechPreferencesSchema, speechRequestSchema } from './speech.js'
const model = { ...OPENAI_SPEECH_PRESET, id: 'openai-tts', providerConnectionId: '11111111-1111-4111-8111-111111111111' }
describe('speech contracts', () => {
  it('preserves speech preferences in management account documents', () => {
    const speech = { modelId: 'openai-tts', models: { 'openai-tts': { voice: 'coral', speed: 1.2, instructions: 'Speak slowly.' } } }
    expect(managementAccountSettingsSchema.parse({ username: 'tester', speech }).speech).toEqual(speech)
    expect(speechPreferencesSchema.parse(undefined)).toEqual({ modelId: null, models: {} })
  })
  it('requires valid voices, defaults, and SSE for token billing', () => {
    expect(speechModelSchema.parse(model).enabled).toBe(false)
    expect(speechModelSchema.safeParse({ ...model, defaultVoice: 'unknown' }).success).toBe(false)
    expect(speechModelSchema.safeParse({ ...model, voices: [model.voices[0], model.voices[0]] }).success).toBe(false)
    expect(speechModelSchema.safeParse({ ...model, supportsSse: false, billUsers: true }).success).toBe(false)
    expect(speechModelSchema.safeParse({ ...model, inputPriceMicros: -1 }).success).toBe(false)
  })
  it('allows provider-specific character and token limits while requiring positive safe integers', () => {
    for (const limit of [1, 32, 8192, 100_000, Number.MAX_SAFE_INTEGER]) {
      expect(speechModelSchema.parse({ ...model, maxInputCharacters: limit, maxInputTokens: limit })).toMatchObject({ maxInputCharacters: limit, maxInputTokens: limit })
    }
    for (const limit of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      for (const key of ['maxInputCharacters', 'maxInputTokens']) expect(speechModelSchema.safeParse({ ...model, [key]: limit }).success).toBe(false)
    }
    expect(speechModelSchema.parse({ ...model, maxInputCharacters: undefined, maxInputTokens: null })).toMatchObject({ maxInputCharacters: 4096, maxInputTokens: null })
  })
  it('rejects invalid settings and untrusted generation options', () => {
    expect(speechPreferencesSchema.safeParse({ models: { a: { speed: 6 } } }).success).toBe(false)
    expect(speechRequestSchema.safeParse({ requestId: '22222222-2222-4222-8222-222222222222', modelId: 'm', input: 'Hello', voice: 'coral', apiKey: 'client-key' }).success).toBe(false)
  })
})
