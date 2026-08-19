import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../lib/errors.js'

const extendBudgetReservationFixedCost = vi.hoisted(() => vi.fn())
const getActivePricing = vi.hoisted(() => vi.fn())

vi.mock('../accounting/service.js', () => ({
  extendBudgetReservationFixedCost,
  getActivePricing,
}))

import { isInsufficientBalanceError, modelCallUsage, providerReportedCostMicros, reserveInternalModelCall } from './model-calls.js'

describe('model-call usage normalization', () => {
  it('preserves per-turn token details for the admin usage feed', () => {
    expect(modelCallUsage({
      input_tokens: 120,
      input_tokens_details: { cached_tokens: 40, cache_write_tokens: 20 },
      output_tokens: 30,
      output_tokens_details: { reasoning_tokens: 10 },
      total_tokens: 150,
    })).toEqual({ inputTokens: 120, cachedInputTokens: 40, cacheWriteTokens: 20, outputTokens: 30, reasoningTokens: 10, totalTokens: 150 })
  })
})

describe('provider-reported cost normalization', () => {
  it('converts a USD usage cost to integer micros', () => {
    expect(providerReportedCostMicros({ cost: 0.00005 })).toBe(50)
  })

  it('accepts zero but ignores missing, negative, and non-numeric costs', () => {
    expect(providerReportedCostMicros({ cost: 0 })).toBe(0)
    expect(providerReportedCostMicros({})).toBeUndefined()
    expect(providerReportedCostMicros({ cost: -1 })).toBeUndefined()
    expect(providerReportedCostMicros({ cost: 'not-a-number' })).toBeUndefined()
  })
})

describe('internal model-call reservation', () => {
  it('identifies insufficient balance errors', () => {
    expect(isInsufficientBalanceError(new AppError(402, 'insufficient_balance', 'Insufficient balance'))).toBe(true)
    expect(isInsufficientBalanceError(new Error('Insufficient balance'))).toBe(false)
  })

  it('skips optional sidecar holds when the user cannot cover them', async () => {
    getActivePricing.mockResolvedValue({
      id: 'pricing',
      inputPriceMicros: 1_000_000,
      cachedInputPriceMicros: 0,
      cacheWritePriceMicros: 0,
      outputPriceMicros: 2_000_000,
      perRequestPriceMicros: 0,
    })
    extendBudgetReservationFixedCost.mockRejectedValue(new AppError(402, 'insufficient_balance', 'Insufficient balance'))
    await expect(reserveInternalModelCall({
      responseId: 'response-1',
      modelId: 'model-1',
      requestInput: 'title please',
      maxOutputTokens: 16,
    })).resolves.toBe(false)
    await expect(reserveInternalModelCall({
      responseId: 'response-1',
      modelId: 'model-1',
      requestInput: 'compact this',
      maxOutputTokens: 16,
      required: true,
    })).rejects.toMatchObject({ code: 'insufficient_balance' })
  })
})
