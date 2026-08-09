const RESERVED_PARAMETERS = new Set(['model', 'input', 'stream', 'store', 'metadata'])

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function resolveModelParameters(
  model: { allowedParameters: unknown; defaultParameters: unknown },
  responseParameters: unknown,
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
    if (allowed.has(key) && !RESERVED_PARAMETERS.has(key)) result[key] = value
  }
  return result
}
