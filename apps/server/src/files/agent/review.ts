import { and, asc, eq, inArray } from 'drizzle-orm'
import { Transform } from '@tiptap/pm/transform'
import { resolveSuggestions, ydocToNode, type SuggestionAction } from '@pulpo/client-core/doc-schema'
import type { FileChangeKind, FileChangesResponse, FileNode } from '@pulpo/contracts'
import { fileChanges, fileNodes } from '../../database/schema.js'
import { AppError, notFound } from '../../lib/errors.js'
import { resolveFileAccess, type FileNodeRow } from '../access.js'
import { moveNodeInTx, topLevelIds, toFileNode, trashNodeInTx } from '../tree-service.js'
import { listFileChanges, parsePlace, setChangeStatus, type FileChangeRow } from './changes.js'
import { mutateAgentFiles, TREE_AND_CHAT_SCOPES, type CommitEffects, type DatabaseTransaction } from './commit.js'
import { loadDocInTx, lockDocs, writeDocInTx } from './docs.js'
import { purgeSuggestedInTx } from './mutations.js'
import { blobSnapshot, dropVersion, parseBlobSnapshot, releaseBlob } from './versions.js'

interface Review {
  tx: DatabaseTransaction
  effects: CommitEffects
  userId: string
  row: FileChangeRow
  node: FileNodeRow
  action: SuggestionAction
}

const stale = (message: string) => new AppError(409, 'file_suggestion_stale', message)

/** Accepting keeps the suggestion's insertions and drops its deletions; rejecting does the reverse. */
async function reviewDoc({ tx, effects, userId, row, node, action }: Review): Promise<void> {
  if (node.kind !== 'doc') return
  const doc = await loadDocInTx(tx, node.id)
  const resolved = resolveSuggestions(new Transform(ydocToNode(doc)), (ref) => ref.changeId === row.id, action)
  if (resolved.docChanged) await writeDocInTx(tx, effects, { nodeId: node.id, doc, node: resolved.doc, actorUserId: userId, origin: 'client' })
}

/** The proposed content becomes the file's (the replaced content is not kept), or is dropped. */
async function reviewBlob({ tx, effects, userId, row, node, action }: Review): Promise<void> {
  const proposed = parseBlobSnapshot(row.after)
  if (!proposed) return
  if (action === 'reject') return releaseBlob(tx, effects, userId, node.id, proposed)
  if (node.kind !== 'blob') throw stale(`"${node.name}" is no longer an uploaded file, so the suggested content cannot replace it`)
  const previous = blobSnapshot(node)
  await tx.update(fileNodes).set({ ...proposed, updatedAt: new Date() }).where(eq(fileNodes.id, node.id))
  await dropVersion(tx, proposed.objectKey)
  await releaseBlob(tx, effects, userId, node.id, previous)
}

/** Accepting makes suggested items ordinary ones; rejecting deletes them for good. */
async function reviewCreation(tx: DatabaseTransaction, effects: CommitEffects, userId: string, changeId: string, action: SuggestionAction): Promise<void> {
  const owned = and(eq(fileNodes.ownerUserId, userId), eq(fileNodes.suggestionChangeId, changeId))
  if (action === 'accept') {
    await tx.update(fileNodes).set({ suggestionChangeId: null }).where(owned)
    return
  }
  const ids = (await tx.select({ id: fileNodes.id }).from(fileNodes).where(owned)).map((row) => row.id)
  await purgeSuggestedInTx(tx, effects, userId, changeId, await topLevelIds(tx, userId, ids))
}

async function reviewMove({ tx, userId, row, node, action }: Review): Promise<void> {
  const target = parsePlace(row.after)
  if (action === 'reject' || !target) return
  if (node.trashedAt) throw stale(`"${node.name}" is in the trash, so it cannot be moved`)
  if (target.parentId) {
    const folder = (await resolveFileAccess(tx, userId, target.parentId))?.node
    if (!folder || folder.trashedAt) throw stale(`The folder "${node.name}" would move to no longer exists`)
  }
  // Someone may have taken the name meanwhile; keep both, like any move in Files.
  await moveNodeInTx(tx, userId, node, { ...target, onConflict: 'rename' })
}

