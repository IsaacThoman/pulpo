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

it('defaults legacy models to flat prices and requires complete token pricing when billing', () => {
  const legacy = { id: 'image', providerConnectionId: '11111111-1111-4111-8111-111111111111', adapter: 'meta-muse', name: 'Image', upstreamModelId: 'image', billUsers: true, imagePriceMicros: 42 }
  expect(imageModelSchema.parse(legacy)).toMatchObject({ billingUnit: 'images', imagePriceMicros: 42, reservationMicros: 0 })
  const token = { ...legacy, billingUnit: 'tokens', reservationMicros: 100, tokenPrices: { input: 0, cachedInput: 0, output: 0 } }
  expect(imageModelSchema.safeParse(token).success).toBe(true)
  for (const patch of [{ reservationMicros: 0 }, { tokenPrices: {} }, { tokenPrices: { input: -1, cachedInput: 0, output: 1 } }, { adapter: 'azure-mai' }]) {
    expect(imageModelSchema.safeParse({ ...token, ...patch }).success).toBe(false)
  }
})

it('normalizes workspace path shorthand and preserves typed references and order', () => {
  const attachment = { attachmentId: '11111111-1111-4111-8111-111111111111' }
  const path = { path: '/workspace/typed.png' }
  const input = { prompt: 'Edit', referenceImages: ['/workspace/my photo.jpeg', attachment, path] }
  expect(imageGenerationInputSchema.parse(input).referenceImages).toEqual([{ path: '/workspace/my photo.jpeg' }, attachment, path])
  expect(input.referenceImages[0]).toBe('/workspace/my photo.jpeg')
})

it('rejects ambiguous or unsupported shorthand without relaxing object validation', () => {
  for (const reference of ['', '/workspace/', 'photo.jpeg', '/etc/photo.jpeg', 'https://example.com/photo.jpeg', 'file:///workspace/photo.jpeg',
    '11111111-1111-4111-8111-111111111111', '/workspace/a\0.jpg', '/workspace/' + 'x'.repeat(4086), null, 42,
    { path: '/workspace/photo.jpeg', url: 'https://example.com' }, { attachmentId: '11111111-1111-4111-8111-111111111111', path: '/workspace/photo.jpeg' }]) {
    expect(imageGenerationInputSchema.safeParse({ prompt: 'Edit', referenceImages: [reference] }).success).toBe(false)
  }
  expect(imageGenerationInputSchema.safeParse({ prompt: 'Edit', referenceImages: Array(5).fill('/workspace/photo.jpeg') }).success).toBe(false)
  expect(imageGenerationInputSchema.parse({ prompt: 'Edit', referenceImages: ['/workspace/' + 'x'.repeat(4085)] }).referenceImages).toHaveLength(1)
})
