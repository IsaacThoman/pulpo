import { create } from 'zustand'

export interface TurnFailure {
  text: string
  message: string
}

/** A failed send keeps its text so the chat screen can offer it again. */
export const useTurnFailures = create<{
  failures: Record<string, TurnFailure>
  fail: (chatId: string, failure: TurnFailure) => void
  clear: (chatId: string) => void
}>((set) => ({
  failures: {},
  fail: (chatId, failure) => set((state) => ({ failures: { ...state.failures, [chatId]: failure } })),
  clear: (chatId) => set((state) => {
    if (!state.failures[chatId]) return state
    const { [chatId]: _removed, ...failures } = state.failures
    return { failures }
  }),
}))

export function failureMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Couldn’t send'
}
