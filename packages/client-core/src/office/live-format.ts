import type * as Y from 'yjs'

/**
 * Live formats: file types that open as collaborative documents. Each format keeps its content in
 * a Y.Doc (synced over the existing document socket, like Markdown documents) and converts to and
 * from the file's bytes, so downloads, agent `pull`, and agent `push` still deal in real files.
 *
 * Markdown documents predate this interface and keep their own schema in `doc-schema`; they are
 * adapted to it rather than rewritten.
 */
export type LiveFormatId = 'markdown' | 'text' | 'notebook' | 'sheet' | 'document' | 'presentation'

/** A binary part (image, embedded object, font) kept outside the Y.Doc and addressed by content. */
export interface LiveAssetRef {
  /** Lower-case hex SHA-256 of the bytes. */
  hash: string
  mimeType: string
  sizeBytes: number
}

/**
 * Where a document's binary parts live. Y.Docs hold only references, so large images do not bloat
 * every sync; the server keeps the bytes per document and clients fetch them by hash.
 */
export interface LiveAssetStore {
  put(bytes: Uint8Array, mimeType: string): Promise<LiveAssetRef>
  get(hash: string): Promise<Uint8Array>
}

export interface LiveFormatContext {
  /** The file name, extension included (`Budget.xlsx`). Formats that cover several extensions use it to pick one. */
  name: string
  assets: LiveAssetStore
}

export type LiveFormatErrorCode =
  /** The bytes are not a valid file of this format. */
  | 'corrupt'
  /** Valid, but uses something this format cannot keep (strict OOXML, a macro-enabled package, …). */
  | 'unsupported'
  /** Password protected or encrypted. */
  | 'encrypted'
  /** Larger than this format can edit. */
  | 'too_large'

export class LiveFormatError extends Error {
  readonly code: LiveFormatErrorCode

  constructor(code: LiveFormatErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'LiveFormatError'
    this.code = code
  }
}

/**
 * Converts one file format to and from its Y.Doc. Implementations must be lossless for what they
 * do not model: anything they cannot edit (unknown XML, extensions, parts) is kept and written
 * back unchanged, so opening and saving a file never drops content.
 *
 * Codecs run on the server (Node, no DOM) and in clients, so they must not touch DOM globals.
 */
export interface LiveFormatCodec {
  readonly id: LiveFormatId
  /**
   * Bumped whenever the Y.Doc layout changes in a way older clients would misread. The server
   * refuses collaborative joins from other versions.
   */
  readonly schemaVersion: number
  /** Lower-case extensions, without the dot, that open as this format. The first is used for new files. */
  readonly extensions: readonly string[]
  /** The MIME type to store and serve for a file with this extension. */
  mimeType(extension: string): string
  /** Fills an empty Y.Doc with a new, blank document (File > New). */
  createEmpty(doc: Y.Doc, context: LiveFormatContext): Promise<void>
  /** Fills an empty Y.Doc from file bytes. Throws LiveFormatError for files it cannot open. */
  importFile(doc: Y.Doc, bytes: Uint8Array, context: LiveFormatContext): Promise<void>
  /** Writes the document as file bytes in the format of `context.name`'s extension. */
  exportFile(doc: Y.Doc, context: LiveFormatContext): Promise<Uint8Array>
  /**
   * Rewrites `doc` to match `bytes` as a minimal diff, in one transaction with `origin`. Used when
   * an agent pushes a new version or a review accepts one: replacing the state wholesale would let
   * replicas that still hold the old content merge it back, and would discard concurrent edits.
   */
  applyFile(doc: Y.Doc, bytes: Uint8Array, context: LiveFormatContext, origin?: unknown): Promise<{ changed: boolean }>
  /** Plain text of the document, for search, grep, `cat`, and previews. */
  toText(doc: Y.Doc): string
}
