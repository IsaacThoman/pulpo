import type { AssistantMessage } from '@earendil-works/pi-ai'
import { canFallbackAfterGenerationError } from '../responses/fallback-policy.js'

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
  if (input.message.stopReason !== 'error' || input.cancellationRequested || input.contextRetryAttempted) return false
  const error = new Error(input.message.errorMessage || 'Agent model turn failed')
  return !isContextFallbackExcluded(error.message)
    && canFallbackAfterGenerationError(error, input.outputStarted || assistantMessageHasOutput(input.message))
}

export function nextAgentRetryAttempt(input: {
  message: AssistantMessage
  currentAttempt: number
  maxRetries: number
  outputStarted: boolean
  cancellationRequested: boolean
}): number | undefined {
  if (input.currentAttempt > input.maxRetries) return undefined
  return canFallbackAgentTurn({
    message: input.message,
    outputStarted: input.outputStarted,
    cancellationRequested: input.cancellationRequested,
    contextRetryAttempted: false,
  }) ? input.currentAttempt + 1 : undefined
}
