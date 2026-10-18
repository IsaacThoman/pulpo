export interface NewChatLocationState {
  selectedModelId?: string
  resetDefaultModel?: string
  /** Start in temporary mode, as the sidebar's "New temporary chat" asks. */
  temporary?: boolean
}

export function newChatLocationState(
  hasActiveChat: boolean,
  selectedModelId: string | null,
  resetToken?: string,
): NewChatLocationState {
  if (hasActiveChat && selectedModelId) return { selectedModelId }
  return { resetDefaultModel: resetToken ?? crypto.randomUUID() }
}
