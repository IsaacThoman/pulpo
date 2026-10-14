import type { AssistantMessage } from '@earendil-works/pi-ai'
import { isContextOverflow } from '@earendil-works/pi-ai'
import { CompactionError } from '../compaction/summarize.js'
import { isContextFallbackExcluded } from './fallback-policy.js'

/**
 * Worded to match pi-ai's OpenAI overflow pattern, so a request refused before sending is recovered like a provider overflow.
 * No unit word: Codex treats error texts mentioning tokens as expired logins.
 */
export function contextOverflowErrorMessage(tokens: number, limit: number): string {
  return `Request exceeds the context window (estimated size ${tokens}, limit ${limit})`
}

export function shouldRetryContextOverflow(
  message: AssistantMessage,
  contextWindow: number,
  alreadyRetried: boolean,
): boolean {
  if (alreadyRetried || !isContextOverflow(message, contextWindow)) return false
  return message.content.every((part) => part.type !== 'text' || !part.text)
}

/** An empty context overflow is recovered by compaction when allowed; otherwise it ends the run, never taking ordinary retries or fallback. */
export function contextOverflowOutcome(message: AssistantMessage, options: {
  contextWindow: number
  outputStarted: boolean
  recoveryAllowed: boolean
}): 'recover' | 'stop' | undefined {
  if (options.outputStarted || !shouldRetryContextOverflow(message, options.contextWindow, false)) return undefined
  return options.recoveryAllowed ? 'recover' : 'stop'
}

/** Compaction and context-overflow failures, thrown or rethrown from a turn's error text; never a credential problem, though provider texts may mention tokens. */
export function isContextFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return error instanceof CompactionError
    || isContextFallbackExcluded(message)
    || isContextOverflow({ stopReason: 'error', errorMessage: message } as AssistantMessage)
}

/** Codex errors are shown redacted. Compaction texts are Pulpo's own (the agent summarizer redacts Codex failures where they occur); overflow texts are not. */
export function codexContextFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return /compaction/i.test(message) ? message : 'The conversation exceeds the model context window.'
}
