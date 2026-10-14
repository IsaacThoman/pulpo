import { and, eq, ne, sql } from 'drizzle-orm'
import { mergeMarkdown, ydocToNode } from '@pulpo/client-core/doc-schema'
import { FILE_TREE_MAX_DEPTH, isMarkdownName } from '@pulpo/contracts'
import { fileChanges, fileNodes } from '../../database/schema.js'
import { AppError, notFound } from '../../lib/errors.js'
import { newId } from '../../lib/ids.js'
import { resolveFileAccess, type FileNodeRow } from '../access.js'
import { createDocInTx } from '../doc-store.js'
import { topSortOrder } from '../order.js'
import {
  assertDestination,
  assertMovable,
  assertNameAvailable,
  createFolderInTx,
  moveNodeInTx,
  purgeNodesInTx,
  systemFolderLocked,
  trashNodeInTx,
} from '../tree-service.js'
import { deleteChange, findChange, parsePlace, recordChange, setChangeStatus, type FileChangeRow, type Place, type ReplyContext } from './changes.js'
import { deleteObjects, mutateAgentFiles, TREE_AND_CHAT_SCOPES, type CommitEffects, type DatabaseTransaction } from './commit.js'
import { loadDocInTx, lockDocs, markdownVersion, proposedMarkdown, writeDocInTx } from './docs.js'
import { FilesCommandError } from './scope.js'
import {
  blobSnapshot,
  blobVersion,
  keepVersion,
  parseBlobSnapshot,
  pendingBlobProposal,
  releaseBlob,
  setBlobContent,
  storeBlob,
} from './versions.js'

export type ChangeMode = 'write' | 'suggest'
export type CreateStatus = 'created' | 'suggested'

export interface ContentResult {
  status: 'updated' | 'suggested' | 'unchanged' | 'conflict'
  /** The item's version as the agent sees it afterwards (or now, for conflicts). */
  version: string
  /** New document hunks, for documents. */
  hunks?: number
}

/** A live, ready item inside a tree transaction. */
export async function liveNodeInTx(tx: DatabaseTransaction, userId: string, id: string): Promise<FileNodeRow> {
  const node = (await resolveFileAccess(tx, userId, id))?.node
  if (!node || node.trashedAt || node.status !== 'ready') throw new FilesCommandError('The item no longer exists in Files; list its folder again')
  return node
}

/**
 * Items the agent itself added take later changes directly, without rows of their own: one
 * awaiting review is part of that suggestion, and one this reply created is undone with its
 * creation.
 */
async function foldedInto(tx: DatabaseTransaction, reply: ReplyContext, node: FileNodeRow): Promise<'suggestion' | 'creation' | null> {
  if (node.suggestionChangeId) return 'suggestion'
  return (await findChange(tx, reply.responseId, node.id, 'create'))?.mode === 'write' ? 'creation' : null
}

/** The Markdown parser rejects a few malformed inputs; the agent can fix the file and push again. */
function parsedMarkdown<T>(parse: () => T): T {
  try {
    return parse()
  } catch (error) {
    if (error instanceof AppError || error instanceof FilesCommandError) throw error
    throw new FilesCommandError(`Pulpo could not read this Markdown (${error instanceof Error ? error.message : String(error)}); simplify the part you changed and push again`)
  }
}

function assertRowMode(existing: FileChangeRow | undefined, mode: ChangeMode): void {
  if (existing && existing.mode !== mode) {
    throw new FilesCommandError('The access to this item changed during this reply; it can change again in the next one')
  }
}

/**
 * How a new item lands: inside an item awaiting review it joins that suggestion; in Suggest
 * mode it is a suggestion of its own; in Write mode it is simply there.
 */
async function newItemPlan(tx: DatabaseTransaction, userId: string, parentId: string | null, mode: ChangeMode) {
  const parent = parentId ? (await resolveFileAccess(tx, userId, parentId))?.node : null
  if (parentId && (!parent || parent.trashedAt || parent.kind !== 'folder')) throw notFound('Folder')
  if (parent?.suggestionChangeId) return { suggestionChangeId: parent.suggestionChangeId, rowId: null }
  const rowId = newId()
  return { suggestionChangeId: mode === 'suggest' ? rowId : null, rowId }
}

