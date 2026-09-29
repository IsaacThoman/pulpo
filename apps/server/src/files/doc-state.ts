import { asc, eq } from 'drizzle-orm'
import * as Y from 'yjs'
import { applyMarkdownToYDoc, ydocToMarkdown } from '@pulpo/client-core/doc-schema'
import { db } from '../database/client.js'
import { fileDocs, fileDocUpdates } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** A document's full state inside a transaction: its snapshot merged with every logged update. */
export async function mergedDocState(tx: DatabaseTransaction, nodeId: string): Promise<Uint8Array> {
  const [doc] = await tx.select({ state: fileDocs.state }).from(fileDocs).where(eq(fileDocs.nodeId, nodeId))
  if (!doc) throw notFound('Document')
  const rows = await tx.select({ update: fileDocUpdates.update }).from(fileDocUpdates)
    .where(eq(fileDocUpdates.nodeId, nodeId)).orderBy(asc(fileDocUpdates.seq))
  return rows.length ? Y.mergeUpdates([doc.state, ...rows.map((row) => row.update)]) : doc.state
}

/** Past this size a document stops accepting edits; keeps loads and compaction bounded. */
export const MAX_DOC_STATE_BYTES = 8_000_000
export const docTooLarge = () => new AppError(413, 'doc_too_large', 'This document is too large to edit')
export function initialDocState(markdown?: string): { state: Uint8Array; markdown: string } {
  const doc = new Y.Doc()
  if (markdown?.trim()) applyMarkdownToYDoc(doc, markdown, 'import')
  const state = Y.encodeStateAsUpdate(doc)
  if (state.byteLength > MAX_DOC_STATE_BYTES) throw docTooLarge()
  return { state, markdown: ydocToMarkdown(doc) }
}
