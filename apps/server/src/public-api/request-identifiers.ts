import { createHash } from 'node:crypto'

type PublicIdentifierParameter = 'prompt_cache_key' | 'safety_identifier'

function namespacedIdentifier(apiKeyId: string, parameter: PublicIdentifierParameter, value: string): string {
  const prefix = parameter === 'prompt_cache_key' ? 'pulpo_pc_' : 'pulpo_si_'
  const digest = createHash('sha256')
    .update(parameter)
    .update('\0')
    .update(apiKeyId)
    .update('\0')
    .update(value)
    .digest('base64url')
  return `${prefix}${digest}`
}

/** Derive stable provider identifiers without persisting client-supplied values. */
export function namespacePublicRequestIdentifiers(
  parameters: Record<string, unknown>,
  apiKeyId: string,
): Record<string, unknown> {
  const output = { ...parameters }
  for (const parameter of ['prompt_cache_key', 'safety_identifier'] as const) {
    const value = output[parameter]
    if (typeof value === 'string') output[parameter] = namespacedIdentifier(apiKeyId, parameter, value)
  }
  return output
}
