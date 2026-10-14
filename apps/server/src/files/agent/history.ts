import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { ydocToNode } from '@pulpo/client-core/doc-schema'
import { FILE_TREE_MAX_DEPTH, type FileChangeConflict, type FileChangeKind, type FileChangesResponse } from '@pulpo/contracts'
import { db } from '../../database/client.js'
import { fileChanges, fileNodes, responses } from '../../database/schema.js'
import { AppError } from '../../lib/errors.js'
import { resolveFileAccess, type FileNodeRow } from '../access.js'
import { moveNodeInTx, restoreNodeInTx, trashNodeInTx } from '../tree-service.js'
import { listFileChanges, parsePlace, setChangeStatus, type FileChangeRow } from './changes.js'
import { mutateAgentFiles, TREE_AND_CHAT_SCOPES, type CommitEffects, type DatabaseTransaction } from './commit.js'
import { docFromJSON, loadDocInTx, lockDocs, proposedMarkdown, writeDocInTx } from './docs.js'
import { dropVersion, hasVersion, keepVersion, parseBlobSnapshot, setBlobContent } from './versions.js'

type Direction = 'undo' | 'redo'

/** The item changed after the reply, so undo or redo would overwrite someone else's work. */
export class FileChangesConflictError extends Error {
  constructor(readonly conflicts: FileChangeConflict[]) {
    super('Some of these items changed after the reply')
  }
}

const replyRunning = () => new AppError(409, 'response_in_progress', 'Wait for the reply to finish before undoing its changes')

async function assertReplyFinished(userId: string, responseId: string): Promise<void> {
  const [response] = await db.select({ status: responses.status }).from(responses)
    .where(and(eq(responses.id, responseId), eq(responses.userId, userId))).limit(1)
  if (response && (response.status === 'queued' || response.status === 'in_progress')) throw replyRunning()
}

function conflictFor(row: FileChangeRow, node: Pick<FileNodeRow, 'id' | 'name'>, reason: FileChangeConflict['reason'], extra: Partial<FileChangeConflict> = {}): FileChangeConflict {
  return { changeId: row.id, nodeId: node.id, name: node.name, kind: row.kind as FileChangeKind, reason, ...extra }
}

/** One step of an undo (`from` is the state the reply left, `to` the one before it) or a redo. */
interface Step {
  tx: DatabaseTransaction
  effects: CommitEffects
  userId: string
  row: FileChangeRow
  node: FileNodeRow
  from: unknown
  to: unknown
}

async function trashAgain({ tx, effects, userId, row, node }: Step): Promise<FileChangeConflict | null> {
  if (node.trashedAt) return conflictFor(row, node, 'trashed')
  effects.closedDocs.push({ ids: await trashNodeInTx(tx, userId, node), reason: 'trashed' })
  return null
}

/**
 * Whether a folder the reply created now holds anything the reply did not put there (this
 * reply's own items inside are undone before it): the owner's files, or chats filed in it.
 */
async function holdsOthersWork(tx: DatabaseTransaction, row: FileChangeRow, folderId: string): Promise<boolean> {
  const [result] = await tx.execute<{ held: boolean }>(sql`
    with recursive inside(id, depth) as (
      select ${folderId}::uuid, 0
      union all
      select child.id, inside.depth + 1 from file_nodes child join inside on child.parent_id = inside.id
      where child.trashed_at is null and inside.depth < ${FILE_TREE_MAX_DEPTH * 2}
    )
    select exists (
      select 1 from inside where depth > 0 and not exists (
        select 1 from file_changes created
        where created.response_id = ${row.responseId} and created.node_id = inside.id and created.kind = 'create'
      )
    ) or exists (
      select 1 from chats where chats.folder_id in (select id from inside) and chats.deleted_at is null
    ) as held
  `)
  return Boolean(result?.held)
}

/** Undoing a creation trashes the item, unless someone else's work is in it by now. */
async function undoCreation(step: Step): Promise<FileChangeConflict | null> {
  const { tx, row, node } = step
  if (node.trashedAt) return conflictFor(row, node, 'trashed')
  const created = (step.from ?? {}) as { doc?: unknown; objectKey?: string }
  if (node.kind === 'doc' && created.doc) {
    const current = ydocToNode(await loadDocInTx(tx, node.id))
    const expected = docFromJSON(created.doc)
    if (!current.eq(expected)) return conflictFor(row, node, 'edited', { expected: proposedMarkdown(expected), current: proposedMarkdown(current) })
  }
  if (node.kind === 'blob' && created.objectKey && node.objectKey !== created.objectKey) return conflictFor(row, node, 'replaced')
  if (node.kind === 'folder' && await holdsOthersWork(tx, row, node.id)) return conflictFor(row, node, 'edited')
  return trashAgain(step)
}

async function restoreAgain({ tx, userId, row, node }: Step): Promise<FileChangeConflict | null> {
  if (!node.trashedAt) return conflictFor(row, node, 'restored')
  // Trashed again since, with a folder around it: restoring would bring back more than the reply touched.
  if (node.trashRootId !== node.id) return conflictFor(row, node, 'trashed')
  await restoreNodeInTx(tx, userId, node.id)
  return null
}

