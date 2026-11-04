import type { ThinkingLevel } from '@earendil-works/pi-ai'
import { resolveModelParameters } from '../responses/model-parameters.js'
import { withMirroredReasoningEffort } from '../upstream/responses-input.js'

const THINKING_LEVELS = new Set<ThinkingLevel>(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

export function agentThinkingLevel(
  parameters: Record<string, unknown>,
  fallback: ThinkingLevel = 'medium',
): ThinkingLevel {
  const reasoning = parameters.reasoning
  if (!reasoning || typeof reasoning !== 'object' || Array.isArray(reasoning)) return fallback
  const effort = (reasoning as Record<string, unknown>).effort
  return typeof effort === 'string' && THINKING_LEVELS.has(effort as ThinkingLevel)
    ? effort as ThinkingLevel
    : fallback
}

export function resolveAgentModelParameters(
  model: { allowedParameters: unknown; defaultParameters: unknown },
  responseParameters: unknown,
  fallbackReasoning: ThinkingLevel = 'medium',
): { parameters: Record<string, unknown>; reasoning: ThinkingLevel } {
  const parameters = resolveModelParameters(model, responseParameters)
  return { parameters, reasoning: agentThinkingLevel(parameters, fallbackReasoning) }
}

function supportsEncryptedReasoningInclude(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase()
    return hostname === 'api.openai.com'
      || hostname.endsWith('.openai.azure.com')
      || hostname.endsWith('.services.ai.azure.com')
  } catch {
    return false
  }
}

/**
 * Responses sampling parameters for an Agent turn. They override Pi's own
 * fields, so a configured `reasoning_effort` also replaces Pi's default
 * `reasoning.effort`. Strict compatible proxies skip the encrypted-reasoning include.
 */
export function agentSamplingParameters(
  baseUrl: string,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  const mirrored = withMirroredReasoningEffort(parameters)
  return supportsEncryptedReasoningInclude(baseUrl)
    ? mirrored
    : { ...mirrored, include: undefined }
}
