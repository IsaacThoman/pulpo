import { describe, expect, it } from 'vitest'
import type { AssistantMessage, Context } from '@earendil-works/pi-ai'
import {
  AGENT_CONTEXT_SAFETY_TOKENS,
  effectiveAgentCompactionThreshold,
  estimateAgentContextTokens,
  shouldRetryContextOverflow,
} from './context-budget.js'
import { buildAgentSystemPrompt } from './policy.js'

function overflowMessage(text = ''): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-responses',
    provider: 'openai',
    model: 'model',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'error',
    errorMessage: '400 Your input exceeds the context window of this model.',
    timestamp: Date.now(),
  }
}

describe('agent context budget', () => {
  it('clamps configured thresholds to the model context safety limit', () => {
    expect(effectiveAgentCompactionThreshold(180_000, 128_000)).toBe(128_000 - AGENT_CONTEXT_SAFETY_TOKENS)
    expect(effectiveAgentCompactionThreshold(90_000, 128_000)).toBe(90_000)
  })

  it('estimates the complete transformed context including tools and OCR text', () => {
    const base: Context = { systemPrompt: 'system', messages: [{ role: 'user', content: 'question', timestamp: 1 }] }
    const expanded: Context = {
      ...base,
      messages: [{ role: 'user', content: `${'OCR '.repeat(2_000)}question`, timestamp: 1 }],
      tools: [{ name: 'search', description: 'Search '.repeat(500), parameters: { type: 'object' } } as NonNullable<Context['tools']>[number]],
    }
    expect(estimateAgentContextTokens(expanded)).toBeGreaterThan(estimateAgentContextTokens(base))
  })

  it('includes account custom instructions in the Agent context budget', () => {
    const base: Context = {
      systemPrompt: buildAgentSystemPrompt('Model policy', 'Agent policy'),
      messages: [{ role: 'user', content: 'question', timestamp: 1 }],
    }
    const personalized: Context = {
      ...base,
      systemPrompt: buildAgentSystemPrompt('Model policy', 'Agent policy', 'Use terse answers. '.repeat(200)),
    }
    expect(estimateAgentContextTokens(personalized)).toBeGreaterThan(estimateAgentContextTokens(base))
  })

  it('uses a bounded estimate for un-intercepted image bytes', () => {
    const smallImage: Context = { messages: [{ role: 'user', content: [{ type: 'image', data: 'a', mimeType: 'image/png' }], timestamp: 1 }] }
    const largeImage: Context = { messages: [{ role: 'user', content: [{ type: 'image', data: 'a'.repeat(1_000_000), mimeType: 'image/png' }], timestamp: 1 }] }
    expect(estimateAgentContextTokens(largeImage)).toBe(estimateAgentContextTokens(smallImage))
  })

  it('retries only the first empty context overflow', () => {
    expect(shouldRetryContextOverflow(overflowMessage(), 128_000, false)).toBe(true)
    expect(shouldRetryContextOverflow(overflowMessage('partial answer'), 128_000, false)).toBe(false)
    expect(shouldRetryContextOverflow(overflowMessage(), 128_000, true)).toBe(false)
  })
})
