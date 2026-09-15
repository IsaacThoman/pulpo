import type { ExecutionMode } from '@pulpo/contracts'

/** Respect a public client's limit, including when a fallback has a lower ceiling. */
export function publicOutputTokenLimit(modelMaxOutputTokens: number, parameters: Record<string, unknown>): { max_output_tokens: number } {
  const requested = parameters.max_output_tokens
  return {
    max_output_tokens: typeof requested === 'number' && Number.isInteger(requested) && requested > 0
      ? Math.min(requested, modelMaxOutputTokens)
      : modelMaxOutputTokens,
  }
}

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

/**
 * Parameters a provider may reject for a given model without changing what the
 * client is billed for. When the upstream names one of these in a 400, the
 * worker retries once without it instead of failing the generation.
 */
const STRIPPABLE_UPSTREAM_PARAMETERS = new Set([
  'temperature', 'top_p', 'reasoning', 'text', 'service_tier', 'parallel_tool_calls',
  'top_logprobs', 'truncation', 'prompt_cache_key', 'prompt_cache_retention',
  'prompt_cache_options', 'safety_identifier', 'include', 'stream_options',
])

export type UpstreamErrorDetails = {
  status?: number
  code?: string
  param?: string
  type?: string
  message: string
}

function errorRecord(error: unknown): Record<string, unknown> | undefined {
  return error !== null && typeof error === 'object' ? error as Record<string, unknown> : undefined
}

/** Structured fields from an OpenAI SDK APIError or a compatible provider's error body. */
export function upstreamErrorDetails(error: unknown): UpstreamErrorDetails {
  const fields = errorRecord(error)
  const body = errorRecord(errorRecord(fields?.error)?.error) ?? errorRecord(fields?.error)
  const status = typeof fields?.status === 'number' ? fields.status : undefined
  const code = typeof fields?.code === 'string' ? fields.code : typeof body?.code === 'string' ? body.code : undefined
  const param = typeof fields?.param === 'string' ? fields.param : typeof body?.param === 'string' ? body.param : undefined
  const type = typeof fields?.type === 'string' ? fields.type : typeof body?.type === 'string' ? body.type : undefined
  const message = typeof body?.message === 'string' ? body.message : error instanceof Error ? error.message : String(error)
  return { status, code, param, type, message }
}

const UNSUPPORTED_PARAMETER_MESSAGE = /unsupported (?:parameter|value)[^'"`]*['"`]([a-z_.]+)['"`]|['"`]?([a-z_]+)['"`]? (?:is|are) not supported/i

/**
 * The top-level payload key an upstream 400 rejects, when stripping it is safe.
 * Returns undefined for non-400s, unknown params, and params not in the payload.
 */
export function strippableUpstreamParameter(error: unknown, payload: Record<string, unknown>): string | undefined {
  const details = upstreamErrorDetails(error)
  if (details.status !== 400) return undefined
  const candidates: string[] = []
  if (details.param) candidates.push(details.param)
  const match = UNSUPPORTED_PARAMETER_MESSAGE.exec(details.message)
  if (match) candidates.push(match[1] ?? match[2] ?? '')
  for (const candidate of candidates) {
    const key = candidate.split(/[.[]/)[0] ?? ''
    if (STRIPPABLE_UPSTREAM_PARAMETERS.has(key) && key in payload) return key
  }
  return undefined
}
