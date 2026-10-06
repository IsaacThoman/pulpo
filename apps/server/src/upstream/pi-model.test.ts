import { describe, expect, it, vi } from 'vitest'

vi.mock('../config.js', () => ({ getConfig: () => ({ ENCRYPTION_KEY: 'a sufficiently long deployment master key for tests' }) }))

import { chatCompletionsSamplingParameters, piModelForProvider } from './pi-model.js'

const model = { upstreamModelId: 'claude-opus-4-6', name: 'Opus', contextWindow: 200_000, maxOutputTokens: 32_000 }

describe('piModelForProvider', () => {
  it('builds an Anthropic Messages model with capability-based compat', () => {
    const pi = piModelForProvider(model, { apiFormat: 'anthropic_messages', baseUrl: 'https://api.anthropic.com/v1/' })
    expect(pi).toMatchObject({
      id: 'claude-opus-4-6', name: 'Opus', api: 'anthropic-messages', provider: 'anthropic', baseUrl: 'https://api.anthropic.com',
      reasoning: true, input: ['text', 'image'], contextWindow: 200_000, maxTokens: 32_000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { forceAdaptiveThinking: true, supportsTemperature: true },
      thinkingLevelMap: { xhigh: 'high', max: 'max' },
    })
    const modern = piModelForProvider({ ...model, upstreamModelId: 'claude-opus-4-7' }, { apiFormat: 'anthropic_messages', baseUrl: 'https://x/v1' })
    expect(modern).toMatchObject({ compat: { forceAdaptiveThinking: true, supportsTemperature: false }, thinkingLevelMap: { xhigh: 'xhigh', max: 'max' } })
    const legacy = piModelForProvider({ ...model, upstreamModelId: 'claude-haiku-4-5' }, { apiFormat: 'anthropic_messages', baseUrl: 'https://x/v1' })
    expect(legacy).toMatchObject({ compat: { forceAdaptiveThinking: false, supportsTemperature: true }, thinkingLevelMap: { xhigh: 'high', max: 'high' } })
  })

  it('builds Chat Completions and Responses models with the base URL unchanged', () => {
    expect(piModelForProvider(model, { apiFormat: 'openai_chat_completions', baseUrl: 'https://openrouter.ai/api/v1' }))
      .toMatchObject({ api: 'openai-completions', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1' })
    expect(piModelForProvider(model, { apiFormat: 'openai_responses', baseUrl: 'https://api.openai.com/v1' }))
      .toMatchObject({ api: 'openai-responses', provider: 'openai', baseUrl: 'https://api.openai.com/v1' })
    expect(piModelForProvider(model, { apiFormat: 'bogus' as never, baseUrl: 'https://api.openai.com/v1' }).api).toBe('openai-responses')
  })
})

describe('chatCompletionsSamplingParameters', () => {
  it('keeps shared sampling keys and drops Responses-only ones', () => {
    expect(chatCompletionsSamplingParameters({
      temperature: 0.4, top_p: 0.8, top_k: 20, service_tier: 'flex', parallel_tool_calls: false,
      max_output_tokens: 100, reasoning: { effort: 'high' }, include: ['x'], text: { verbosity: 'low' },
      store: false, truncation: 'auto', safety_identifier: undefined,
    })).toEqual({ temperature: 0.4, top_p: 0.8, top_k: 20, service_tier: 'flex', parallel_tool_calls: false })
  })
})
