import { expect, it } from 'vitest'
import { IMAGE_MODEL_PRESETS, imageModelSchema, imageGenerationPreferencesSchema, imageGenerationInputSchema, managementAccountSettingsSchema, supportsMaiAutoAspectRatio } from './index.js'
it('accepts optional automatic, square, landscape and portrait framing', () => {
  for (const aspectRatio of [undefined, 'auto', '1:1', '3:2', '2:3']) {
    expect(imageGenerationInputSchema.parse({ prompt: 'Paint a fox', aspectRatio }).aspectRatio).toBe(aspectRatio)
  }
  for (const aspectRatio of ['landscape', '0:1', '1024x1024', 1, null]) {
    expect(imageGenerationInputSchema.safeParse({ prompt: 'Paint a fox', aspectRatio }).success).toBe(false)
  }
})
it('recognizes existing MAI 2.6 models and supports explicit deployment capability overrides', () => {
  const model = imageModelSchema.parse({ ...IMAGE_MODEL_PRESETS['azure-mai'], id: 'mai', providerConnectionId: '11111111-1111-4111-8111-111111111111', supportsAutoAspectRatio: undefined })
  expect(supportsMaiAutoAspectRatio(model)).toBe(true)
  expect(supportsMaiAutoAspectRatio({ ...model, upstreamModelId: 'custom-deployment' })).toBe(true)
  expect(supportsMaiAutoAspectRatio({ ...model, name: 'Custom', upstreamModelId: 'MAI-Image-2.6' })).toBe(true)
  expect(supportsMaiAutoAspectRatio({ ...model, upstreamModelId: 'MAI-Image-2.5' })).toBe(false)
  expect(supportsMaiAutoAspectRatio({ ...model, name: 'Custom', upstreamModelId: 'custom' })).toBe(false)
  expect(supportsMaiAutoAspectRatio({ ...model, name: 'Custom', upstreamModelId: 'custom', supportsAutoAspectRatio: true })).toBe(true)
  expect(supportsMaiAutoAspectRatio({ ...model, supportsAutoAspectRatio: false })).toBe(false)
  expect(supportsMaiAutoAspectRatio({ ...model, adapter: 'meta-muse', supportsAutoAspectRatio: true })).toBe(false)
})
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
