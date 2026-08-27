import type { ExecutionMode } from '@pulpo/contracts'

/** Only send the optional background flag when asynchronous execution is requested. */
export function backgroundRequestParameter(executionMode: ExecutionMode): { background: true } | Record<string, never> {
  return executionMode === 'background' ? { background: true } : {}
}

/** Repeat requested output projections when recovering or resuming a background response. */
export function responseIncludeParameter(parameters: unknown): { include: string[] } | Record<string, never> {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return {}
  const include = (parameters as Record<string, unknown>).include
  return Array.isArray(include) && include.every((value) => typeof value === 'string') && include.length > 0
    ? { include: include as string[] }
    : {}
}

/** Prefer a namespaced public request key over the provider's generated affinity key. */
export function promptCacheKeyParameter(
  parameters: unknown,
  providerPromptCacheKey?: string,
): { prompt_cache_key: string } | Record<string, never> {
  const requested = parameters && typeof parameters === 'object' && !Array.isArray(parameters)
    ? (parameters as Record<string, unknown>).prompt_cache_key
    : undefined
  if (typeof requested === 'string') return { prompt_cache_key: requested }
  return providerPromptCacheKey ? { prompt_cache_key: providerPromptCacheKey } : {}
}
