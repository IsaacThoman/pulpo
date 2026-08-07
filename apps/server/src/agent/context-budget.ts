import type { AssistantMessage, Context } from '@earendil-works/pi-ai'
import { isContextOverflow } from '@earendil-works/pi-ai'
import { estimateInputTokens } from '../accounting/pricing.js'

export const AGENT_CONTEXT_SAFETY_TOKENS = 4_096

export function effectiveAgentCompactionThreshold(
  configuredThreshold: number,
  contextWindow: number,
): number {
  return Math.max(1, Math.min(configuredThreshold, contextWindow - AGENT_CONTEXT_SAFETY_TOKENS))
}

/** Estimate the complete transformed context while treating raw image bytes as a bounded token cost. */
export function estimateAgentContextTokens(context: Context): number {
  const normalized = {
    ...context,
    messages: context.messages.map((message) => {
      if (!Array.isArray(message.content)) return message
      return {
        ...message,
        content: message.content.map((part) => part.type === 'image'
          ? { ...part, data: 'x'.repeat(4_800) }
          : part),
      }
    }),
  }
  return estimateInputTokens(normalized)
}

export function shouldRetryContextOverflow(
  message: AssistantMessage,
  contextWindow: number,
  alreadyRetried: boolean,
): boolean {
  if (alreadyRetried || !isContextOverflow(message, contextWindow)) return false
  return message.content.every((part) => part.type !== 'text' || !part.text)
}
