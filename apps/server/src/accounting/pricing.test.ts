import { describe, expect, it } from 'vitest'
import {
  availableReservationCapacityMicros,
  budgetOutputReservation,
  calculateCostMicros,
  calculateReservationMicros,
  calculateRollingReservationMicros,
  estimateInputTokens,
  IMAGE_RESERVATION_TOKENS,
  workspaceHoldMicros,
  workspaceUsageMicros,
} from './pricing.js'

const pricing = {
  inputPriceMicros: 2_500_000,
  cachedInputPriceMicros: 1_250_000,
  cacheWritePriceMicros: 3_125_000,
  outputPriceMicros: 10_000_000,
  perRequestPriceMicros: 100,
}

describe('pricing', () => {
  it('separates cache reads, cache writes, and uncached input', () => {
    expect(calculateCostMicros({
      inputTokens: 1_000,
      cachedInputTokens: 400,
      cacheWriteTokens: 200,
      outputTokens: 200,
      reasoningTokens: 50,
      totalTokens: 1_200,
    }, pricing)).toBe(4_225)
  })

  it('does not bill overlapping cache categories twice', () => {
    expect(calculateCostMicros({
      inputTokens: 100,
      cachedInputTokens: 80,
      cacheWriteTokens: 50,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 100,
    }, { ...pricing, perRequestPriceMicros: 0 })).toBe(163)
  })

  it('reserves the configured maximum output cost', () => {
    expect(calculateReservationMicros('hello', 1_000, pricing)).toBeGreaterThanOrEqual(10_000)
  })

  it('retains accrued actual cost plus only the next turn maximum', () => {
    const nextTurnMaximum = calculateReservationMicros(['current context'], 1_000, pricing)

    expect(calculateRollingReservationMicros(4_100, ['current context'], 1_000, pricing)).toBe(4_100 + nextTurnMaximum)
  })

  it('replaces unused prior allowance instead of accumulating it', () => {
    const priorReservation = 50_000
    const accruedActualCost = 4_100
    const nextTurnMaximum = calculateReservationMicros('next turn', 1_000, pricing)
    const resized = calculateRollingReservationMicros(accruedActualCost, 'next turn', 1_000, pricing)

    expect(resized).toBe(accruedActualCost + nextTurnMaximum)
    expect(resized).toBeLessThan(priorReservation + nextTurnMaximum)
  })

  it('makes the current reservation replaceable while preserving other pending reservations', () => {
    expect(availableReservationCapacityMicros(50_000, 30_000, 20_000)).toBe(40_000)
    expect(availableReservationCapacityMicros(50_000, 30_000, 0)).toBe(20_000)
  })

  it('reserves whole workspace minutes for the response timeout', () => {
    expect(workspaceHoldMicros(1_800, 10_000)).toBe(300_000)
    expect(workspaceHoldMicros(61, 10_000)).toBe(20_000)
    expect(workspaceHoldMicros(0, 10_000)).toBe(0)
  })

  it('settles workspace time in whole billed minutes after ready', () => {
    expect(workspaceUsageMicros(1, 10_000)).toBe(10_000)
    expect(workspaceUsageMicros(60_000, 10_000)).toBe(10_000)
    expect(workspaceUsageMicros(60_001, 10_000)).toBe(20_000)
    expect(workspaceUsageMicros(0, 10_000)).toBe(0)
  })

  it('releases unsuccessful fixed-cost allowances on the next resize', () => {
    const reservationIncludingUnbilledTool = 30_000
    const accruedBilledCost = 2_000
    const resized = calculateRollingReservationMicros(accruedBilledCost, 'next turn', 1_000, pricing)

    expect(resized).toBe(accruedBilledCost + calculateReservationMicros('next turn', 1_000, pricing))
    expect(resized).toBeLessThan(reservationIncludingUnbilledTool + calculateReservationMicros('next turn', 1_000, pricing))
  })
})

