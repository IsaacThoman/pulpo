import { expect, it } from 'vitest'
import { IMAGE_MODEL_PRESETS, imageModelSchema, imageGenerationPreferencesSchema, imageGenerationInputSchema, managementAccountSettingsSchema } from './index.js'
it('defaults to disabled and preserves selection in management account settings', () => {
  expect(imageGenerationPreferencesSchema.parse(undefined)).toEqual({ enabled: false, modelId: null })
  const imageGeneration = { enabled: true, modelId: 'muse' }
  expect(managementAccountSettingsSchema.parse({ username: 'tester', imageGeneration }).imageGeneration).toEqual(imageGeneration)
})
it('provides disabled presets and validates prices and binding', () => {
  for (const preset of Object.values(IMAGE_MODEL_PRESETS)) {
    const value = { ...preset, id: 'image', providerConnectionId: '11111111-1111-4111-8111-111111111111' }
    expect(imageModelSchema.parse(value).enabled).toBe(false)
    expect(imageModelSchema.safeParse({ ...value, imagePriceMicros: -1 }).success).toBe(false)
    expect(imageModelSchema.safeParse({ ...value, imagePriceMicros: 0.5 }).success).toBe(false)
  }
})
it('allows text and typed references, never client-selected providers or arbitrary URLs', () => {
  expect(imageGenerationInputSchema.parse({ prompt: 'Paint a fox', referenceImages: [{ path: '/workspace/reference.png' }] }).prompt).toBe('Paint a fox')
  for (const patch of [{ modelId: 'override' }, { apiKey: 'secret' }, { referenceImages: [{ url: 'https://example.com' }] }, { prompt: ' ' }]) {
    expect(imageGenerationInputSchema.safeParse({ prompt: 'Paint a fox', ...patch }).success).toBe(false)
  }
})
