import { describe, expect, it } from 'vitest'
import { providerCacheRequestOptions, providerPromptCacheParameters } from './provider-cache.js'

const identity = { userId: 'user-1', chatId: 'chat-1', runId: 'run-1' }

describe('provider prompt caching', () => {
  it('does not opt in by default', () => {
    expect(providerPromptCacheParameters()).toEqual({})
  })

  it('adds the opt-in when enabled', () => {
    expect(providerPromptCacheParameters(true)).toEqual({ cache_control: { type: 'ephemeral' } })
  })

  it('preserves explicit TTL and unrelated parameters when enabled', () => {
    const parameters = { cache_control: { type: 'ephemeral', ttl: '1h' }, temperature: 0.5 }
    expect(providerPromptCacheParameters(true, parameters)).toEqual(parameters)
  })

  it('removes a custom top-level opt-in when disabled without mutating parameters', () => {
    const parameters = { cache_control: { type: 'ephemeral' }, temperature: 0.5, prompt_cache_key: 'chat:1' }
    expect(providerPromptCacheParameters(false, parameters)).toEqual({ temperature: 0.5, prompt_cache_key: 'chat:1' })
    expect(parameters.cache_control).toEqual({ type: 'ephemeral' })
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
