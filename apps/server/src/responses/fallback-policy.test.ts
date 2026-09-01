import { describe, expect, it, vi } from 'vitest'
import {
  GenerationAttemptError,
  canFallbackAfterGenerationError,
  classifyGenerationError,
  completionTokensPerSecond,
  isModelSticky,
  isSlowCompletion,
  markModelSticky,
  modelStickyKey,
} from './fallback-policy.js'

const policy = {
  id: 'gpt-flex',
  fallbackModelId: 'gpt-standard',
  maxRetries: 3,
  stickyFallbackSeconds: 3_600,
  slowStickyEnabled: true,
  slowStickyMinTokensPerSecond: 20,
  slowStickyMinCompletionSeconds: 15,
}

describe('shared model fallback policy', () => {
  it('uses the global sticky key and configured TTL', async () => {
    const store = {
      get: vi.fn(async () => 'slow_completion'),
      set: vi.fn(async () => 'OK'),
    }

    expect(modelStickyKey(policy.id)).toBe('pulpo:model-sticky:gpt-flex')
    await expect(isModelSticky(store, policy.id)).resolves.toBe(true)
    await expect(markModelSticky(store, policy, 'rate_limit')).resolves.toBe(true)
    expect(store.get).toHaveBeenCalledWith('pulpo:model-sticky:gpt-flex')
    expect(store.set).toHaveBeenCalledWith('pulpo:model-sticky:gpt-flex', 'rate_limit', 'EX', 3_600)
  })

  it('does not write a sticky key when its TTL is disabled', async () => {
    const store = { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') }
    await expect(markModelSticky(store, { ...policy, stickyFallbackSeconds: 0 }, 'timeout')).resolves.toBe(false)
    expect(store.set).not.toHaveBeenCalled()
  })

  it('applies the slow-completion duration and throughput boundaries', () => {
    expect(isSlowCompletion(policy, 14_999, 0)).toBe(false)
    expect(isSlowCompletion(policy, 15_000, 299)).toBe(true)
    expect(isSlowCompletion(policy, 15_000, 300)).toBe(false)
    expect(completionTokensPerSecond(15_000, 300)).toBe(20)
  })

  it('classifies retryable and non-retryable failures consistently', () => {
    expect(classifyGenerationError(new Error('429 resource unavailable'))).toBe('rate_limit')
    expect(classifyGenerationError(new Error("We're currently processing too many requests — please try again later."))).toBe('rate_limit')
    expect(classifyGenerationError(new Error('The service is overloaded'))).toBe('rate_limit')
    expect(classifyGenerationError(Object.assign(new Error('Request rejected'), { status: 429 }))).toBe('rate_limit')
    expect(classifyGenerationError(Object.assign(new Error('Request rejected'), { code: 'resource_exhausted' }))).toBe('rate_limit')
    const structured = Object.assign(new Error('Request rejected'), { status: 429 })
    expect(classifyGenerationError(new GenerationAttemptError(structured.message, false, structured))).toBe('rate_limit')
    expect(classifyGenerationError(new Error('upstream returned 503'))).toBe('provider_http')
    expect(canFallbackAfterGenerationError(new Error("We're currently processing too many requests — please try again later."))).toBe(true)
    expect(canFallbackAfterGenerationError(new Error('network connection failed'))).toBe(true)
    expect(canFallbackAfterGenerationError(new Error('invalid reasoning effort'))).toBe(false)
    expect(canFallbackAfterGenerationError(new Error('Generation cancelled'))).toBe(false)
  })

  it('protects attempts once output has started', () => {
    expect(canFallbackAfterGenerationError(new GenerationAttemptError('timeout', true))).toBe(false)
    expect(canFallbackAfterGenerationError(new GenerationAttemptError('timeout', false))).toBe(true)
    expect(canFallbackAfterGenerationError(new Error('timeout'), true)).toBe(false)
  })
})
