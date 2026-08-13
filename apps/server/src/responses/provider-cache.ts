import type { providerConnections } from '../database/schema.js'

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
