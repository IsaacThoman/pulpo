import type { providerConnections } from '../database/schema.js'
import type { ModelPromptCaching } from '@pulpo/contracts'

type Provider = typeof providerConnections.$inferSelect

export type ProviderCacheIdentity = {
  userId: string
  chatId: string
  runId: string
}

export type ProviderCacheRequestOptions = {
  promptCacheKey?: string
  sessionId?: string
  headers?: Record<string, string>
}

/** Claude requires an explicit opt-in, including on OpenRouter's Responses API. */
export function providerPromptCacheParameters(
  baseUrl: string,
  upstreamModelId: string,
  mode: ModelPromptCaching = 'auto',
  parameters: Record<string, unknown> = {},
): Record<string, unknown> {
  if (mode === 'disabled') {
    const result = { ...parameters }
    delete result.cache_control
    return result
  }
  // Enabled lets admins opt compatible custom proxies and model aliases in.
  if (mode === 'enabled') return { cache_control: { type: 'ephemeral' }, ...parameters }
  try {
    if (new URL(baseUrl).hostname !== 'openrouter.ai') return parameters
  } catch {
    return parameters
  }
  // Include OpenRouter's dynamic model aliases and provider/variant suffixes.
  if (!/^~?anthropic\/claude-/i.test(upstreamModelId)) return parameters
  // The default five-minute cache advances with the conversation, including tool results.
  // https://openrouter.ai/docs/guides/best-practices/prompt-caching#anthropic-claude
  return { cache_control: { type: 'ephemeral' }, ...parameters }
}

function scopedKey(scope: string, identity: ProviderCacheIdentity): string {
  if (scope === 'user') return `user:${identity.userId}`
  if (scope === 'agent_run') return `run:${identity.runId}`
  return `chat:${identity.chatId}`
}

export function providerCacheRequestOptions(
  provider: Pick<Provider, 'cacheAffinityMode' | 'cacheAffinityScope' | 'cacheIsolationMode' | 'cacheIsolationScope'>,
  identity: ProviderCacheIdentity,
): ProviderCacheRequestOptions {
  const headers: Record<string, string> = {}
  let promptCacheKey: string | undefined
  let sessionId: string | undefined

  const affinityKey = scopedKey(provider.cacheAffinityScope, identity)
  if (provider.cacheAffinityMode === 'openai_prompt_cache_key') {
    promptCacheKey = affinityKey
    sessionId = affinityKey
  } else if (provider.cacheAffinityMode === 'fireworks_session_affinity') {
    headers['x-session-affinity'] = affinityKey
  }

  if (provider.cacheIsolationMode === 'fireworks_prompt_cache_isolation') {
    headers['x-prompt-cache-isolation-key'] = scopedKey(provider.cacheIsolationScope, identity)
  }

  return {
    ...(promptCacheKey ? { promptCacheKey } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
  }
}
