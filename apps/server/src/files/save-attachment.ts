import { and, eq } from 'drizzle-orm'
import { FILE_TREE_MAX_DEPTH, type FileNode } from '@pulpo/contracts'
import { assertStorageCapacity } from '../attachments/storage-quota.js'
import { db } from '../database/client.js'
import { fileNodes, type attachments } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { getBlobStore } from '../storage/index.js'
import { resolveFileAccess } from './access.js'
import { publishDocsClosed } from './doc-events.js'
import { attachmentFileName } from './names.js'
import {
  availableName,
  destinationDepth,
  lockFileTree,
  mutateFileTree,
  restoreNodeInTx,
  toFileNode,
  trashNodeInTx,
  treeTooDeep,
} from './tree-service.js'
import { topSortOrder } from './order.js'

type AttachmentRow = typeof attachments.$inferSelect

export interface SaveAttachmentOptions {
  parentId: string | null
  /** Defaults to the attachment's own name. */
  name?: string
  /** A file in `parentId` with this name to overwrite; it moves to the trash, so it can be restored. */
  replaceId?: string
}

/**
 * Saves a chat attachment as an uploaded file. A taken name gets a ` (n)` suffix, unless the
 * caller chose to overwrite the file holding it.
 *
 * Like copying a file, the node is inserted as pending (hidden from listings) with its storage
 * reserved, the bytes are copied in the object store after commit, and only then is it marked
 * ready, so a failed copy never leaves a visible file without contents. An overwritten file is
 * trashed in that first step and restored if the copy fails.
 */
export async function saveAttachmentToFiles(
  userId: string,
  attachment: AttachmentRow,
  { parentId, name: requestedName, replaceId }: SaveAttachmentOptions,
): Promise<{ node: FileNode; replacedId: string | null }> {
  const id = newId()
  const objectKey = `users/${userId}/files/${id}`
  const desired = requestedName ?? attachmentFileName(attachment.originalName)
  const closedDocs: string[] = []
  await db.transaction(async (tx) => {
    // Storage before tree, matching upload reservations, so the two locks cannot deadlock.
    await assertStorageCapacity(tx, userId, attachment.sizeBytes, { perFileLimit: false })
    await lockFileTree(tx, userId)
    if (await destinationDepth(tx, userId, parentId) > FILE_TREE_MAX_DEPTH) throw treeTooDeep()
    if (replaceId) {
      const target = (await resolveFileAccess(tx, userId, replaceId))?.node
      // The file must still be where the user saw it, under the same name; otherwise ask again.
      if (!target || target.trashedAt || target.status !== 'ready' || target.kind === 'folder'
        || target.parentId !== parentId || target.name.toLowerCase() !== desired.toLowerCase()) {
        throw new AppError(409, 'file_replace_conflict', 'The file to overwrite has changed. Try saving again.')
      }
      closedDocs.push(...await trashNodeInTx(tx, userId, target))
    }
    const name = replaceId ? desired : await availableName(tx, userId, parentId, desired)
    await tx.insert(fileNodes).values({
      id, ownerUserId: userId, parentId, kind: 'blob', name, status: 'pending',
      mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes, checksum: attachment.checksum, objectKey,
      sortOrder: await topSortOrder(tx, userId, parentId),
    })
  })
  if (closedDocs.length) await publishDocsClosed(closedDocs, 'trashed')

  let copied = true
  try {
    await getBlobStore().copy(attachment.objectKey, objectKey)
  } catch {
    copied = false
  }
  const node = await mutateFileTree(userId, async (tx) => {
    const owned = and(eq(fileNodes.id, id), eq(fileNodes.ownerUserId, userId))
    if (!copied) {
      // Nothing was stored; drop the placeholder so it stops counting against storage, and bring
      // back the file it was replacing.
      await tx.delete(fileNodes).where(owned)
      if (replaceId) await restoreNodeInTx(tx, userId, replaceId).catch(() => undefined)
      return null
    }
    const [row] = await tx.update(fileNodes).set({ status: 'ready', updatedAt: new Date() }).where(owned).returning()
    return row ? toFileNode(row) : null
  })
  if (!node) throw new AppError(502, 'file_copy_failed', 'The attachment could not be saved to Files')
  return { node, replacedId: replaceId ?? null }
}
