import { describe, expect, it } from 'vitest'
import { providerCacheRequestOptions, providerPromptCacheParameters } from './provider-cache.js'

const identity = { userId: 'user-1', chatId: 'chat-1', runId: 'run-1' }

describe('provider prompt caching', () => {
  it('supports explicit opt-in for a compatible custom proxy and model alias', () => {
    expect(providerPromptCacheParameters('https://proxy.example/v1', 'my-claude', 'enabled'))
      .toEqual({ cache_control: { type: 'ephemeral' } })
  })

  it.each(['auto', 'enabled'] as const)('preserves explicit TTL and unrelated parameters in %s mode', (mode) => {
    const parameters = { cache_control: { type: 'ephemeral', ttl: '1h' }, temperature: 0.5 }
    expect(providerPromptCacheParameters('https://openrouter.ai/api/v1', 'anthropic/claude-sonnet-4.6', mode, parameters))
      .toEqual(parameters)
  })

  it('removes even a custom top-level opt-in when disabled without mutating parameters', () => {
    const parameters = { cache_control: { type: 'ephemeral' }, temperature: 0.5, prompt_cache_key: 'chat:1' }
    expect(providerPromptCacheParameters('https://openrouter.ai/api/v1', 'anthropic/claude-sonnet-4.6', 'disabled', parameters))
      .toEqual({ temperature: 0.5, prompt_cache_key: 'chat:1' })
    expect(parameters.cache_control).toEqual({ type: 'ephemeral' })
  })

  it.each([
    'anthropic/claude-sonnet-4.6',
    'anthropic/claude-opus-4.6',
    'anthropic/claude-sonnet-4.6:beta',
    '~anthropic/claude-sonnet-latest',
  ])('enables automatic caching for OpenRouter model %s', (model) => {
    expect(providerPromptCacheParameters('https://openrouter.ai/api/v1', model))
      .toEqual({ cache_control: { type: 'ephemeral' } })
  })

  it.each([
    ['https://api.openai.com/v1', 'anthropic/claude-sonnet-4.6'],
    ['https://proxy.example/v1', 'anthropic/claude-sonnet-4.6'],
    ['https://openrouter.ai.example/api/v1', 'anthropic/claude-sonnet-4.6'],
    ['invalid', 'anthropic/claude-sonnet-4.6'],
    ['https://openrouter.ai/api/v1', 'openai/gpt-5.4'],
    ['https://openrouter.ai/api/v1', 'google/gemini-2.5-pro'],
  ])('does not add Claude cache controls for %s and %s', (url, model) => {
    expect(providerPromptCacheParameters(url, model)).toEqual({})
  })
})

describe('provider cache request options', () => {
  it('maps OpenAI affinity to the Responses prompt cache key', () => {
    expect(providerCacheRequestOptions({
      cacheAffinityMode: 'openai_prompt_cache_key',
      cacheAffinityScope: 'chat',
      cacheIsolationMode: 'none',
      cacheIsolationScope: 'user',
    }, identity)).toEqual({ promptCacheKey: 'chat:chat-1', sessionId: 'chat:chat-1' })
  })

  it('maps Fireworks affinity and isolation to provider headers', () => {
    expect(providerCacheRequestOptions({
      cacheAffinityMode: 'fireworks_session_affinity',
      cacheAffinityScope: 'agent_run',
      cacheIsolationMode: 'fireworks_prompt_cache_isolation',
      cacheIsolationScope: 'user',
    }, identity)).toEqual({
      headers: {
        'x-session-affinity': 'run:run-1',
        'x-prompt-cache-isolation-key': 'user:user-1',
      },
    })
  })

  it('omits cache controls when both modes are disabled', () => {
    expect(providerCacheRequestOptions({
      cacheAffinityMode: 'none',
      cacheAffinityScope: 'chat',
      cacheIsolationMode: 'none',
      cacheIsolationScope: 'user',
    }, identity)).toEqual({})
  })
})
