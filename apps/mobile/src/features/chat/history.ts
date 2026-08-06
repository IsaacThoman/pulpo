export function visibleHistoryChats<T extends { deletedAt: number | null; temporary: boolean }>(chats: T[]): T[] {
  return chats.filter((chat) => chat.deletedAt === null && !chat.temporary)
}