async function moveBack({ tx, userId, row, node, from, to }: Step): Promise<FileChangeConflict | null> {
  const expected = parsePlace(from)
  const target = parsePlace(to)
  if (node.trashedAt) return conflictFor(row, node, 'trashed')
  if (!expected || !target || node.parentId !== expected.parentId || node.name !== expected.name) return conflictFor(row, node, 'moved')
  if (target.parentId) {
    const folder = (await resolveFileAccess(tx, userId, target.parentId))?.node
    if (!folder) return conflictFor(row, { id: target.parentId, name: 'The folder it was in' }, 'deleted')
    if (folder.trashedAt) return conflictFor(row, folder, 'trashed')
  }
  // Someone may have taken the name meanwhile; keep both, like any move in Files.
  await moveNodeInTx(tx, userId, node, { ...target, onConflict: 'rename' })
  return null
}

function docSnapshot(value: unknown): unknown {
  return (value as { doc?: unknown } | null)?.doc
}

async function replaceDoc({ tx, effects, userId, row, node, from, to }: Step): Promise<FileChangeConflict | null> {
  if (node.trashedAt) return conflictFor(row, node, 'trashed')
  if (node.kind !== 'doc') return conflictFor(row, node, 'replaced')
  const doc = await loadDocInTx(tx, node.id)
  const current = ydocToNode(doc)
  const expected = docFromJSON(docSnapshot(from))
  if (!current.eq(expected)) {
    return conflictFor(row, node, 'edited', { expected: proposedMarkdown(expected), current: proposedMarkdown(current) })
  }
  await writeDocInTx(tx, effects, { nodeId: node.id, doc, node: docFromJSON(docSnapshot(to)), actorUserId: userId, origin: 'restore' })
  return null
}

async function replaceBlob({ tx, userId, row, node, from, to }: Step): Promise<FileChangeConflict | null> {
  const expected = parseBlobSnapshot(from)
  const target = parseBlobSnapshot(to)
  if (node.trashedAt) return conflictFor(row, node, 'trashed')
  if (node.kind !== 'blob' || !expected || node.objectKey !== expected.objectKey) return conflictFor(row, node, 'replaced')
  if (!target || !await hasVersion(tx, target.objectKey)) return conflictFor(row, node, 'deleted')
  await setBlobContent(tx, node.id, target)
  // The two contents trade places: the target is current again, the other is kept for redo.
  await dropVersion(tx, target.objectKey)
  await keepVersion(tx, userId, node.id, expected)
  return null
}

const STEPS: Record<FileChangeKind, Record<Direction, (step: Step) => Promise<FileChangeConflict | null>>> = {
  create: { undo: undoCreation, redo: restoreAgain },
  trash: { undo: restoreAgain, redo: trashAgain },
  move: { undo: moveBack, redo: moveBack },
  update: {
    undo: (step) => docSnapshot(step.from) ? replaceDoc(step) : replaceBlob(step),
    redo: (step) => docSnapshot(step.from) ? replaceDoc(step) : replaceBlob(step),
  },
}

/**
 * Undoes or redoes every Write-mode change of a reply, all or nothing. Steps run in order
 * (newest first for undo) against the state earlier steps left, so a reply that created and then
 * trashed an item replays correctly. Any item that changed since makes the whole request fail
 * with every conflict found.
 */
async function replay(userId: string, responseId: string, direction: Direction): Promise<FileChangesResponse> {
  await assertReplyFinished(userId, responseId)
  await mutateAgentFiles(userId, async (tx, effects) => {
    const rows = await tx.select().from(fileChanges).where(and(
      eq(fileChanges.responseId, responseId), eq(fileChanges.userId, userId), eq(fileChanges.mode, 'write'),
    )).orderBy(asc(fileChanges.seq))
    const expected = direction === 'undo' ? 'applied' : 'undone'
    if (!rows.length || rows.some((row) => row.status !== expected)) {
      throw new AppError(409, 'file_changes_state', direction === 'undo' ? 'There is nothing to undo' : 'There is nothing to redo')
    }
    const nodes = await tx.select().from(fileNodes).where(and(eq(fileNodes.ownerUserId, userId), inArray(fileNodes.id, rows.map((row) => row.nodeId))))
    await lockDocs(tx, nodes.filter((node) => node.kind === 'doc').map((node) => node.id))
    const conflicts: FileChangeConflict[] = []
    for (const row of direction === 'undo' ? rows.reverse() : rows) {
      // Earlier steps may have moved, trashed, or restored it.
      const node = (await resolveFileAccess(tx, userId, row.nodeId))?.node
      if (!node) continue
      const [from, to] = direction === 'undo' ? [row.after, row.before] : [row.before, row.after]
      const conflict = await STEPS[row.kind as FileChangeKind][direction]({ tx, effects, userId, row, node, from, to })
      if (conflict) conflicts.push(conflict)
    }
    if (conflicts.length) throw new FileChangesConflictError(conflicts)
    await setChangeStatus(tx, rows.map((row) => row.id), direction === 'undo' ? 'undone' : 'applied')
  }, { scopes: TREE_AND_CHAT_SCOPES })
  return listFileChanges(userId, responseId)
}

export async function undoFileChanges(userId: string, responseId: string): Promise<FileChangesResponse> {
  return replay(userId, responseId, 'undo')
}

export async function redoFileChanges(userId: string, responseId: string): Promise<FileChangesResponse> {
  return replay(userId, responseId, 'redo')
}
