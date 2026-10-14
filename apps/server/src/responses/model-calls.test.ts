import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../lib/errors.js'

const extendBudgetReservationFixedCost = vi.hoisted(() => vi.fn())
const releaseBudgetReservationFixedCost = vi.hoisted(() => vi.fn())
const getActivePricing = vi.hoisted(() => vi.fn())

vi.mock('../accounting/service.js', () => ({
  extendBudgetReservationFixedCost,
  releaseBudgetReservationFixedCost,
  getActivePricing,
}))
vi.mock('../database/client.js', () => ({
  db: {
    insert: () => ({ values: async () => undefined }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}))
vi.mock('../logging/provider-diagnostics.js', () => ({
  withDiagnosticContext: (_context: unknown, fn: () => unknown) => fn(),
  recordReconstructedDiagnostic: vi.fn(),
}))
vi.mock('./fallback-policy.js', () => ({ classifyGenerationError: () => 'provider_error' }))

import { isInsufficientBalanceError, modelCallUsage, providerReportedCostMicros, reserveInternalModelCall, trackBilledInternalModelCall } from './model-calls.js'

// 1 micro per input token and 2 per output token.
const pricing = {
  id: 'pricing',
  inputPriceMicros: 1_000_000,
  cachedInputPriceMicros: 0,
  cacheWritePriceMicros: 0,
  outputPriceMicros: 2_000_000,
  perRequestPriceMicros: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  extendBudgetReservationFixedCost.mockReset()
  releaseBudgetReservationFixedCost.mockReset()
  getActivePricing.mockReset()
})

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

  it('returns the micros it held', async () => {
    getActivePricing.mockResolvedValue(pricing)
    extendBudgetReservationFixedCost.mockResolvedValue(undefined)
    // '"compact this"' is 14 characters, so 4 input micros plus 16 output tokens at 2 micros.
    await expect(reserveInternalModelCall({
      responseId: 'response-1',
      modelId: 'model-1',
      requestInput: 'compact this',
      maxOutputTokens: 16,
    })).resolves.toBe(36)
    expect(extendBudgetReservationFixedCost).toHaveBeenCalledWith('response-1', 36)
  })

  it('skips optional sidecar holds when the user cannot cover them', async () => {
    getActivePricing.mockResolvedValue(pricing)
    extendBudgetReservationFixedCost.mockRejectedValue(new AppError(402, 'insufficient_balance', 'Insufficient balance'))
    await expect(reserveInternalModelCall({
      responseId: 'response-1',
      modelId: 'model-1',
      requestInput: 'title please',
      maxOutputTokens: 16,
    })).resolves.toBeNull()
    await expect(reserveInternalModelCall({
      responseId: 'response-1',
      modelId: 'model-1',
      requestInput: 'compact this',
      maxOutputTokens: 16,
      required: true,
    })).rejects.toMatchObject({ code: 'insufficient_balance' })
  })
})

describe('billed internal model calls', () => {
  const call = (invoke: () => Promise<{ id: string; usage: unknown }>) => trackBilledInternalModelCall({
    responseId: 'response-1',
    requestLogId: 'log-1',
    modelId: 'model-1',
    upstreamModelId: 'upstream-1',
    purpose: 'compaction',
    requestInput: 'compact this',
    maxOutputTokens: 16,
    required: true,
    invoke,
  })

  it('gives back exactly its own hold when the call fails and rethrows the original error', async () => {
    getActivePricing.mockResolvedValue(pricing)
    extendBudgetReservationFixedCost.mockResolvedValue(undefined)
    releaseBudgetReservationFixedCost.mockResolvedValue(undefined)
    const overflow = new Error('summary request exceeds the context window')
    await expect(call(async () => { throw overflow })).rejects.toBe(overflow)
    expect(extendBudgetReservationFixedCost).toHaveBeenCalledWith('response-1', 36)
    expect(releaseBudgetReservationFixedCost).toHaveBeenCalledExactlyOnceWith('response-1', 36)
  })

  it('keeps the hold for a successful call it will bill', async () => {
    getActivePricing.mockResolvedValue(pricing)
    extendBudgetReservationFixedCost.mockResolvedValue(undefined)
    const billed = await call(async () => ({ id: 'summary', usage: { input_tokens: 4, output_tokens: 10 } }))
    expect(billed).toMatchObject({ costMicros: 24 })
    expect(releaseBudgetReservationFixedCost).not.toHaveBeenCalled()
  })

  it('does not release a hold it never placed', async () => {
    getActivePricing.mockResolvedValue(pricing)
    extendBudgetReservationFixedCost.mockRejectedValue(new AppError(402, 'insufficient_balance', 'Insufficient balance'))
    const invoke = vi.fn()
    await expect(call(invoke)).rejects.toMatchObject({ code: 'insufficient_balance' })
    expect(invoke).not.toHaveBeenCalled()
    expect(releaseBudgetReservationFixedCost).not.toHaveBeenCalled()
  })

  it('logs a failed release and still surfaces the call error', async () => {
    getActivePricing.mockResolvedValue(pricing)
    extendBudgetReservationFixedCost.mockResolvedValue(undefined)
    releaseBudgetReservationFixedCost.mockRejectedValue(new AppError(409, 'reservation_missing', 'Budget reservation is unavailable'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const overflow = new Error('summary request exceeds the context window')
    try {
      await expect(call(async () => { throw overflow })).rejects.toBe(overflow)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('billing.release_failed'))
    } finally {
      warn.mockRestore()
    }
  })

  it('lets repeated failed attempts fit a balance that covers only one call', async () => {
    getActivePricing.mockResolvedValue(pricing)
    // Capacity for the base hold plus one 36-micro attempt, but not two.
    const capacityMicros = 100 + 36 + 20
    let heldMicros = 100
    extendBudgetReservationFixedCost.mockImplementation(async (_responseId: string, micros: number) => {
      if (heldMicros + micros > capacityMicros) throw new AppError(402, 'insufficient_balance', 'Insufficient balance')
      heldMicros += micros
    })
    releaseBudgetReservationFixedCost.mockImplementation(async (_responseId: string, micros: number) => {
      heldMicros = Math.max(0, heldMicros - micros)
    })
    const overflow = new Error('summary request exceeds the context window')
    for (let attempt = 0; attempt < 4; attempt++) {
      await expect(call(async () => { throw overflow })).rejects.toBe(overflow)
      expect(heldMicros).toBe(100)
    }
    await expect(call(async () => ({ id: 'summary', usage: { input_tokens: 4, output_tokens: 10 } }))).resolves.toMatchObject({ costMicros: 24 })
    expect(heldMicros).toBe(136)
  })
})
