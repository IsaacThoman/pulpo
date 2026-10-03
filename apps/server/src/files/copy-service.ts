import { and, eq, inArray, sql } from 'drizzle-orm'
import * as Y from 'yjs'
import { DOC_SCHEMA_VERSION, ydocToMarkdown } from '@pulpo/client-core/doc-schema'
import { FILE_TREE_MAX_DEPTH, fileNameError, normalizeFileName, type FileNode } from '@pulpo/contracts'
import { readyAttachment } from '../attachments/access.js'
import { assertStorageCapacity, lockAccountStorage } from '../attachments/storage-quota.js'
import { db } from '../database/client.js'
import { fileDocs, fileNodes } from '../database/schema.js'
import { bumpAccountRevisions, publishScopedStateChanges } from '../friends/sync.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { getBlobStore } from '../storage/index.js'
import type { FileNodeRow } from './access.js'
import { mergedDocState } from './doc-state.js'
import { nextAvailableName } from './names.js'
import {
  chainIds,
  destinationDepth,
  liveSiblingNames,
  lockFileTree,
  mutateFileTree,
  topLevelIds,
  toFileNode,
  treeTooDeep,
} from './tree-service.js'

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Live, ready nodes under `rootId` (inclusive), parents before children. Trashed branches are skipped. */
async function liveSubtree(tx: DatabaseTransaction, userId: string, rootId: string): Promise<Array<FileNodeRow & { depth: number }>> {
  const rows = await tx.execute<{ id: string; depth: number }>(sql`
    with recursive subtree(id, depth) as (
      select id, 0 from file_nodes
      where id = ${rootId} and owner_user_id = ${userId} and trashed_at is null and status = 'ready'
      union all
      select node.id, subtree.depth + 1 from file_nodes node
      join subtree on node.parent_id = subtree.id
      where node.trashed_at is null and node.status = 'ready' and subtree.depth < ${FILE_TREE_MAX_DEPTH * 2}
    )
    select id::text as id, depth from subtree
  `)
  if (!rows.length) return []
  const depths = new Map(rows.map((row) => [row.id, Number(row.depth)]))
  const nodes = await tx.select().from(fileNodes).where(inArray(fileNodes.id, [...depths.keys()]))
  return nodes.map((node) => ({ ...node, depth: depths.get(node.id)! })).sort((left, right) => left.depth - right.depth)
}

function docMarkdown(state: Uint8Array): string {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, state)
  try {
    return ydocToMarkdown(doc)
  } catch {
    return ''
  }
}

/**
 * Copies items (with their contents) into `parentId`, keeping both when names clash.
 *
 * Folders and documents are written in one transaction that also reserves storage. Uploaded
 * files are inserted as pending, copied in the object store after commit, then marked ready,
 * so a failed object copy never leaves a visible file without bytes.
 */
