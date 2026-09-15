const RESERVED_PARAMETERS = new Set(['model', 'input', 'stream', 'store', 'metadata'])
export const PUBLIC_API_PROTOCOL_PARAMETERS = new Set([
  // External clients execute these function tools themselves. They are part of
  // the API conversation, independent of the catalog's model tuning allowlist.
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'max_output_tokens',
  'include',
  'instructions',
  'prompt_cache_key',
  'safety_identifier',
  'stream_options',
])

// Sampling and output-shape knobs that OpenAI-compatible clients send by
// default. They bill per token like any other request, so public API callers
// may always set them without an admin allowlist entry.
export const PUBLIC_API_SAFE_PARAMETERS = new Set([
  'temperature',
  'top_p',
  'reasoning',
  'text',
])

export type ModelParameterContext = {
  publicApi?: boolean
}

function allowedSet(model: { allowedParameters: unknown }): Set<string> {
  return new Set(
    Array.isArray(model.allowedParameters)
      ? model.allowedParameters.filter((key): key is string => typeof key === 'string')
      : [],
  )
}

function publicApiParameter(key: string): boolean {
  return PUBLIC_API_PROTOCOL_PARAMETERS.has(key) || PUBLIC_API_SAFE_PARAMETERS.has(key)
}

/**
 * Public parameters the catalog does not allow for this model. Callers drop
 * these and fall back to the model defaults instead of failing the request,
 * matching how OpenAI-compatible proxies treat unsupported options.
 */
export function droppedPublicModelParameters(model: { allowedParameters: unknown }, parameters: unknown): string[] {
  const allowed = allowedSet(model)
  return Object.keys(record(parameters)).filter((key) => !allowed.has(key) && !publicApiParameter(key)).sort()
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function resolveModelParameters(
  model: { allowedParameters: unknown; defaultParameters: unknown },
  responseParameters: unknown,
  context: ModelParameterContext = {},
): Record<string, unknown> {
  const allowed = allowedSet(model)
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record(model.defaultParameters))) {
    if (allowed.has(key) && !RESERVED_PARAMETERS.has(key)) result[key] = value
  }
  for (const [key, value] of Object.entries(record(responseParameters))) {
    const publicApiPassthrough = context.publicApi && publicApiParameter(key)
    if ((allowed.has(key) || publicApiPassthrough) && !RESERVED_PARAMETERS.has(key)) result[key] = value
  }
  return result
}
