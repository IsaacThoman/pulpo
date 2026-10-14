import { and, asc, count, eq, inArray, lt, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { listSuggestions, ydocToNode } from '@pulpo/client-core/doc-schema'
import type { FileChangeKind, FileChangeStatus, FileChangesResponse, FileChangeSummary } from '@pulpo/contracts'
import { db } from '../../database/client.js'
import { fileChanges, fileNodes, fileVersions } from '../../database/schema.js'
import { newId } from '../../lib/ids.js'
import type { FileExecutor, FileNodeRow } from '../access.js'
import { loadYDoc } from '../doc-store.js'
import { baseMarkdown } from './docs.js'
import type { DatabaseTransaction } from './commit.js'
import { filesPathOf } from './scope.js'
import { deleteUnusedVersions, parseBlobSnapshot } from './versions.js'

export type FileChangeRow = typeof fileChanges.$inferSelect

/** The agent reply a change belongs to. */
export interface ReplyContext {
  userId: string
  chatId: string
  responseId: string
  /**
   * Re-checks inside the change's transaction what the command decided outside it (the access
   * mode), so a change the user makes to the chat's attached items meanwhile is never ignored.
   */
  guard?: (tx: DatabaseTransaction) => Promise<void>
}

/** Where an item is, as move rows record it: its folder (null: the top of My files) and its name. */
export const placeSchema = z.object({ parentId: z.string().nullable(), name: z.string() })
export type Place = z.infer<typeof placeSchema>

export function parsePlace(value: unknown): Place | null {
  return placeSchema.safeParse(value).data ?? null
}

/** Undo history expires after this long; pending suggestions wait for the owner indefinitely. */
export const FILE_CHANGE_RETENTION_MS = 30 * 86_400_000

export async function findChange(executor: FileExecutor, responseId: string, nodeId: string, kind: FileChangeKind): Promise<FileChangeRow | undefined> {
  const [row] = await executor.select().from(fileChanges).where(and(
    eq(fileChanges.responseId, responseId), eq(fileChanges.nodeId, nodeId), eq(fileChanges.kind, kind),
  )).limit(1)
  return row
}

/**
 * Records a change. A repeated change of the same kind to the same item in one reply folds into
 * its row: `before` stays what the reply started from, while `after` and the status follow the
 * latest change. A suggestion the owner already reviewed starts over as a new one.
 */
export async function recordChange(tx: DatabaseTransaction, reply: ReplyContext, input: {
  id?: string
  nodeId: string
  mode: 'write' | 'suggest'
  kind: FileChangeKind
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}): Promise<FileChangeRow> {
  const status: FileChangeStatus = input.mode === 'write' ? 'applied' : 'pending'
  const [row] = await tx.insert(fileChanges).values({
    id: input.id ?? newId(), userId: reply.userId, chatId: reply.chatId, responseId: reply.responseId,
    nodeId: input.nodeId, mode: input.mode, kind: input.kind, status, before: input.before ?? null, after: input.after ?? null,
  }).onConflictDoUpdate({
    target: [fileChanges.responseId, fileChanges.nodeId, fileChanges.kind],
    set: {
      before: sql`case when ${fileChanges.mode} = 'suggest' and ${fileChanges.status} <> 'pending' then excluded.before else ${fileChanges.before} end`,
      after: input.after ?? null,
      status,
      updatedAt: new Date(),
    },
  }).returning()
  return row!
}

/** Later changes a reply made to an item it created fold into the creation's `after`. */
export async function updateCreation(tx: DatabaseTransaction, reply: ReplyContext, nodeId: string, patch: Record<string, unknown>): Promise<void> {
  await tx.update(fileChanges).set({ after: sql`coalesce(${fileChanges.after}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() })
    .where(and(eq(fileChanges.responseId, reply.responseId), eq(fileChanges.nodeId, nodeId), eq(fileChanges.kind, 'create')))
}

export async function deleteChange(tx: DatabaseTransaction, id: string): Promise<void> {
  await tx.delete(fileChanges).where(eq(fileChanges.id, id))
}

export async function setChangeStatus(tx: DatabaseTransaction, ids: string[], status: FileChangeStatus): Promise<void> {
  if (ids.length) await tx.update(fileChanges).set({ status, updatedAt: new Date() }).where(inArray(fileChanges.id, ids))
}

/** How many items a reply changed, for its `pulpo_file_changes` output item. */
export async function countFileChanges(responseId: string): Promise<number> {
  const [row] = await db.select({ value: count() }).from(fileChanges).where(eq(fileChanges.responseId, responseId))
  return row?.value ?? 0
}

/**
 * A document suggestion's unresolved hunks and, once none remain, how the owner resolved them
 * in the editor: rejected when the document reads as it did before the suggestion, accepted
 * (at least in part) otherwise. Nothing when the document cannot be read.
 */
async function docSuggestionState(nodeId: string, change: FileChangeRow): Promise<{ hunks: number; resolvedAs: FileChangeStatus } | undefined> {
  try {
    const doc = ydocToNode(await loadYDoc(nodeId))
    const hunks = listSuggestions(doc).filter((hunk) => hunk.changeId === change.id).length
    const before = (change.before as { markdown?: unknown } | null)?.markdown
    return { hunks, resolvedAs: typeof before === 'string' && baseMarkdown(doc) === before ? 'rejected' : 'accepted' }
  } catch {
    return undefined
  }
}

type ChangeWithNode = { change: FileChangeRow; node: FileNodeRow }

/** Moves read as where the item was and where it goes, from the top of My files. */
async function movePaths(userId: string, change: FileChangeRow): Promise<Pick<FileChangeSummary, 'fromPath' | 'toPath'>> {
  const place = async (value: unknown) => {
    const { parentId, name } = parsePlace(value) ?? { parentId: null, name: '' }
    const folder = await filesPathOf(db, userId, parentId)
    return folder ? `${folder}/${name}` : name
  }
  return { fromPath: await place(change.before), toPath: await place(change.after) }
}

/** Uploaded files show their sizes; the change is unavailable once the content it needs is gone. */
function blobSummary(change: FileChangeRow, node: FileNodeRow, keptKeys: Set<string>): Partial<FileChangeSummary> {
  const before = parseBlobSnapshot(change.before)
  const after = parseBlobSnapshot(change.after)
  const needed = change.mode === 'write' ? [before, after] : change.status === 'pending' ? [after] : []
  const available = needed.every((snapshot) => !snapshot || snapshot.objectKey === node.objectKey || keptKeys.has(snapshot.objectKey))
  return { fromSizeBytes: before?.sizeBytes, toSizeBytes: after?.sizeBytes, available }
}

async function summarize(userId: string, { change, node }: ChangeWithNode, keptKeys: Set<string>): Promise<FileChangeSummary & { resolvedAs?: FileChangeStatus }> {
  const summary: FileChangeSummary = {
    id: change.id,
    nodeId: node.id,
    name: node.name,
    nodeKind: node.kind as FileChangeSummary['nodeKind'],
    mimeType: node.mimeType,
    kind: change.kind as FileChangeKind,
    mode: change.mode as FileChangeSummary['mode'],
    status: change.status as FileChangeStatus,
    available: true,
  }
  if (change.kind === 'move') Object.assign(summary, await movePaths(userId, change))
  if (change.kind === 'update' && node.kind === 'blob') Object.assign(summary, blobSummary(change, node, keptKeys))
  if (change.kind === 'update' && node.kind === 'doc' && change.mode === 'suggest') {
    const state = await docSuggestionState(node.id, change)
    if (state) return { ...summary, pendingSuggestions: state.hunks, resolvedAs: state.resolvedAs }
  }
  return summary
}

/**
 * What an agent reply changed in the owner's Files. Document suggestions the owner resolved in
 * the editor count as reviewed once none of their hunks remain.
 */
export async function listFileChanges(userId: string, responseId: string): Promise<FileChangesResponse> {
  const rows = await db.select({ change: fileChanges, node: fileNodes }).from(fileChanges)
    .innerJoin(fileNodes, eq(fileNodes.id, fileChanges.nodeId))
    .where(and(eq(fileChanges.responseId, responseId), eq(fileChanges.userId, userId)))
    .orderBy(asc(fileChanges.seq))
  const kept = rows.length ? await db.select({ key: fileVersions.objectKey }).from(fileVersions)
    .where(inArray(fileVersions.nodeId, [...new Set(rows.map((row) => row.node.id))])) : []
  const keptKeys = new Set(kept.map((row) => row.key))
  const summaries = await Promise.all(rows.map((row) => summarize(userId, row, keptKeys)))
  for (const summary of summaries) {
    if (summary.status !== 'pending' || summary.pendingSuggestions !== 0 || !summary.resolvedAs) continue
    await db.update(fileChanges).set({ status: summary.resolvedAs, updatedAt: new Date() })
      .where(and(eq(fileChanges.id, summary.id), eq(fileChanges.status, 'pending')))
    summary.status = summary.resolvedAs
  }
  const changes: FileChangeSummary[] = summaries.map(({ resolvedAs: _resolvedAs, ...summary }) => summary)
  const writes = changes.filter((change) => change.mode === 'write')
  return {
    changes,
    canUndo: writes.length > 0 && writes.every((change) => change.status === 'applied' && change.available),
    canRedo: writes.length > 0 && writes.every((change) => change.status === 'undone' && change.available),
  }
}

/**
 * Maintenance: forgets replies' undo history and reviewed suggestions after the retention
 * window (a reply's rows go together, so its undo never becomes partial), then deletes kept
 * contents nothing needs any more.
 */
export async function cleanupFileChanges(now = new Date()): Promise<void> {
  const expired = await db.selectDistinct({ responseId: fileChanges.responseId }).from(fileChanges).where(and(
    ne(fileChanges.status, 'pending'),
    lt(fileChanges.createdAt, new Date(now.getTime() - FILE_CHANGE_RETENTION_MS)),
  )).limit(500)
  if (expired.length) {
    await db.delete(fileChanges).where(and(
      inArray(fileChanges.responseId, expired.map((row) => row.responseId)),
      ne(fileChanges.status, 'pending'),
    ))
  }
  await deleteUnusedVersions()
}
