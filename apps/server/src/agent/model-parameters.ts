import type { ThinkingLevel } from '@earendil-works/pi-ai'
import { resolveModelParameters } from '../responses/model-parameters.js'

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