async function reviewTrash({ tx, effects, userId, node, action }: Review): Promise<void> {
  if (action === 'reject' || node.trashedAt) return
  effects.closedDocs.push({ ids: await trashNodeInTx(tx, userId, node), reason: 'trashed' })
}

const REVIEWS: Record<FileChangeKind, (review: Review) => Promise<void>> = {
  create: (review) => reviewCreation(review.tx, review.effects, review.userId, review.row.id, review.action),
  update: (review) => review.row.after ? reviewBlob(review) : reviewDoc(review),
  move: reviewMove,
  trash: reviewTrash,
}

/**
 * Reviews pending suggestions together. Accepting goes in the order the agent made them (a new
 * folder before what moves into it); rejecting leaves new items for last, since deleting them
 * also removes the suggestions about their contents.
 */
async function reviewRows(tx: DatabaseTransaction, effects: CommitEffects, userId: string, rows: FileChangeRow[], action: SuggestionAction): Promise<void> {
  const ordered = action === 'accept' ? rows : [...rows.filter((row) => row.kind !== 'create'), ...rows.filter((row) => row.kind === 'create')]
  const nodes = await tx.select().from(fileNodes).where(inArray(fileNodes.id, rows.map((row) => row.nodeId)))
  await lockDocs(tx, nodes.filter((node) => node.kind === 'doc').map((node) => node.id))
  for (const row of ordered) {
    const [current] = await tx.select({ status: fileChanges.status }).from(fileChanges).where(eq(fileChanges.id, row.id))
    const node = (await resolveFileAccess(tx, userId, row.nodeId))?.node
    if (current?.status !== 'pending' || !node) continue
    // Settled first, so the proposal no longer counts as needing its content.
    await setChangeStatus(tx, [row.id], action === 'accept' ? 'accepted' : 'rejected')
    await REVIEWS[row.kind as FileChangeKind]({ tx, effects, userId, row, node, action })
  }
}

/** Accepts or rejects every pending suggestion of a reply. */
export async function reviewReplyChanges(userId: string, responseId: string, action: SuggestionAction): Promise<FileChangesResponse> {
  await mutateAgentFiles(userId, async (tx, effects) => {
    const rows = await tx.select().from(fileChanges).where(and(
      eq(fileChanges.responseId, responseId), eq(fileChanges.userId, userId), eq(fileChanges.mode, 'suggest'), eq(fileChanges.status, 'pending'),
    )).orderBy(asc(fileChanges.seq))
    await reviewRows(tx, effects, userId, rows, action)
  }, { scopes: TREE_AND_CHAT_SCOPES })
  return listFileChanges(userId, responseId)
}

/** Accepts or rejects one suggestion; answers with its reply's changes. */
export async function reviewFileChange(userId: string, changeId: string, action: SuggestionAction): Promise<FileChangesResponse> {
  const responseId = await mutateAgentFiles(userId, async (tx, effects) => {
    const [row] = await tx.select().from(fileChanges).where(and(eq(fileChanges.id, changeId), eq(fileChanges.userId, userId))).limit(1)
    if (!row) throw notFound('Change')
    if (row.mode !== 'suggest') throw new AppError(409, 'file_change_not_suggestion', 'Only suggestions can be accepted or rejected')
    await reviewRows(tx, effects, userId, [row], action)
    return row.responseId
  }, { scopes: TREE_AND_CHAT_SCOPES })
  return listFileChanges(userId, responseId)
}

/**
 * Accepts or rejects the suggestion an item belongs to (it was suggested as new), with or
 * without a change row: backups restore suggested items but not change history.
 */
export async function reviewNodeSuggestion(userId: string, nodeId: string, action: SuggestionAction): Promise<{ node: FileNode | null }> {
  return mutateAgentFiles(userId, async (tx, effects) => {
    const node = (await resolveFileAccess(tx, userId, nodeId))?.node
    if (!node) throw notFound('File')
    const changeId = node.suggestionChangeId
    if (!changeId) throw new AppError(409, 'file_not_suggestion', 'This item is not a suggestion')
    await setChangeStatus(tx, [changeId], action === 'accept' ? 'accepted' : 'rejected')
    await reviewCreation(tx, effects, userId, changeId, action)
    const [current] = await tx.select().from(fileNodes).where(eq(fileNodes.id, nodeId))
    return { node: current ? toFileNode(current) : null }
  }, { scopes: TREE_AND_CHAT_SCOPES })
}
