export type ChatHeaderAction = 'temporary-toggle' | 'new-chat'

export function resolveChatHeaderAction(chatId: string | null, messageCount: number): ChatHeaderAction {
  return chatId === null && messageCount === 0 ? 'temporary-toggle' : 'new-chat'
}