async function recordCreation(tx: DatabaseTransaction, reply: ReplyContext, node: FileNodeRow, rowId: string | null, mode: ChangeMode): Promise<CreateStatus> {
  if (rowId) await recordChange(tx, reply, { id: rowId, nodeId: node.id, mode, kind: 'create', after: { parentId: node.parentId, name: node.name } })
  return node.suggestionChangeId ? 'suggested' : 'created'
}

export async function createFolderChange(reply: ReplyContext, parentId: string | null, name: string, mode: ChangeMode) {
  return mutateAgentFiles(reply.userId, async (tx) => {
    const plan = await newItemPlan(tx, reply.userId, parentId, mode)
    const node = await createFolderInTx(tx, reply.userId, { parentId, name, suggestionChangeId: plan.suggestionChangeId })
    return { node, status: await recordCreation(tx, reply, node, plan.rowId, mode) }
  })
}

export async function createDocChange(reply: ReplyContext, parentId: string | null, name: string, markdown: string, mode: ChangeMode) {
  return mutateAgentFiles(reply.userId, async (tx) => {
    const plan = await newItemPlan(tx, reply.userId, parentId, mode)
    const node = await createDocInTx(tx, reply.userId, { parentId, name, markdown, exactName: true, suggestionChangeId: plan.suggestionChangeId })
    const status = await recordCreation(tx, reply, node, plan.rowId, mode)
    return { node, status, version: markdownVersion(proposedMarkdown(ydocToNode(await loadDocInTx(tx, node.id)))) }
  })
}

/** Stores the bytes first; the object is deleted again unless the new file commits. */
export async function createBlobChange(reply: ReplyContext, parentId: string | null, name: string, bytes: Uint8Array, mode: ChangeMode) {
  const content = await storeBlob(reply.userId, name, bytes)
  try {
    return await mutateAgentFiles(reply.userId, async (tx) => {
      const plan = await newItemPlan(tx, reply.userId, parentId, mode)
      await assertDestination(tx, reply.userId, parentId)
      await assertNameAvailable(tx, reply.userId, parentId, name)
      const [node] = await tx.insert(fileNodes).values({
        id: newId(), ownerUserId: reply.userId, parentId, kind: 'blob', name, ...content,
        sortOrder: await topSortOrder(tx, reply.userId, parentId), suggestionChangeId: plan.suggestionChangeId,
      }).returning()
      return { node: node!, status: await recordCreation(tx, reply, node!, plan.rowId, mode), version: blobVersion(content) }
    }, { reserveBytes: bytes.byteLength })
  } catch (error) {
    await deleteObjects([content.objectKey])
    throw error
  }
}

/**
 * Merges the agent's Markdown into a document: as inline suggestions tagged with the reply's
 * change id (Suggest mode), or directly with the document before and after kept for undo.
 * `expectedVersion` (null: forced) must still match what the agent last pulled.
 */
export async function updateDocChange(reply: ReplyContext, nodeId: string, markdown: string, mode: ChangeMode, expectedVersion: string | null): Promise<ContentResult> {
  return mutateAgentFiles(reply.userId, async (tx, effects) => {
    await lockDocs(tx, [nodeId])
    const node = await liveNodeInTx(tx, reply.userId, nodeId)
    if (node.kind !== 'doc') throw new FilesCommandError('This item is no longer a Markdown document; pull it again')
    const doc = await loadDocInTx(tx, node.id)
    const current = ydocToNode(doc)
    const version = markdownVersion(proposedMarkdown(current))
    if (expectedVersion !== null && version !== expectedVersion) return { status: 'conflict', version }
    const folded = await foldedInto(tx, reply, node)
    const existing = folded ? undefined : await findChange(tx, reply.responseId, node.id, 'update')
    assertRowMode(existing, mode)
    const changeId = existing?.id ?? newId()
    const merged = parsedMarkdown(() => mergeMarkdown(current, markdown, { mode: folded ? 'write' : mode, changeId }))
    if (!merged.changed) return { status: 'unchanged', version }
    await writeDocInTx(tx, effects, { nodeId: node.id, doc, node: merged.doc, actorUserId: reply.userId, origin: 'agent' })
    // Read back from the Y document, so undo compares against exactly what it holds.
    const written = ydocToNode(doc)
    // A suggestion that only revised text earlier suggestions inserted stays with those.
    const ownHunks = mode === 'write' || existing || merged.hunks > 0
    if (!folded && ownHunks) {
      await recordChange(tx, reply, {
        id: changeId, nodeId: node.id, mode, kind: 'update',
        ...mode === 'write' ? { before: { doc: current.toJSON() }, after: { doc: written.toJSON() } } : {},
      })
    }
    const direct = folded === 'creation' || (!folded && mode === 'write')
    return { status: direct ? 'updated' : 'suggested', version: markdownVersion(proposedMarkdown(written)), hunks: merged.hunks }
  })
}

