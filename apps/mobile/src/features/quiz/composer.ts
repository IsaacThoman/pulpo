import { createContext } from 'react'

/**
 * Puts text in the open chat's composer for the user to edit and send. Only a chat provides it, so
 * a quiz shown anywhere else offers no "Send results".
 */
export const QuizComposerContext = createContext<((text: string) => void) | null>(null)

/** Adds text to the composer's draft, after a blank line when it already has some. */
export function appendDraftText(draft: string, text: string): string {
  const kept = draft.replace(/\s+$/, '')
  return kept ? `${kept}\n\n${text}` : text
}
