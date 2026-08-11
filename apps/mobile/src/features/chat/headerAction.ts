export type ChatHeaderAction = 'temporary-toggle' | 'temporary-actions' | 'new-chat'
export type ChatHeaderLeadingAction = 'none' | 'expiration' | 'save'
export type ChatHeaderTrailingAction = 'ghost' | 'new-chat'

export type ChatHeaderControl = {
  expanded: boolean
  leadingAction: ChatHeaderLeadingAction
  trailingAction: ChatHeaderTrailingAction
}

export function resolveChatHeaderAction(chatId: string | null, messageCount: number, temporary = false): ChatHeaderAction {
  if (temporary && messageCount > 0) return 'temporary-actions'
  return chatId === null && messageCount === 0 ? 'temporary-toggle' : 'new-chat'
}

export function nextChatStartsTemporary(currentChatTemporary: boolean): boolean {
  return currentChatTemporary
}

export function resolveChatHeaderControl(
  action: ChatHeaderAction,
  showAutoExpirationControl: boolean,
): ChatHeaderControl {
  const leadingAction = action === 'temporary-actions'
    ? 'save'
    : showAutoExpirationControl ? 'expiration' : 'none'
  return {
    expanded: leadingAction !== 'none',
    leadingAction,
    trailingAction: action === 'temporary-toggle' ? 'ghost' : 'new-chat',
  }
}