/** A newer proposal of content for a file replaces this chat's earlier ones from other replies. */
async function supersedeProposals(tx: DatabaseTransaction, effects: CommitEffects, reply: ReplyContext, nodeId: string): Promise<void> {
  const older = await tx.select().from(fileChanges).where(and(
    eq(fileChanges.chatId, reply.chatId), eq(fileChanges.nodeId, nodeId), eq(fileChanges.kind, 'update'),
    eq(fileChanges.mode, 'suggest'), eq(fileChanges.status, 'pending'), ne(fileChanges.responseId, reply.responseId),
  ))
  await setChangeStatus(tx, older.map((row) => row.id), 'rejected')
  for (const row of older) {
    const proposed = parseBlobSnapshot(row.after)
    if (proposed) await releaseBlob(tx, effects, reply.userId, nodeId, proposed)
  }
}

/**
 * Replaces an uploaded file's bytes (Write mode, or a file awaiting review), keeping the earlier
 * content as a version for undo, or proposes them (Suggest mode) as a version awaiting review.
 */
export async function updateBlobChange(reply: ReplyContext, node: FileNodeRow, bytes: Uint8Array, mode: ChangeMode, expectedVersion: string | null): Promise<ContentResult> {
  const content = await storeBlob(reply.userId, node.name, bytes, node.mimeType)
  let kept = false
  try {
    const result = await mutateAgentFiles(reply.userId, async (tx, effects): Promise<ContentResult> => {
      const current = await liveNodeInTx(tx, reply.userId, node.id)
      if (current.kind !== 'blob') throw new FilesCommandError('This item is no longer an uploaded file; pull it again')
      const view = (await pendingBlobProposal(tx, reply.chatId, current.id))?.after ?? blobSnapshot(current)
      if (expectedVersion !== null && blobVersion(view) !== expectedVersion) return { status: 'conflict', version: blobVersion(view) }
      if (view.checksum === content.checksum) return { status: 'unchanged', version: blobVersion(view) }
      const folded = await foldedInto(tx, reply, current)
      const existing = folded ? undefined : await findChange(tx, reply.responseId, current.id, 'update')
      if (folded || mode === 'write') {
        assertRowMode(existing, 'write')
        await setBlobContent(tx, current.id, content)
        if (!folded) await recordChange(tx, reply, { nodeId: current.id, mode: 'write', kind: 'update', before: blobSnapshot(current), after: content })
        await supersedeProposals(tx, effects, reply, current.id)
        await releaseBlob(tx, effects, reply.userId, current.id, blobSnapshot(current))
        return { status: folded === 'suggestion' ? 'suggested' : 'updated', version: blobVersion(content) }
      }
      assertRowMode(existing, 'suggest')
      await supersedeProposals(tx, effects, reply, current.id)
      await keepVersion(tx, reply.userId, current.id, content)
      await recordChange(tx, reply, { nodeId: current.id, mode: 'suggest', kind: 'update', before: blobSnapshot(current), after: content })
      const replaced = parseBlobSnapshot(existing?.after)
      if (replaced) await releaseBlob(tx, effects, reply.userId, current.id, replaced)
      return { status: 'suggested', version: blobVersion(content) }
    }, { reserveBytes: bytes.byteLength })
    kept = result.status === 'updated' || result.status === 'suggested'
    return result
  } finally {
    if (!kept) await deleteObjects([content.objectKey])
  }
}

