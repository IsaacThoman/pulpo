const RESERVED_PARAMETERS = new Set(['model', 'input', 'stream', 'store', 'metadata'])
export const PUBLIC_API_PROTOCOL_PARAMETERS = new Set([
  'include',
  'instructions',
  'prompt_cache_key',
  'safety_identifier',
  'stream_options',
])

export type ModelParameterContext = {
  publicApi?: boolean
}

export function unsupportedPublicModelParameter(model: { allowedParameters: unknown }, parameters: unknown): string | undefined {
  const allowed = new Set(
    Array.isArray(model.allowedParameters)
      ? model.allowedParameters.filter((key): key is string => typeof key === 'string')
      : [],
  )
  return Object.keys(record(parameters)).find((key) => !allowed.has(key) && !PUBLIC_API_PROTOCOL_PARAMETERS.has(key))
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
  const allowed = new Set(
    Array.isArray(model.allowedParameters)
      ? model.allowedParameters.filter((key): key is string => typeof key === 'string')
      : [],
  )
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record(model.defaultParameters))) {
    if (allowed.has(key) && !RESERVED_PARAMETERS.has(key)) result[key] = value
  }
  for (const [key, value] of Object.entries(record(responseParameters))) {
    const publicApiProtocolParameter = context.publicApi && PUBLIC_API_PROTOCOL_PARAMETERS.has(key)
    if ((allowed.has(key) || publicApiProtocolParameter) && !RESERVED_PARAMETERS.has(key)) result[key] = value
  }
  return result
}
