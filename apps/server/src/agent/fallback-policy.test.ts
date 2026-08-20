import type { AssistantMessage } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import { assistantMessageHasOutput, canFallbackAgentTurn, nextAgentRetryAttempt, resolveStickyFallbackIndex } from './fallback-policy.js'

function failed(content: AssistantMessage['content'] = [], errorMessage = '429 resource unavailable'): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'openai-responses',
    provider: 'openai',
    model: 'gpt-flex',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'error',
    errorMessage,
    timestamp: Date.now(),
  }
}

describe('Agent fallback policy', () => {
  it('advances explicit retry attempts only while retries remain', () => {
    const message = failed([], 'Provider overloaded')
    expect(nextAgentRetryAttempt({ message, currentAttempt: 1, maxRetries: 2, outputStarted: false, cancellationRequested: false })).toBe(2)
    expect(nextAgentRetryAttempt({ message, currentAttempt: 3, maxRetries: 2, outputStarted: false, cancellationRequested: false })).toBeUndefined()
  })

  it('does not retry after output or cancellation', () => {
    const message = failed([], 'Provider overloaded')
    expect(nextAgentRetryAttempt({ message, currentAttempt: 1, maxRetries: 2, outputStarted: true, cancellationRequested: false })).toBeUndefined()
    expect(nextAgentRetryAttempt({ message, currentAttempt: 1, maxRetries: 2, outputStarted: false, cancellationRequested: true })).toBeUndefined()
  })
  it('starts directly on the first non-sticky fallback model', async () => {
    const sticky = new Set(['flex', 'flex-backup'])
    await expect(resolveStickyFallbackIndex(
      ['flex', 'flex-backup', 'standard'],
      0,
      async (modelId) => sticky.has(modelId),
    )).resolves.toEqual({ index: 2, stickyUsed: true })
  })

  it('falls back immediately for an eligible no-output provider failure', () => {
    const overloaded = failed([], "We're currently processing too many requests — please try again later.")
    expect(canFallbackAgentTurn({ message: overloaded, outputStarted: false, cancellationRequested: false, contextRetryAttempted: false })).toBe(true)
  })

  it('protects both text and reasoning output', () => {
    const text = failed([{ type: 'text', text: 'partial' }])
    const reasoning = failed([{ type: 'thinking', thinking: 'partial' }])
    expect(assistantMessageHasOutput(text)).toBe(true)
    expect(assistantMessageHasOutput(reasoning)).toBe(true)
    expect(canFallbackAgentTurn({ message: text, outputStarted: false, cancellationRequested: false, contextRetryAttempted: false })).toBe(false)
    expect(canFallbackAgentTurn({ message: reasoning, outputStarted: false, cancellationRequested: false, contextRetryAttempted: false })).toBe(false)
  })

  it('does not treat cancellation, compaction, or context overflow as provider fallback events', () => {
    expect(canFallbackAgentTurn({ message: failed(), outputStarted: false, cancellationRequested: true, contextRetryAttempted: false })).toBe(false)
    expect(canFallbackAgentTurn({ message: failed([], 'Compaction request failed'), outputStarted: false, cancellationRequested: false, contextRetryAttempted: false })).toBe(false)
    expect(canFallbackAgentTurn({ message: failed([], 'Maximum context length exceeded'), outputStarted: false, cancellationRequested: false, contextRetryAttempted: false })).toBe(false)
    expect(canFallbackAgentTurn({ message: failed([], 'context_length_exceeded'), outputStarted: false, cancellationRequested: false, contextRetryAttempted: false })).toBe(false)
    expect(canFallbackAgentTurn({ message: failed(), outputStarted: false, cancellationRequested: false, contextRetryAttempted: true })).toBe(false)
  })
})
