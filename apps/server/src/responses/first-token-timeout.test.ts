import { afterEach, describe, expect, it, vi } from 'vitest'
import { firstTokenTimeout } from './first-token-timeout.js'
import { canFallbackAfterGenerationError, classifyGenerationError, GenerationAttemptError, primaryModelAttemptLimit } from './fallback-policy.js'

afterEach(() => vi.useRealTimers())

describe('first-token timeout', () => {
  it.each([
    ['response.reasoning_summary_text.delta', { delta: 'Thinking' }],
    ['response.reasoning_text.delta', { delta: 'Thinking' }],
    ['response.output_text.delta', { delta: 'Hello' }],
    ['response.refusal.delta', { delta: 'Cannot help' }],
    ['response.function_call_arguments.delta', { delta: '{' }],
    ['response.output_item.added', { item: { type: 'function_call', name: 'lookup', arguments: '' } }],
  ])('allows %s to continue past the first-token deadline', (type, event) => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const timeout = firstTokenTimeout(controller, 15_000)
    vi.advanceTimersByTime(14_000)
    const started = timeout.observe(type, event, [])
    vi.advanceTimersByTime(120_000)
    expect(started).toBe(true)
    expect(controller.signal.aborted).toBe(false)
    expect(() => timeout.throwIfTimedOut()).not.toThrow()
    expect(canFallbackAfterGenerationError(new GenerationAttemptError('Later network error', started))).toBe(false)
    timeout.clear()
  })

  it('recognizes reasoning supplied in the response projection', () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const timeout = firstTokenTimeout(controller, 15_000)
    expect(timeout.observe('response.in_progress', {}, [
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Thinking' }] },
    ])).toBe(true)
    vi.advanceTimersByTime(15_000)
    expect(controller.signal.aborted).toBe(false)
  })

  it('preserves the timeout after a silent stream exit and permits configured retries', () => {
    vi.useFakeTimers()
    for (let attempt = 0; attempt < primaryModelAttemptLimit({ maxRetries: 5, fallbackModelId: null }); attempt++) {
      const controller = new AbortController()
      const timeout = firstTokenTimeout(controller, 15_000)
      expect(timeout.observe('response.created', {}, [])).toBe(false)
      expect(timeout.observe('response.content_part.added', { part: { type: 'output_text', text: '' } }, [])).toBe(false)
      expect(timeout.observe('response.reasoning_text.delta', { delta: '' }, [])).toBe(false)
      vi.advanceTimersByTime(15_000)
      // Stream termination/cleanup must not erase the reason for the abort.
      timeout.clear()
      expect(controller.signal.reason).toBe(timeout.error)
      expect(() => timeout.throwIfTimedOut()).toThrow('First-token timeout')
      const failure = new GenerationAttemptError(timeout.error!.message, false, timeout.error)
      expect(classifyGenerationError(failure)).toBe('timeout')
      expect(canFallbackAfterGenerationError(failure)).toBe(true)
    }
  })

  it('does not abort after cleanup or when disabled', () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const timeout = firstTokenTimeout(controller, 15_000)
    timeout.clear()
    const disabled = firstTokenTimeout(controller)
    vi.advanceTimersByTime(120_000)
    expect(controller.signal.aborted).toBe(false)
    expect(disabled.error).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })
})
