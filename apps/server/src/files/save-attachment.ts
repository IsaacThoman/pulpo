import { and, eq } from 'drizzle-orm'
import { FILE_TREE_MAX_DEPTH, type FileNode } from '@pulpo/contracts'
import { assertStorageCapacity } from '../attachments/storage-quota.js'
import { db } from '../database/client.js'
import { fileNodes, type attachments } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { getBlobStore } from '../storage/index.js'
import { attachmentFileName } from './names.js'
import { availableName, destinationDepth, lockFileTree, mutateFileTree, toFileNode, treeTooDeep } from './tree-service.js'

type AttachmentRow = typeof attachments.$inferSelect

/**
 * Saves a chat attachment as an uploaded file in `parentId`, keeping both when the name is taken.
 *
 * Like copying a file, the node is inserted as pending (hidden from listings) with its storage
 * reserved, the bytes are copied in the object store after commit, and only then is it marked
 * ready, so a failed copy never leaves a visible file without contents.
 */
export async function saveAttachmentToFiles(userId: string, attachment: AttachmentRow, parentId: string | null): Promise<FileNode> {
  const id = newId()
  const objectKey = `users/${userId}/files/${id}`
  await db.transaction(async (tx) => {
    // Storage before tree, matching upload reservations, so the two locks cannot deadlock.
    await assertStorageCapacity(tx, userId, attachment.sizeBytes, { perFileLimit: false })
    await lockFileTree(tx, userId)
    if (await destinationDepth(tx, userId, parentId) > FILE_TREE_MAX_DEPTH) throw treeTooDeep()
    const name = await availableName(tx, userId, parentId, attachmentFileName(attachment.originalName))
    await tx.insert(fileNodes).values({
      id, ownerUserId: userId, parentId, kind: 'blob', name, status: 'pending',
      mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes, checksum: attachment.checksum, objectKey,
    })
  })

  let copied = true
  try {
    await getBlobStore().copy(attachment.objectKey, objectKey)
  } catch {
    copied = false
  }
  const node = await mutateFileTree(userId, async (tx) => {
    const owned = and(eq(fileNodes.id, id), eq(fileNodes.ownerUserId, userId))
    // Nothing was stored; drop the placeholder so it stops counting against storage.
    if (!copied) {
      await tx.delete(fileNodes).where(owned)
      return null
    }
    const [row] = await tx.update(fileNodes).set({ status: 'ready', updatedAt: new Date() }).where(owned).returning()
    return row ? toFileNode(row) : null
  })
  if (!node) throw new AppError(502, 'file_copy_failed', 'The attachment could not be saved to Files')
  return node
}