describe('input token estimate', () => {
  // A 7 MB phone photo as base64: 2.4M characters that providers bill as one image.
  const photo = 'A'.repeat(9_600_000)
  const withoutImage = (input: unknown) => estimateInputTokens(input)

  it('counts plain text by its JSON length', () => {
    expect(estimateInputTokens('hello world!')).toBe(4)
    expect(estimateInputTokens(undefined)).toBe(1)
  })

  it('counts each inline image at most once at the per-image ceiling', () => {
    const toolResult = (data: string) => ({
      role: 'toolResult',
      toolName: 'view_image',
      content: [{ type: 'text', text: 'Viewed /workspace/photo.jpg' }, { type: 'image', data, mimeType: 'image/jpeg' }],
    })
    const context = { systemPrompt: 'You are helpful.', messages: [toolResult(photo), toolResult(photo)] }

    expect(estimateInputTokens(context)).toBe(withoutImage({ ...context, messages: [toolResult(''), toolResult('')] }) + 2 * IMAGE_RESERVATION_TOKENS)
  })

  it('recognizes Anthropic, Gemini, Responses, and Chat Completions image shapes', () => {
    const shapes = [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: photo } },
      { inline_data: { mime_type: 'image/webp', data: photo } },
      { inlineData: { mimeType: 'image/gif', data: photo } },
      { type: 'input_image', image_url: `data:image/jpeg;base64,${photo}` },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${photo}` } },
    ]
    for (const shape of shapes) {
      expect(estimateInputTokens([shape])).toBeLessThan(IMAGE_RESERVATION_TOKENS + 100)
      expect(estimateInputTokens([shape])).toBeGreaterThanOrEqual(IMAGE_RESERVATION_TOKENS)
    }
  })

  it('keeps small images at their encoded size', () => {
    const icon = 'A'.repeat(4_000)
    expect(estimateInputTokens({ type: 'image', data: icon, mimeType: 'image/png' })).toBe(withoutImage({ type: 'image', data: '', mimeType: 'image/png' }) + 1_000)
  })

  it('still counts non-image binary data in full', () => {
    const pdf = { type: 'input_file', file_data: `data:application/pdf;base64,${photo}` }
    expect(estimateInputTokens(pdf)).toBeGreaterThan(photo.length / 4)
    expect(estimateInputTokens({ data: photo, mimeType: 'application/pdf' })).toBeGreaterThan(photo.length / 4)
  })

  it('counts text that only looks like an image in full', () => {
    const disguised = `data:image/png;base64,${photo}`
    expect(estimateInputTokens([{ type: 'input_text', text: disguised }])).toBeGreaterThan(disguised.length / 4)
    expect(estimateInputTokens({ role: 'user', content: [{ type: 'text', text: disguised }] })).toBeGreaterThan(disguised.length / 4)
    expect(estimateInputTokens({ type: 'toolCall', arguments: { data: photo, mimeType: 'image/png' } })).toBeGreaterThan(photo.length / 4)
    expect(estimateInputTokens({ type: 'input_image', note: disguised })).toBeGreaterThan(disguised.length / 4)
  })

  it('reserves an agent turn after viewing two large photos within a small balance', () => {
    const sonnet = { inputPriceMicros: 2_000_000, cachedInputPriceMicros: 200_000, cacheWritePriceMicros: 2_500_000, outputPriceMicros: 10_000_000, perRequestPriceMicros: 0 }
    const messages = [photo, photo].map((data) => ({ role: 'toolResult', toolName: 'view_image', content: [{ type: 'image', data, mimeType: 'image/jpeg' }] }))
    expect(budgetOutputReservation({
      requestInput: { systemPrompt: 'x'.repeat(20_000), messages },
      maxOutputTokens: 128_000,
      minimumOutputReservationTokens: 8_000,
      pricing: sonnet,
      capacityMicros: 4_250_000,
    })).not.toBeNull()
  })
})

describe('budget-aware output reservation', () => {
  const requestInput = 'hello'
  const reserve = (capacityMicros: number, maxOutputTokens = 32_000, accruedCostMicros = 0) =>
    budgetOutputReservation({ requestInput, pricing, capacityMicros, maxOutputTokens, accruedCostMicros })

  it('uses the per-model floor, including floors above or below the default', () => {
    const configured = (minimumOutputReservationTokens: number, maxOutputTokens = 32_000) => budgetOutputReservation({
      requestInput, pricing, maxOutputTokens, minimumOutputReservationTokens,
      capacityMicros: calculateReservationMicros(requestInput, 3_000, pricing),
    })
    expect(configured(1_000)?.maxOutputTokens).toBe(3_000)
    expect(configured(12_000)).toBeNull()
    expect(configured(12_000, 2_000)?.maxOutputTokens).toBe(2_000)
    for (const minimumOutputReservationTokens of [0, -1, 1.5, 2_147_483_648, Number.NaN]) {
      expect(() => configured(minimumOutputReservationTokens)).toThrow('Invalid minimum output reservation')
    }
  })

  it('admits exactly the minimum, rejects one micro less, and fully funds a longer cap', () => {
    const minimum = calculateReservationMicros(requestInput, 8_000, pricing)
    expect(reserve(minimum)).toEqual({ amountMicros: minimum, maxOutputTokens: 8_000 })
    expect(reserve(minimum - 1)).toBeNull()
    const longer = calculateReservationMicros(requestInput, 12_345, pricing)
    expect(reserve(longer + 1)).toEqual({ amountMicros: longer, maxOutputTokens: 12_345 })
  })

  it('honors a smaller client/model ceiling and never forces 8k generation', () => {
    const small = calculateReservationMicros(requestInput, 37, pricing)
    expect(reserve(small, 37)).toEqual({ amountMicros: small, maxOutputTokens: 37 })
    expect(reserve(small - 1, 37)).toBeNull()
    expect(reserve(1_000_000, 37)?.maxOutputTokens).toBe(37)
  })

  it('includes accrued costs, request fees, and worst-case input/cache-write pricing', () => {
    const capacity = calculateReservationMicros(requestInput, 9_000, pricing) + 500
    expect(reserve(capacity, 32_000, 500)).toEqual({ amountMicros: capacity, maxOutputTokens: 9_000 })
    expect(reserve(capacity, 32_000, 20_000)).toBeNull()
  })

  it('supports free output without dividing by zero but still funds input and fees', () => {
    const freeOutput = { ...pricing, outputPriceMicros: 0 }
    const amountMicros = calculateReservationMicros(requestInput, 0, freeOutput)
    expect(budgetOutputReservation({ requestInput, maxOutputTokens: 32_000, pricing: freeOutput, capacityMicros: amountMicros }))
      .toEqual({ amountMicros, maxOutputTokens: 32_000 })
    expect(budgetOutputReservation({ requestInput, maxOutputTokens: 32_000, pricing: freeOutput, capacityMicros: amountMicros - 1 })).toBeNull()
  })

  it('finds a maximal funded cap with fractional-micro token prices and rounding', () => {
    const fractional = { ...pricing, outputPriceMicros: 123_456 }
    for (let capacityMicros = 1_100; capacityMicros < 1_500; capacityMicros += 7) {
      const result = budgetOutputReservation({ requestInput, maxOutputTokens: 32_000, pricing: fractional, capacityMicros })
      if (!result) continue
      expect(result.amountMicros).toBeLessThanOrEqual(capacityMicros)
      expect(calculateReservationMicros(requestInput, result.maxOutputTokens + 1, fractional)).toBeGreaterThan(capacityMicros)
    }
  })
})
