import { describe, expect, it } from 'vitest'
import { imageModelSchema, OPENAI_IMAGE_PRESET, META_MUSE_IMAGE_PRESET, AZURE_MAI_IMAGE_PRESET, type ImageModel } from '@pulpo/contracts'
import { imageCost, imageReservation, parseImageUsage } from './pricing.js'
const model = (patch: Partial<ImageModel> = {}) => imageModelSchema.parse({ ...OPENAI_IMAGE_PRESET, id: 'image', providerConnectionId: '11111111-1111-4111-8111-111111111111', billUsers: true, billingUnit: 'tokens', reservationMicros: 100_000, ...patch })
const raw = { input_tokens: 3000, input_tokens_details: { text_tokens: 1000, image_tokens: 2000 }, output_tokens: 100, total_tokens: 3100 }

describe('image token accounting', () => {
  it('bills text and image input separately and treats legacy Images output as image tokens', () => {
    expect(imageCost(model(), parseImageUsage(raw))).toBe(24_000)
    expect(imageReservation(model())).toBe(100_000)
  })
  it('replaces cached input charges, splits output, and rounds only the combined amount', () => {
    const usage = parseImageUsage({ input_tokens: 40, output_tokens: 10, total_tokens: 50,
      input_tokens_details: { text_tokens: 10, image_tokens: 30, cached_tokens: 14, cached_tokens_details: { text_tokens: 4, image_tokens: 10 } },
      output_tokens_details: { text_tokens: 2, image_tokens: 8 },
    })
    expect(imageCost(model({ tokenPrices: { input: 5_000_000, cachedInput: 1_000_000, imageInput: 8_000_000, cachedImageInput: 2_000_000, output: 2_000_000, imageOutput: 30_000_000 } }), usage)).toBe(458)
    expect(imageCost(model({ tokenPrices: { input: 1, cachedInput: 1, imageInput: 1, cachedImageInput: 1, output: 1, imageOutput: 1 } }), usage)).toBe(1)
  })
  it('only infers aggregate cache attribution for a single input modality', () => {
    const usage = (text: number, image: number) => parseImageUsage({ input_tokens: 100, output_tokens: 0, total_tokens: 100, input_tokens_details: { text_tokens: text, image_tokens: image, cached_tokens: 40 } })
    expect(imageCost(model(), usage(100, 0))).toBe(350)
    expect(imageCost(model(), usage(0, 100))).toBe(560)
    expect(() => imageCost(model(), usage(50, 50))).toThrow('invalid token usage')
  })
  it('bills Meta combined input and output, including reasoning exactly once', () => {
    const meta = model({ ...META_MUSE_IMAGE_PRESET, billUsers: true, billingUnit: 'tokens', reservationMicros: 100,
      tokenPrices: { ...META_MUSE_IMAGE_PRESET.tokenPrices, input: 2_000_000, cachedInput: 500_000, output: 10_000_000 } })
    const usage = parseImageUsage({ input_tokens: 9996, input_tokens_details: { cached_tokens: 7936 }, output_tokens: 908, output_tokens_details: { reasoning_tokens: 161 }, total_tokens: 10904 })
    expect(imageCost(meta, usage)).toBe(17_168)
    expect(() => imageCost(meta, { ...usage!, outputDetails: { reasoningTokens: 909 } })).toThrow('invalid token usage')
    expect(() => imageCost(meta, { ...usage!, inputDetails: { textTokens: 2060, imageTokens: 7936, cachedTokens: 7936, cachedDetails: { textTokens: 7936, imageTokens: 0 } } })).toThrow('invalid token usage')
  })
  it.each([
    undefined, {}, { ...raw, input_tokens: -1 }, { ...raw, output_tokens: 0.5 }, { ...raw, input_tokens: '3000' },
    { ...raw, total_tokens: Number.MAX_SAFE_INTEGER + 1 }, { ...raw, total_tokens: 3099 },
    { ...raw, input_tokens_details: undefined }, { ...raw, input_tokens_details: { text_tokens: 1000 } },
    { ...raw, input_tokens_details: { text_tokens: 1000, image_tokens: 1999 } },
    { ...raw, output_tokens_details: { text_tokens: 20, image_tokens: 90 } },
    { ...raw, input_tokens_details: { text_tokens: 1000, image_tokens: 2000, cached_tokens: 3001 } },
    { ...raw, input_tokens_details: { text_tokens: 1000, image_tokens: 2000, cached_tokens: 100, cached_tokens_details: { text_tokens: 100, image_tokens: 1 } } },
    { ...raw, input_tokens_details: { text_tokens: 1000, image_tokens: 2000, cached_tokens: 2000, cached_tokens_details: { text_tokens: 2000, image_tokens: 0 } } },
    { ...raw, input_tokens_details: { text_tokens: 1000, image_tokens: 2000, cached_tokens: -1 } },
  ])('rejects absent, malformed, inconsistent or ambiguous usage: %j', value => {
    expect(() => imageCost(model(), parseImageUsage(value))).toThrow('invalid token usage')
  })
  it('guards against overflow after exact integer calculation', () => {
    const huge = Number.MAX_SAFE_INTEGER - 1
    const usage = { inputTokens: huge, outputTokens: 0, totalTokens: huge, inputDetails: { textTokens: huge, imageTokens: 0 } }
    expect(() => imageCost(model({ tokenPrices: { ...OPENAI_IMAGE_PRESET.tokenPrices, input: 1_000_000_000_000 } }), usage)).toThrow('invalid token usage')
  })
  it('preserves free and legacy flat billing for every provider without usage', () => {
    for (const preset of [AZURE_MAI_IMAGE_PRESET, META_MUSE_IMAGE_PRESET, OPENAI_IMAGE_PRESET]) {
      const flat = model({ ...preset, billUsers: true, imagePriceMicros: 42 })
      const { billingUnit: _unit, tokenPrices: _prices, reservationMicros: _hold, ...legacy } = flat
      expect(imageCost(legacy as ImageModel)).toBe(42)
      expect(imageReservation(flat)).toBe(42)
      expect(imageCost({ ...flat, billUsers: false })).toBe(0)
    }
  })
})
