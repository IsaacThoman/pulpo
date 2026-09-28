import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { eq } from 'drizzle-orm'
import * as Y from 'yjs'
import { DOC_SCHEMA_VERSION, ydocToMarkdown } from '@pulpo/client-core/doc-schema'
import { FILE_DOC_MAX_MARKDOWN_LENGTH, isMarkdownName, type FileConversionPreview } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { fileDocs, fileNodes } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { getBlobStore } from '../storage/index.js'
import type { FileNodeRow } from './access.js'
import { initialDocState, mergedDocState } from './doc-state.js'

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Uploaded Markdown larger than this stays a read-only file. */
const MAX_EDITABLE_MARKDOWN_BYTES = FILE_DOC_MAX_MARKDOWN_LENGTH

/** Ignores differences no reader would notice: line endings, trailing spaces, and blank-line runs. */
export function normalizeMarkdownForComparison(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function readBlob(key: string): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of await getBlobStore().getStream(key) as Readable) chunks.push(Buffer.from(chunk as Uint8Array))
  return Buffer.concat(chunks)
}

/** The uploaded bytes of a Markdown file, as text, if they can become an editable document. */
async function readMarkdownFile(node: FileNodeRow): Promise<string> {
  if (node.kind !== 'blob' || node.status !== 'ready' || !node.objectKey) throw notFound('File')
  if (!isMarkdownName(node.name)) {
    throw new AppError(400, 'file_not_markdown', 'Only files named .md or .markdown can be edited')
  }
  if (node.sizeBytes > MAX_EDITABLE_MARKDOWN_BYTES) {
    throw new AppError(413, 'file_too_large_to_edit', 'This file is too large to edit')
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(await readBlob(node.objectKey)).replace(/^﻿/, '')
  } catch {
    throw new AppError(422, 'file_not_text', 'This file is not UTF-8 text, so it cannot be edited')
  }
}

/** What converting an uploaded Markdown file would do, without changing anything. */
export async function previewMarkdownConversion(node: FileNodeRow): Promise<FileConversionPreview> {
  const original = await readMarkdownFile(node)
  const { markdown: converted } = initialDocState(original)
  return {
    original,
    converted,
    changed: normalizeMarkdownForComparison(original) !== normalizeMarkdownForComparison(converted),
  }
}

/**
 * Turns an uploaded Markdown file into an editable document. The row changes kind in the
 * transaction; the caller deletes the old object only after commit, so a failure keeps the file.
 */
export async function convertBlobToDocInTx(tx: DatabaseTransaction, node: FileNodeRow): Promise<{ row: FileNodeRow; objectKey: string }> {
  const original = await readMarkdownFile(node)
  const initial = initialDocState(original)
  await tx.insert(fileDocs).values({
    nodeId: node.id, state: initial.state, stateBytes: initial.state.byteLength,
    markdown: initial.markdown, schemaVersion: DOC_SCHEMA_VERSION,
  })
  const [row] = await tx.update(fileNodes).set({
    kind: 'doc', objectKey: null, checksum: null, mimeType: 'text/markdown',
    sizeBytes: initial.state.byteLength, updatedAt: new Date(),
  }).where(eq(fileNodes.id, node.id)).returning()
  return { row: row!, objectKey: node.objectKey! }
}

/**
 * Turns an editable document into an ordinary file holding its Markdown, for renames away from
 * .md. The object is written first; the document state is dropped with the row change.
 */
export async function convertDocToBlobInTx(tx: DatabaseTransaction, userId: string, node: FileNodeRow): Promise<FileNodeRow> {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, await mergedDocState(tx, node.id))
  const bytes = Buffer.from(ydocToMarkdown(doc), 'utf8')
  const objectKey = `users/${userId}/files/${node.id}`
  await getBlobStore().put(objectKey, bytes, { contentType: 'text/plain', contentLength: bytes.byteLength })
  await tx.delete(fileDocs).where(eq(fileDocs.nodeId, node.id))
  const [row] = await tx.update(fileNodes).set({
    kind: 'blob', objectKey, mimeType: 'text/plain', sizeBytes: bytes.byteLength,
    checksum: createHash('sha256').update(bytes).digest('base64url'), status: 'ready', updatedAt: new Date(),
  }).where(eq(fileNodes.id, node.id)).returning()
  return row!
}
