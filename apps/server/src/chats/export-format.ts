export const ORDINARY_CHAT_EXPORT_COLLECTIONS = ['chats', 'responses'] as const

export function createChatExportPayload<TChat, TResponse>(
  chats: TChat[],
  responses: TResponse[],
  exportedAt = new Date(),
) {
  return {
    format: 'pulpo-chat-export' as const,
    version: 2 as const,
    exportedAt: exportedAt.toISOString(),
    chats,
    responses,
  }
}
