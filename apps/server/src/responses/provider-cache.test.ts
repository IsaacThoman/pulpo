import { describe, expect, it } from 'vitest'
import { providerCacheRequestOptions } from './provider-cache.js'

const identity = { userId: 'user-1', chatId: 'chat-1', runId: 'run-1' }

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
