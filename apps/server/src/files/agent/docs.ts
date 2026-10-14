import { createHash } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import * as Y from 'yjs'
import { applyNodeToYDoc, docJSONToMarkdown, docSchema, docView, ydocToNode } from '@pulpo/client-core/doc-schema'
import { fileDocs } from '../../database/schema.js'
import { appendDocUpdateInTx, loadYDoc, type DocUpdateOrigin } from '../doc-store.js'
import { MAX_DOC_STATE_BYTES, mergedDocState } from '../doc-state.js'
import type { CommitEffects, DatabaseTransaction } from './commit.js'

export type DocNode = ReturnType<typeof ydocToNode>

/** What the agent sees of a document: its Markdown with every pending suggestion accepted. */
export function proposedMarkdown(node: DocNode): string {
  return docJSONToMarkdown(docView(node, 'proposed').toJSON())
}

/** What the owner reads in a document: its Markdown with every pending suggestion rejected. */
export function baseMarkdown(node: DocNode): string {
  return docJSONToMarkdown(docView(node, 'base').toJSON())
}

/** The opaque version the agent sees for a document: a hash of its proposed Markdown. */
export function markdownVersion(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex')
}

export async function readProposedMarkdown(nodeId: string): Promise<string> {
  return proposedMarkdown(ydocToNode(await loadYDoc(nodeId)))
}

export function docFromJSON(json: unknown): DocNode {
  return docSchema().nodeFromJSON(json)
}

/**
 * Locks documents' rows, in a stable order, so their state can be read and rewritten
 * consistently: compaction waits, and client updates that commit meanwhile merge as CRDT edits.
 * Lock before updating the documents' file rows, which compaction also touches.
 */
export async function lockDocs(tx: DatabaseTransaction, nodeIds: string[]): Promise<void> {
  const ids = [...new Set(nodeIds)].sort()
  if (ids.length) await tx.select({ nodeId: fileDocs.nodeId }).from(fileDocs).where(inArray(fileDocs.nodeId, ids)).orderBy(fileDocs.nodeId).for('update')
}

/** A locked document's full state inside the transaction. */
export async function loadDocInTx(tx: DatabaseTransaction, nodeId: string): Promise<Y.Doc> {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, await mergedDocState(tx, nodeId))
  return doc
}

/**
 * Rewrites a loaded document to match `node` as a minimal diff and logs the update; open editors
 * receive it after commit. Returns false when the document already matched.
 */
export async function writeDocInTx(tx: DatabaseTransaction, effects: CommitEffects, input: {
  nodeId: string
  doc: Y.Doc
  node: DocNode
  actorUserId: string
  origin: DocUpdateOrigin
}): Promise<boolean> {
  if (ydocToNode(input.doc).eq(input.node)) return false
  const vector = Y.encodeStateVector(input.doc)
  applyNodeToYDoc(input.doc, input.node, input.origin)
  const update = Y.encodeStateAsUpdate(input.doc, vector)
  // A whole rewritten document can exceed what one client keystroke batch may send.
  const pendingUpdates = await appendDocUpdateInTx(tx, {
    nodeId: input.nodeId, actorUserId: input.actorUserId, update, origin: input.origin, maxBytes: MAX_DOC_STATE_BYTES,
  })
  effects.docUpdates.push({ nodeId: input.nodeId, update, pendingUpdates })
  return true
}
