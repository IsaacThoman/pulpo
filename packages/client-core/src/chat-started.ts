import type { ChatStartedEvent } from '@pulpo/contracts'

export interface ChatFollowState {
  newChat: boolean
  inputFocused: boolean
  foreground: boolean
  syncEnabled: boolean
  temporary: boolean
  busy: boolean
}

export function canFollowStartedChat(state: ChatFollowState): boolean {
  return state.newChat && state.inputFocused && state.foreground && state.syncEnabled
    && !state.temporary && !state.busy
}

/** Live delivery only: nothing is retained for a future subscriber or focus. */
export function createChatStartedChannel() {
  const listeners = new Set<{ scope: string; receive: (event: ChatStartedEvent) => void }>()
  const seen = new Set<string>()
  const remember = (scope: string, chatId: string) => {
    const key = JSON.stringify([scope, chatId])
    if (seen.has(key)) return false
    seen.add(key)
    // Bound deduplication across long-lived sessions and account switches.
    if (seen.size > 512) seen.delete(seen.values().next().value!)
    return true
  }
  return {
    ignoreLocal(scope: string, chatId: string) { remember(scope, chatId) },
    receive(scope: string, event: ChatStartedEvent) {
      if (!remember(scope, event.chatId)) return
      for (const listener of listeners) if (listener.scope === scope) listener.receive(event)
    },
    follow(scope: string, eligible: () => boolean, open: (event: ChatStartedEvent) => void) {
      let claimed = false
      const listener = { scope, receive(event: ChatStartedEvent) {
        if (claimed || !eligible()) return
        // Claim synchronously, before a React navigation can commit.
        claimed = true
        open(event)
      } }
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
