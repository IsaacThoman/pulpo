import { describe, expect, it } from 'vitest'
import { Agent } from '@earendil-works/pi-agent-core'
import { isContextOverflow, type AssistantMessage, type Model } from '@earendil-works/pi-ai'
import { codexErrorRequiresReauthentication } from '../codex/credential-store.js'
import { CompactionError } from '../compaction/summarize.js'
import { codexContextFailureMessage, contextOverflowErrorMessage, contextOverflowOutcome, isContextFailure, shouldRetryContextOverflow } from './context-budget.js'
import { canFallbackAgentTurn, nextAgentRetryAttempt } from './fallback-policy.js'

function overflowMessage(text = '', errorMessage = '400 Your input exceeds the context window of this model.'): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-responses',
    provider: 'openai',
    model: 'model',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'error',
    errorMessage,
    timestamp: Date.now(),
  }
}

const model: Model<'openai-responses'> = {
  id: 'test', name: 'Test', api: 'openai-responses', provider: 'test', baseUrl: 'https://example.invalid',
  reasoning: false, input: ['text'], contextWindow: 1_000, maxTokens: 100,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
}

describe('agent context budget', () => {
  it('retries only an empty context overflow that is still allowed', () => {
    expect(shouldRetryContextOverflow(overflowMessage(), 128_000, false)).toBe(true)
    expect(shouldRetryContextOverflow(overflowMessage('partial answer'), 128_000, false)).toBe(false)
    expect(shouldRetryContextOverflow(overflowMessage(), 128_000, true)).toBe(false)
  })

  it('words the pre-send limit so pi-ai classifies it as a context overflow', () => {
    const message = overflowMessage('', contextOverflowErrorMessage(980, 950))
    expect(message.errorMessage).toBe('Request exceeds the context window (estimated size 980, limit 950)')
    expect(isContextOverflow(message, 1_000)).toBe(true)
    expect(shouldRetryContextOverflow(message, 1_000, false)).toBe(true)
    expect(canFallbackAgentTurn({ message, outputStarted: false, cancellationRequested: false, contextRetryAttempted: false })).toBe(false)
  })

  it('recovers when the stream function refuses an oversized request', async () => {
    const agent = new Agent({
      initialState: { model, systemPrompt: 'system' },
      streamFn: () => { throw new Error(contextOverflowErrorMessage(980, 950)) },
    })
    await agent.prompt('hello')
    const last = agent.state.messages.at(-1) as AssistantMessage
    expect(last.stopReason).toBe('error')
    expect(shouldRetryContextOverflow(last, model.contextWindow, false)).toBe(true)
  })

  it('stops on an overflow that cannot be recovered instead of retrying or falling back', () => {
    // Outside the fallback exclusion pattern, so ordinary retry and fallback would otherwise take it.
    const gemini = overflowMessage('', '400 The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)')
    expect(nextAgentRetryAttempt({ message: gemini, currentAttempt: 1, maxAttempts: 3, outputStarted: false, cancellationRequested: false })).toBe(2)
    expect(canFallbackAgentTurn({ message: gemini, outputStarted: false, cancellationRequested: false, contextRetryAttempted: false })).toBe(true)
    // Compaction disabled, or a second overflow before any successful turn.
    expect(contextOverflowOutcome(gemini, { contextWindow: 128_000, outputStarted: false, recoveryAllowed: false })).toBe('stop')
    expect(contextOverflowOutcome(gemini, { contextWindow: 128_000, outputStarted: false, recoveryAllowed: true })).toBe('recover')
    expect(contextOverflowOutcome(overflowMessage('partial answer'), { contextWindow: 128_000, outputStarted: false, recoveryAllowed: false })).toBeUndefined()
    expect(contextOverflowOutcome(gemini, { contextWindow: 128_000, outputStarted: true, recoveryAllowed: false })).toBeUndefined()
    expect(contextOverflowOutcome(overflowMessage('', '503 upstream unavailable'), { contextWindow: 128_000, outputStarted: false, recoveryAllowed: true })).toBeUndefined()
  })

  it('keeps compaction and overflow failures away from the Codex reauthentication check', () => {
    const preSend = contextOverflowErrorMessage(300_000, 258_400)
    const noProgress = 'Context compaction did not shrink the context (111397 to 111532)'
    for (const text of [preSend, noProgress]) {
      expect(text).not.toMatch(/token/i)
      expect(codexErrorRequiresReauthentication(new Error(text))).toBe(false)
    }
    // Thrown directly, or rethrown from a failed turn's error text.
    expect(isContextFailure(new CompactionError(noProgress))).toBe(true)
    expect(isContextFailure(new Error(noProgress))).toBe(true)
    expect(isContextFailure(new Error(preSend))).toBe(true)
    expect(isContextFailure(new Error('Context compaction failed: the conversation does not fit in the model context window'))).toBe(true)
    // Provider overflow texts mention tokens.
    expect(isContextFailure(new Error('400 This model\'s maximum context length is 128000 tokens. However, you requested 130000 tokens'))).toBe(true)
    expect(isContextFailure(new Error('401 Unauthorized: token expired'))).toBe(false)
    expect(isContextFailure(new Error('Rate limit reached: too many tokens per minute'))).toBe(false)
    // Codex shows Pulpo's compaction texts, and a fixed text instead of the provider's overflow text.
    expect(codexContextFailureMessage(new CompactionError(noProgress))).toBe(noProgress)
    expect(codexContextFailureMessage(new Error('400 maximum context length is 272000 tokens'))).toBe('The conversation exceeds the model context window.')
  })
})