export async function moveChange(reply: ReplyContext, nodeId: string, target: Place, mode: ChangeMode): Promise<'moved' | 'suggested' | 'unchanged'> {
  return mutateAgentFiles(reply.userId, async (tx) => {
    const node = await liveNodeInTx(tx, reply.userId, nodeId)
    if (node.systemRole) throw systemFolderLocked()
    if (node.kind === 'doc' && !isMarkdownName(target.name)) {
      throw new FilesCommandError('Documents keep a .md name: another extension would turn this one into an ordinary file')
    }
    if (node.parentId === target.parentId && node.name === target.name) return 'unchanged'
    const folded = await foldedInto(tx, reply, node)
    const existing = folded ? undefined : await findChange(tx, reply.responseId, node.id, 'move')
    if (folded || mode === 'write') {
      assertRowMode(existing, 'write')
      const before = parsePlace(existing?.before) ?? { parentId: node.parentId, name: node.name }
      const { row } = await moveNodeInTx(tx, reply.userId, node, { ...target, onConflict: 'fail' })
      if (folded) return folded === 'suggestion' ? 'suggested' : 'moved'
      // Moving an item back where the reply found it leaves nothing to undo.
      if (existing && before.parentId === row.parentId && before.name === row.name) await deleteChange(tx, existing.id)
      else await recordChange(tx, reply, { nodeId: node.id, mode: 'write', kind: 'move', before: { ...before }, after: { parentId: row.parentId, name: row.name } })
      return 'moved'
    }
    assertRowMode(existing, 'suggest')
    await assertMovable(tx, reply.userId, node, target.parentId)
    await assertNameAvailable(tx, reply.userId, target.parentId, target.name, node.id)
    await recordChange(tx, reply, { nodeId: node.id, mode: 'suggest', kind: 'move', before: { parentId: node.parentId, name: node.name }, after: { ...target } })
    return 'suggested'
  })
}

/**
 * Permanently deletes items that are (part of) the suggestion `changeId`. Items inside them that
 * are not part of it, such as the owner's own files, are kept: they move up to where the
 * suggestion sits.
 */
export async function purgeSuggestedInTx(tx: DatabaseTransaction, effects: CommitEffects, userId: string, changeId: string, rootIds: string[]): Promise<void> {
  for (const rootId of rootIds) {
    const root = (await resolveFileAccess(tx, userId, rootId))?.node
    if (!root) continue
    const foreign = await tx.execute<{ id: string }>(sql`
      with recursive tree(id, suggestion_change_id, depth) as (
        select id, suggestion_change_id, 0 from file_nodes where id = ${rootId} and owner_user_id = ${userId}
        union all
        select node.id, node.suggestion_change_id, tree.depth + 1 from file_nodes node
        join tree on node.parent_id = tree.id
        where tree.suggestion_change_id = ${changeId} and tree.depth < ${FILE_TREE_MAX_DEPTH * 2}
      )
      select tree.id::text as id from tree join file_nodes node on node.id = tree.id
      where tree.depth > 0 and tree.suggestion_change_id is distinct from ${changeId} and node.trashed_at is null and node.status = 'ready'
    `)
    for (const { id } of foreign) {
      const node = (await resolveFileAccess(tx, userId, id))!.node
      await moveNodeInTx(tx, userId, node, { parentId: root.parentId, name: node.name, onConflict: 'rename' })
    }
  }
  effects.closedDocs.push({ ids: await purgeNodesInTx(tx, userId, rootIds, effects.deletedKeys), reason: 'deleted' })
}

export async function trashChange(reply: ReplyContext, nodeId: string, mode: ChangeMode): Promise<'trashed' | 'suggested' | 'withdrawn'> {
  return mutateAgentFiles(reply.userId, async (tx, effects) => {
    const node = await liveNodeInTx(tx, reply.userId, nodeId)
    if (node.systemRole) throw systemFolderLocked()
    // Deleting something the agent suggested adding withdraws (that part of) the suggestion.
    if (node.suggestionChangeId) {
      await purgeSuggestedInTx(tx, effects, reply.userId, node.suggestionChangeId, [node.id])
      return 'withdrawn'
    }
    if (mode === 'suggest') {
      await recordChange(tx, reply, { nodeId: node.id, mode, kind: 'trash', before: { parentId: node.parentId, name: node.name } })
      return 'suggested'
    }
    effects.closedDocs.push({ ids: await trashNodeInTx(tx, reply.userId, node), reason: 'trashed' })
    await recordChange(tx, reply, { nodeId: node.id, mode, kind: 'trash', before: { parentId: node.parentId, name: node.name } })
    return 'trashed'
  }, { scopes: TREE_AND_CHAT_SCOPES })
}
