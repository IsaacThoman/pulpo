import type { Readable } from 'node:stream'
import { and, eq, inArray } from 'drizzle-orm'
import * as Y from 'yjs'
import { isLiveAssetHash, liveAssetHash, liveFormat, LiveFormatError, liveFormatOfName, type LiveAssetRef, type LiveAssetStore, type LiveFormatContext, type LiveFormatInfo } from '@pulpo/client-core/office'
import { liveFormatCodec } from '@pulpo/client-core/office/codecs'
import { mimeTypeFromName } from '../attachments/generated.js'
import { db } from '../database/client.js'
import { fileDocAssets } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { getBlobStore } from '../storage/index.js'
import type { FileExecutor, FileNodeRow } from './access.js'
import { docTooLarge, initialDocState, MAX_DOC_STATE_BYTES, mergedDocState } from './doc-state.js'

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Live documents on the server: which format a document or name is, the asset store codecs use
 * here, and the codec calls (create, import, export, apply) every route and agent command shares.
 */

export const notLiveName = () => new AppError(400, 'file_not_live', 'Only files of a format Pulpo edits (such as .md, .txt, or code) can be documents')

/** A codec's refusal as the API reports it. */
export function liveFormatFailure(error: unknown): unknown {
  if (!(error instanceof LiveFormatError)) return error
  switch (error.code) {
    case 'too_large': return new AppError(413, 'file_too_large_to_edit', error.message)
    case 'encrypted': return new AppError(422, 'file_encrypted', error.message)
    case 'unsupported': return new AppError(422, 'file_not_editable', error.message)
    case 'corrupt': return new AppError(422, 'file_unreadable', error.message)
  }
}

/** Runs codec work, reporting its refusals as API errors. */
export async function codecCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw liveFormatFailure(error)
  }
}

/** The format of a document row; documents from before live formats are Markdown. */
export function docFormat(node: Pick<FileNodeRow, 'format'>): LiveFormatInfo {
  const format = liveFormat(node.format ?? 'markdown')
  if (!format) throw new AppError(409, 'file_format_unknown', 'This document is in a format this server cannot edit')
  return format
}

/** The format a name gives a new document, or a 400 for names that stay ordinary files. */
export function formatForName(name: string): LiveFormatInfo {
  const format = liveFormatOfName(name)
  if (!format) throw notLiveName()
  return format
}

/** What a document stops being when renamed out of its format: an uploaded file of this type. */
export function convertedMimeType(name: string, format: LiveFormatInfo): string {
  return mimeTypeFromName(name) ?? (format.id === 'markdown' || format.id === 'text' ? 'text/plain' : 'application/octet-stream')
}

export function docAssetKey(userId: string, nodeId: string, hash: string): string {
  return `users/${userId}/doc-assets/${nodeId}/${hash}`
}

async function readObject(key: string): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  for await (const chunk of await getBlobStore().getStream(key) as Readable) chunks.push(Buffer.from(chunk as Uint8Array))
  return Buffer.concat(chunks)
}

/**
 * A document's assets for codecs running on the server. Reads come from the document's stored
 * assets; writes stay in memory until `flush` stores them with the document, so a codec that fails
 * halfway leaves nothing behind.
 */
export class DocAssetStore implements LiveAssetStore {
  private readonly pending = new Map<string, { bytes: Uint8Array; ref: LiveAssetRef }>()

  constructor(private readonly executor: FileExecutor, private readonly nodeId: string | null) {}

  async put(bytes: Uint8Array, mimeType: string): Promise<LiveAssetRef> {
    const hash = await liveAssetHash(bytes)
    const ref = { hash, mimeType, sizeBytes: bytes.byteLength }
    if (!this.pending.has(hash)) this.pending.set(hash, { bytes: bytes.slice(), ref })
    return ref
  }

  async get(hash: string): Promise<Uint8Array> {
    const pending = this.pending.get(hash)
    if (pending) return pending.bytes.slice()
    const [row] = this.nodeId && isLiveAssetHash(hash)
      ? await this.executor.select({ objectKey: fileDocAssets.objectKey }).from(fileDocAssets)
        .where(and(eq(fileDocAssets.nodeId, this.nodeId), eq(fileDocAssets.hash, hash))).limit(1)
      : []
    if (!row) throw new LiveFormatError('corrupt', `The document refers to a missing part (${hash.slice(0, 12)})`)
    return readObject(row.objectKey)
  }

  /** Bytes written since the last flush, for the storage check before they are kept. */
  pendingBytes(): number {
    let total = 0
    for (const { ref } of this.pending.values()) total += ref.sizeBytes
    return total
  }

