import type { AssistantMessage } from '@earendil-works/pi-ai'
import { canFallbackAfterGenerationError, fallbackModelAttemptLimit, primaryModelAttemptLimit } from '../responses/fallback-policy.js'

type RetryChainModel = { fallbackModelId: string | null; maxRetries: number }

export function agentModelAttemptLimit(models: RetryChainModel[], index: number): number {
  const current = models[index]
  if (!current) return 1
  if (index === 0) return primaryModelAttemptLimit(current)
  return fallbackModelAttemptLimit(models[index - 1] ?? current)
}

export async function resolveStickyFallbackIndex(
  modelIds: string[],
  startingIndex: number,
  isSticky: (modelId: string) => Promise<boolean>,
): Promise<{ index: number; stickyUsed: boolean }> {
  let index = startingIndex
  let stickyUsed = false
  while (index + 1 < modelIds.length && await isSticky(modelIds[index]!)) {
    index += 1
    stickyUsed = true
  }
  return { index, stickyUsed }
}

export function assistantMessageHasOutput(message: AssistantMessage): boolean {
  return message.content.some((part) => {
    if (part.type === 'text') return part.text.length > 0
    if (part.type === 'thinking') return part.thinking.length > 0
    return part.type === 'toolCall'
  })
}

export function agentStreamEventHasSubstantiveOutput(event: { type: string; delta?: unknown }): boolean {
  if (event.type === 'toolcall_start') return true
  if (event.type !== 'text_delta' && event.type !== 'thinking_delta' && event.type !== 'toolcall_delta') return false
  return typeof event.delta === 'string' ? event.delta.length > 0 : event.delta !== undefined && event.delta !== null
}

export function isContextFallbackExcluded(errorMessage: string): boolean {
  const message = errorMessage.toLowerCase()
  return message.includes('compaction')
    || /context[_ -]*(?:overflow|length|window)/.test(message)
    || /maximum[_ -]*context/.test(message)
}

export function canFallbackAgentTurn(input: {
  message: AssistantMessage
  outputStarted: boolean
  cancellationRequested: boolean
  contextRetryAttempted: boolean
}): boolean {
  if (
    (input.message.stopReason !== 'error' && input.message.stopReason !== 'aborted')
    || input.cancellationRequested
    || input.contextRetryAttempted
  ) return false
  const error = new Error(input.message.errorMessage || 'Agent model turn failed')
  return !isContextFallbackExcluded(error.message)
    && canFallbackAfterGenerationError(error, input.outputStarted || assistantMessageHasOutput(input.message))
}

export function nextAgentRetryAttempt(input: {
  message: AssistantMessage
  currentAttempt: number
  maxAttempts: number
  outputStarted: boolean
  cancellationRequested: boolean
}): number | undefined {
  if (input.currentAttempt >= input.maxAttempts) return undefined
  return canFallbackAgentTurn({
    message: input.message,
    outputStarted: input.outputStarted,
    cancellationRequested: input.cancellationRequested,
    contextRetryAttempted: false,
  }) ? input.currentAttempt + 1 : undefined
}
