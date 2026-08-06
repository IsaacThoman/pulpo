export type ChatHeaderAction = 'temporary-toggle' | 'temporary-actions' | 'new-chat'

export function resolveChatHeaderAction(chatId: string | null, messageCount: number, temporary = false): ChatHeaderAction {
  if (temporary && messageCount > 0) return 'temporary-actions'
  return chatId === null && messageCount === 0 ? 'temporary-toggle' : 'new-chat'
}

export function nextChatStartsTemporary(currentChatTemporary: boolean): boolean {
  return currentChatTemporary
}