export async function copyFileNodes(userId: string, ids: string[], parentId: string | null): Promise<FileNode[]> {
  const planned = await db.transaction(async (tx) => {
    // Storage before tree, matching upload reservations, so the two locks cannot deadlock.
    await lockAccountStorage(tx, userId)
    await lockFileTree(tx, userId)
    const roots = await topLevelIds(tx, userId, ids)
    const trees = await Promise.all(roots.map((rootId) => liveSubtree(tx, userId, rootId)))
    if (trees.some((tree) => !tree.length)) throw notFound('File')
    const baseDepth = await destinationDepth(tx, userId, parentId)
    const ancestors = parentId ? new Set(await chainIds(tx, userId, parentId)) : new Set<string>()
    for (const tree of trees) {
      if (ancestors.has(tree[0]!.id)) throw new AppError(400, 'file_move_cycle', 'A folder cannot be copied into itself')
      if (baseDepth + Math.max(...tree.map((node) => node.depth)) > FILE_TREE_MAX_DEPTH) throw treeTooDeep()
    }
    const bytes = trees.flat().reduce((total, node) => total + node.sizeBytes, 0)
    await assertStorageCapacity(tx, userId, bytes, { perFileLimit: false })

    const taken = await liveSiblingNames(tx, userId, parentId)
    const newIds = new Map<string, string>()
    const rootIds: string[] = []
    const blobCopies: Array<{ id: string; source: string; target: string }> = []
    for (const tree of trees) {
      for (const node of tree) {
        const id = newId()
        newIds.set(node.id, id)
        const root = node.depth === 0
        const name = root ? nextAvailableName(node.name, taken) : node.name
        if (root) {
          taken.add(name.toLowerCase())
          rootIds.push(id)
        }
        const objectKey = node.kind === 'blob' ? `users/${userId}/files/${id}` : null
        await tx.insert(fileNodes).values({
          id, ownerUserId: userId, parentId: root ? parentId : newIds.get(node.parentId!)!,
          kind: node.kind, name, mimeType: node.mimeType, sizeBytes: node.sizeBytes,
          checksum: node.checksum, objectKey, status: node.kind === 'blob' ? 'pending' : 'ready',
        })
        if (node.kind === 'doc') {
          const state = await mergedDocState(tx, node.id)
          await tx.insert(fileDocs).values({
            nodeId: id, state, stateBytes: state.byteLength, markdown: docMarkdown(state), schemaVersion: DOC_SCHEMA_VERSION,
          })
        }
        if (objectKey) blobCopies.push({ id, source: node.objectKey!, target: objectKey })
      }
    }
    return { rootIds, blobCopies, changes: await bumpAccountRevisions(tx, [userId]) }
  })
  await publishScopedStateChanges(planned.changes, ['files'])

  const copied: string[] = []
  const failed: string[] = []
  for (const blob of planned.blobCopies) {
    try {
      await getBlobStore().copy(blob.source, blob.target)
      copied.push(blob.id)
    } catch {
      failed.push(blob.id)
    }
  }
  const nodes = await mutateFileTree(userId, async (tx) => {
    if (copied.length) {
      await tx.update(fileNodes).set({ status: 'ready', updatedAt: new Date() })
        .where(and(eq(fileNodes.ownerUserId, userId), inArray(fileNodes.id, copied)))
    }
    // Nothing was stored for these; drop the placeholders so they stop counting against storage.
    if (failed.length) await tx.delete(fileNodes).where(and(eq(fileNodes.ownerUserId, userId), inArray(fileNodes.id, failed)))
    const rows = await tx.select().from(fileNodes).where(inArray(fileNodes.id, planned.rootIds))
    const order = new Map(planned.rootIds.map((id, index) => [id, index]))
    return rows.sort((left, right) => order.get(left.id)! - order.get(right.id)!).map(toFileNode)
  })
  if (failed.length) throw new AppError(502, 'file_copy_failed', 'Some files could not be copied')
  return nodes
}

/** Attachment names are not checked against Files rules, so fall back when one would be rejected. */
function attachmentFileName(name: string): string {
  const normalized = normalizeFileName(name.replaceAll('/', '_'))
  return fileNameError(normalized) ? 'Attachment' : normalized
}

/**
 * Saves a copy of one of the user's chat attachments into `parentId`. Like uploaded copies, the
 * node is reserved as pending, filled in the object store after commit, then marked ready.
 */
export async function saveAttachmentToFiles(userId: string, attachmentId: string, parentId: string | null): Promise<FileNode> {
  const attachment = await readyAttachment(userId, attachmentId)
  if (!attachment) throw notFound('Attachment')
  const id = newId()
  const objectKey = `users/${userId}/files/${id}`
  const changes = await db.transaction(async (tx) => {
    await assertStorageCapacity(tx, userId, attachment.sizeBytes, { perFileLimit: false })
    await lockFileTree(tx, userId)
    await destinationDepth(tx, userId, parentId)
    const name = nextAvailableName(attachmentFileName(attachment.originalName), await liveSiblingNames(tx, userId, parentId))
    await tx.insert(fileNodes).values({
      id, ownerUserId: userId, parentId, kind: 'blob', name, mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes, checksum: attachment.checksum, objectKey, status: 'pending',
    })
    return bumpAccountRevisions(tx, [userId])
  })
  await publishScopedStateChanges(changes, ['files'])

  let copied = true
  try {
    await getBlobStore().copy(attachment.objectKey, objectKey)
  } catch {
    copied = false
  }
  const node = await mutateFileTree(userId, async (tx) => {
    if (!copied) {
      // Nothing was stored; drop the placeholder so it stops counting against storage.
      await tx.delete(fileNodes).where(and(eq(fileNodes.ownerUserId, userId), eq(fileNodes.id, id)))
      return null
    }
    const [ready] = await tx.update(fileNodes).set({ status: 'ready', updatedAt: new Date() })
      .where(and(eq(fileNodes.ownerUserId, userId), eq(fileNodes.id, id))).returning()
    return ready ? toFileNode(ready) : null
  })
  if (!copied) throw new AppError(502, 'file_copy_failed', 'The attachment could not be saved to Files')
  if (!node) throw notFound('File')
  return node
}