  /**
   * Stores the assets written so far as the document's, objects before rows. Returns the keys it
   * wrote, which the caller deletes if its transaction does not commit.
   */
  async flush(tx: DatabaseTransaction, userId: string, nodeId: string): Promise<string[]> {
    if (!this.pending.size) return []
    const existing = new Set((await tx.select({ hash: fileDocAssets.hash }).from(fileDocAssets)
      .where(and(eq(fileDocAssets.nodeId, nodeId), inArray(fileDocAssets.hash, [...this.pending.keys()])))).map((row) => row.hash))
    const written: string[] = []
    try {
      for (const [hash, { bytes, ref }] of this.pending) {
        if (existing.has(hash)) continue
        const objectKey = docAssetKey(userId, nodeId, hash)
        written.push(objectKey)
        await getBlobStore().put(objectKey, Buffer.from(bytes), { contentType: 'application/octet-stream', contentLength: bytes.byteLength })
        await tx.insert(fileDocAssets).values({ nodeId, hash, ownerUserId: userId, objectKey, mimeType: ref.mimeType, sizeBytes: ref.sizeBytes })
          .onConflictDoNothing()
      }
    } catch (error) {
      await deleteObjects(written)
      throw error
    }
    this.pending.clear()
    return written
  }
}

export async function deleteObjects(keys: readonly string[]): Promise<void> {
  for (const key of keys) await getBlobStore().delete(key).catch(() => undefined)
}

/** Object keys of the assets of these documents (for purges and conversions). */
export async function docAssetKeys(executor: FileExecutor, nodeIds: string[]): Promise<string[]> {
  if (!nodeIds.length) return []
  const rows = await executor.select({ objectKey: fileDocAssets.objectKey }).from(fileDocAssets).where(inArray(fileDocAssets.nodeId, nodeIds))
  return rows.map((row) => row.objectKey)
}

/** A new document's first state, and the text derived from it. */
export interface InitialLiveDoc {
  state: Uint8Array
  text: string
  assets: DocAssetStore
}

function encodedState(doc: Y.Doc): Uint8Array {
  const state = Y.encodeStateAsUpdate(doc)
  if (state.byteLength > MAX_DOC_STATE_BYTES) throw docTooLarge()
  return state
}

/**
 * Builds a new document of `format`: from file bytes, from Markdown text (Markdown only, the path
 * documents have always been created by), or empty.
 */
export async function initialLiveDoc(executor: FileExecutor, format: LiveFormatInfo, name: string, source: { bytes?: Uint8Array; markdown?: string } = {}): Promise<InitialLiveDoc> {
  const assets = new DocAssetStore(executor, null)
  if (format.id === 'markdown' && source.bytes === undefined) {
    const initial = initialDocState(source.markdown)
    return { state: initial.state, text: initial.markdown, assets }
  }
  const codec = liveFormatCodec(format)
  const doc = new Y.Doc()
  const context: LiveFormatContext = { name, assets }
  await codecCall(() => source.bytes ? codec.importFile(doc, source.bytes, context) : codec.createEmpty(doc, context))
  return { state: encodedState(doc), text: codec.toText(doc), assets }
}

/** A locked document's full state as a Y.Doc, with the context its codec needs. */
export async function loadLiveDocInTx(tx: DatabaseTransaction, node: FileNodeRow): Promise<{ doc: Y.Doc; format: LiveFormatInfo; context: LiveFormatContext & { assets: DocAssetStore } }> {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, await mergedDocState(tx, node.id))
  return { doc, format: docFormat(node), context: { name: node.name, assets: new DocAssetStore(tx, node.id) } }
}

/** The document as file bytes, through its format's codec. */
export async function exportLiveDoc(doc: Y.Doc, format: LiveFormatInfo, context: LiveFormatContext): Promise<Uint8Array> {
  return codecCall(() => liveFormatCodec(format).exportFile(doc, context))
}

/** The file bytes of a stored document, read consistently (outside any tree lock). */
export async function exportStoredDoc(node: FileNodeRow): Promise<Uint8Array> {
  return db.transaction(async (tx) => {
    const { doc, format, context } = await loadLiveDocInTx(tx, node)
    return exportLiveDoc(doc, format, context)
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}

/**
 * The plain text of some file bytes in `format`, read on a scratch document: for what agents see
 * of a proposal, and for conflict details. Assets resolve against the document's.
 */
export async function textOfFile(executor: FileExecutor, node: FileNodeRow, bytes: Uint8Array): Promise<string> {
  const format = docFormat(node)
  const codec = liveFormatCodec(format)
  const doc = new Y.Doc()
  await codecCall(() => codec.importFile(doc, bytes, { name: node.name, assets: new DocAssetStore(executor, node.id) }))
  return codec.toText(doc)
}
