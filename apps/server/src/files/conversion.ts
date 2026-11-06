import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { and, eq } from 'drizzle-orm'
import { liveMimeType } from '@pulpo/client-core/office'
import { FILE_DOC_MAX_MARKDOWN_LENGTH, isMarkdownName, type FileConversionPreview } from '@pulpo/contracts'
import { assertStorageCapacity } from '../attachments/storage-quota.js'
import { db } from '../database/client.js'
import { fileChanges, fileDocAssets, fileDocs, fileNodes } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { getBlobStore } from '../storage/index.js'
import type { FileNodeRow } from './access.js'
import { initialDocState } from './doc-state.js'
import { convertedMimeType, exportLiveDoc, formatForName, initialLiveDoc, loadLiveDocInTx } from './live-docs.js'

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

/** The bytes of an uploaded file that is about to become a live document of `maxBytes` at most. */
async function readConvertibleFile(node: FileNodeRow, maxBytes: number): Promise<Uint8Array> {
  if (node.kind !== 'blob' || node.status !== 'ready' || !node.objectKey) throw notFound('File')
  if (node.sizeBytes > maxBytes) throw new AppError(413, 'file_too_large_to_edit', 'This file is too large to edit')
  return readBlob(node.objectKey)
}

/**
 * Turns an uploaded file into a live document of the format its name gives it. Markdown converts
 * as it always has; other formats go through their codec, which keeps every byte. The row changes
 * kind in the transaction; the caller deletes the old object only after commit, so a failure
 * keeps the file. Asset objects it stores are pushed onto `writtenKeys` as they are written, for
 * the caller to delete if the transaction does not commit.
 */
export async function convertBlobToDocInTx(tx: DatabaseTransaction, node: FileNodeRow, writtenKeys: string[] = []): Promise<{ row: FileNodeRow; objectKey: string }> {
  const format = formatForName(node.name)
  const initial = format.id === 'markdown'
    ? await initialLiveDoc(tx, format, node.name, { markdown: await readMarkdownFile(node) })
    : await initialLiveDoc(tx, format, node.name, { bytes: await readConvertibleFile(node, format.maxFileBytes) })
  // A new generation: devices still holding the document this file once was must not merge it in.
  await tx.insert(fileDocs).values({
    nodeId: node.id, state: initial.state, stateBytes: initial.state.byteLength,
    markdown: initial.text, schemaVersion: format.schemaVersion, generation: initial.generation,
  })
  writtenKeys.push(...await initial.assets.flush(tx, node.ownerUserId, node.id))
  const [row] = await tx.update(fileNodes).set({
    kind: 'doc', format: format.id, objectKey: null, checksum: null, mimeType: liveMimeType(format, node.name),
    sizeBytes: initial.state.byteLength, updatedAt: new Date(),
  }).where(eq(fileNodes.id, node.id)).returning()
  return { row: row!, objectKey: node.objectKey! }
}

/**
 * Turns a live document into an ordinary file holding its exported bytes, for renames to a name
 * of another format (or none). The object is written first; the document state is dropped with
 * the row change. Returns the keys of the document's assets, which the caller deletes after
 * commit.
 */
export async function convertDocToBlobInTx(tx: DatabaseTransaction, userId: string, node: FileNodeRow): Promise<{ row: FileNodeRow; releasedKeys: string[] }> {
  const { doc, format, context } = await loadLiveDocInTx(tx, node)
  const bytes = Buffer.from(await exportLiveDoc(doc, format, context))
  const mimeType = convertedMimeType(node.name, format)
  const assets = await tx.select({ objectKey: fileDocAssets.objectKey, sizeBytes: fileDocAssets.sizeBytes }).from(fileDocAssets).where(eq(fileDocAssets.nodeId, node.id))
  // Tree callers already took storage before tree. Export can grow the state (UTF-16, for
  // example), but the document's assets are released by this same conversion, not kept twice.
  const releasedBytes = assets.reduce((sum, asset) => sum + asset.sizeBytes, 0)
  await assertStorageCapacity(tx, userId, Math.max(0, bytes.byteLength - node.sizeBytes - releasedBytes), { perFileLimit: false })
  // A fresh key: the node's earlier objects may still be kept as versions under their own keys.
  const objectKey = `users/${userId}/files/${newId()}`
  await getBlobStore().put(objectKey, bytes, { contentType: mimeType, contentLength: bytes.byteLength })
  const releasedKeys = assets.map((asset) => asset.objectKey)
  // Proposals of new versions of the document cannot apply to a file; maintenance deletes the
  // versions they kept (`deleteUnusedVersions`).
  await tx.update(fileChanges).set({ status: 'rejected', updatedAt: new Date() }).where(and(
    eq(fileChanges.nodeId, node.id), eq(fileChanges.kind, 'update'), eq(fileChanges.mode, 'suggest'), eq(fileChanges.status, 'pending'),
  ))
  // Assets cascade from the document state.
  await tx.delete(fileDocs).where(eq(fileDocs.nodeId, node.id))
  const [row] = await tx.update(fileNodes).set({
    kind: 'blob', format: null, objectKey, mimeType, sizeBytes: bytes.byteLength,
    checksum: createHash('sha256').update(bytes).digest('base64url'), status: 'ready', updatedAt: new Date(),
  }).where(eq(fileNodes.id, node.id)).returning()
  return { row: row!, releasedKeys }
}

