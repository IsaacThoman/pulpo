import type { Chat } from '@/lib/types'

/** Chats the sidebar and search list: saved, ordinary chats. Side chats and threads are reached from their chat. */
export function isSidebarChat(chat: Pick<Chat, 'temporary' | 'kind'>): boolean {
  return !chat.temporary && (chat.kind ?? 'chat') === 'chat'
}

/** Partition the sidebar snapshot without copying an increasingly large folder per chat. */
export function sidebarChatGroups(chats: readonly Chat[]): { inFolders: Map<string, Chat[]>; loose: Chat[] } {
  const inFolders = new Map<string, Chat[]>()
  const loose: Chat[] = []
  for (const chat of chats) {
    if (chat.pinned || chat.inFilesRoot) continue
    if (!chat.folderId) loose.push(chat)
    else {
      const folder = inFolders.get(chat.folderId)
      if (folder) folder.push(chat)
      else inFolders.set(chat.folderId, [chat])
    }
  }
  return { inFolders, loose }
}
