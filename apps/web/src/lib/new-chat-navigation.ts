export interface NewChatLocationState {
  selectedModelId?: string
  resetDefaultModel?: string
  /** Files items for the new chat, e.g. when a panel's new chat moves to the main view. */
  fileScopeIds?: string[]
}

export function newChatLocationState(
  hasActiveChat: boolean,
  selectedModelId: string | null,
  resetToken?: string,
): NewChatLocationState {
  if (hasActiveChat && selectedModelId) return { selectedModelId }
  return { resetDefaultModel: resetToken ?? crypto.randomUUID() }
}
