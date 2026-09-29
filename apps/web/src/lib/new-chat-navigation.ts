export interface NewChatLocationState {
  selectedModelId?: string
  resetDefaultModel?: string
}

export function newChatLocationState(
  hasActiveChat: boolean,
  selectedModelId: string | null,
  resetToken?: string,
): NewChatLocationState {
  if (hasActiveChat && selectedModelId) return { selectedModelId }
  return { resetDefaultModel: resetToken ?? crypto.randomUUID() }
}
