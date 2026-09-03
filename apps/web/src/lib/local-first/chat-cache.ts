import { queryClient } from '@/lib/query-client'
import { localDb } from './database'
import { deleteLocalComposerDraft } from './composer-drafts'

interface LocallyCachedChat {
  attachments?: Array<{ id: string }>
  responses?: Array<{ id: string }>
}

/** Remove recoverable local data for chats that are being permanently discarded. */
export async function clearLocalChats(userId: string, chatIds: string[]): Promise<void> {
  const ids = [...new Set(chatIds)]
  if (!ids.length) return

  const idSet = new Set(ids)
  await Promise.all(ids.map((chatId) => deleteLocalComposerDraft(userId, chatId)))
  const attachmentIds = new Set<string>()
  const responseIds = new Set<string>()
  for (const chatId of ids) {
    const chat = queryClient.getQueryData<LocallyCachedChat>(['chat', userId, chatId])
    for (const attachment of chat?.attachments ?? []) attachmentIds.add(attachment.id)
    for (const response of chat?.responses ?? []) responseIds.add(response.id)
    queryClient.removeQueries({ queryKey: ['chat', userId, chatId], exact: true })
  }
  queryClient.setQueryData<Array<{ id: string }>>(['deleted-chats', userId], (rows) =>
    rows?.filter((row) => !idSet.has(row.id)),
  )

  await localDb.transaction('rw', localDb.attachmentBlobs, localDb.responseCursors, async () => {
    if (attachmentIds.size) await localDb.attachmentBlobs.bulkDelete([...attachmentIds])
    if (responseIds.size) {
      await localDb.responseCursors.filter((cursor) => responseIds.has(cursor.responseId)).delete()
    }
  })
}
