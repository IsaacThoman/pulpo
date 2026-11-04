import type * as Y from 'yjs'
import { liveAssetHash, transactChanges } from '../assets.js'
import { TEXT_FORMAT } from '../formats.js'
import { LiveFormatError, type LiveFormatCodec, type LiveFormatContext } from '../live-format.js'
import { textEdits } from './diff.js'
import { decodeTextFile, encodeTextFile, type DecodedText, type LineEnding, type TextEncodingName } from './encoding.js'
import { TEXT_FIELD, TEXT_FILE_FIELD, TEXT_MAX_FILE_BYTES } from './layout.js'

/** How the document is written back, as kept in its `textFile` map. */
export interface TextFileFacts {
  encoding: TextEncodingName
  lineEnding: LineEnding
  /**
   * For a file with mixed line breaks: its exact bytes (an asset) and the hash of the text they
   * decode to. While the text still has that hash, export returns those bytes unchanged.
   */
  original?: { asset: string; textHash: string }
}

const ENCODINGS = new Set<TextEncodingName>(['utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be', 'windows-1252'])
const LINE_ENDINGS = new Set<LineEnding>(['lf', 'crlf', 'cr'])

export function textOf(doc: Y.Doc): Y.Text {
  return doc.getText(TEXT_FIELD)
}

function factsMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(TEXT_FILE_FIELD)
}

/** The document's write-back facts, with defaults for anything missing or unknown (UTF-8, LF). */
export function textFileFacts(doc: Y.Doc): TextFileFacts {
  const map = factsMap(doc)
  const encoding = map.get('encoding')
  const lineEnding = map.get('lineEnding')
  const original = map.get('original') as { asset?: unknown; textHash?: unknown } | undefined
  return {
    encoding: ENCODINGS.has(encoding as TextEncodingName) ? encoding as TextEncodingName : 'utf-8',
    lineEnding: LINE_ENDINGS.has(lineEnding as LineEnding) ? lineEnding as LineEnding : 'lf',
    ...typeof original?.asset === 'string' && typeof original.textHash === 'string'
      ? { original: { asset: original.asset, textHash: original.textHash } }
      : {},
  }
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function decode(bytes: Uint8Array): DecodedText {
  if (bytes.byteLength > TEXT_MAX_FILE_BYTES) throw new LiveFormatError('too_large', 'This file is too large to edit as text')
  return decodeTextFile(bytes)
}

/**
 * The facts to keep for a decoded file. A file whose bytes the facts cannot rebuild exactly (mixed
 * line breaks, or a guessed legacy encoding) keeps them, so it returns unchanged until edited.
 */
async function factsFor(decoded: DecodedText, bytes: Uint8Array, context: LiveFormatContext): Promise<TextFileFacts> {
  const facts: TextFileFacts = { encoding: decoded.encoding, lineEnding: decoded.lineEnding }
  if (decoded.mixed || decoded.encoding === 'windows-1252') {
    const ref = await context.assets.put(bytes, 'application/octet-stream')
    facts.original = { asset: ref.hash, textHash: await liveAssetHash(utf8(decoded.text)) }
  }
  return facts
}

/** Writes facts that differ, so an unchanged file does not grow the document's history. */
function writeFacts(doc: Y.Doc, facts: TextFileFacts): void {
  const map = factsMap(doc)
  if (map.get('encoding') !== facts.encoding) map.set('encoding', facts.encoding)
  if (map.get('lineEnding') !== facts.lineEnding) map.set('lineEnding', facts.lineEnding)
  const current = map.get('original') as TextFileFacts['original'] | undefined
  if (!facts.original) {
    if (current !== undefined) map.delete('original')
  } else if (current?.asset !== facts.original.asset || current.textHash !== facts.original.textHash) {
    map.set('original', facts.original)
  }
}

/** Rewrites the Y.Text to `next` with the smallest edits found; returns whether anything changed. */
export function applyTextToYText(ytext: Y.Text, next: string): boolean {
  const edits = textEdits(ytext.toString(), next)
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const edit = edits[index]!
    if (edit.to > edit.from) ytext.delete(edit.from, edit.to - edit.from)
    if (edit.insert) ytext.insert(edit.from, edit.insert)
  }
  return edits.length > 0
}

/** Bytes of the document as a file: its text in the file's encoding and line breaks. */
export async function exportTextFile(doc: Y.Doc, context: Pick<LiveFormatContext, 'assets'>): Promise<Uint8Array> {
  const text = textOf(doc).toString()
  const facts = textFileFacts(doc)
  if (facts.original && globalThis.crypto?.subtle && await liveAssetHash(utf8(text)) === facts.original.textHash) {
    try {
      return await context.assets.get(facts.original.asset)
    } catch {
      // A missing original only costs the exact line breaks; the text is still all here.
    }
  }
  return encodeTextFile(text, facts.encoding, facts.lineEnding)
}

/**
 * Plain text and source code. The content is one Y.Text (so editors such as CodeMirror bind to it
 * directly) and the file's encoding and line breaks are kept beside it.
 */
export const textCodec: LiveFormatCodec = {
  id: TEXT_FORMAT.id,
  schemaVersion: TEXT_FORMAT.schemaVersion,
  extensions: TEXT_FORMAT.extensions,
  mimeType: TEXT_FORMAT.mimeType,

  async createEmpty(doc) {
    doc.transact(() => writeFacts(doc, { encoding: 'utf-8', lineEnding: 'lf' }), 'import')
  },

  async importFile(doc, bytes, context) {
    const decoded = decode(bytes)
    const facts = await factsFor(decoded, bytes, context)
    doc.transact(() => {
      const ytext = textOf(doc)
      if (ytext.length) ytext.delete(0, ytext.length)
      ytext.insert(0, decoded.text)
      writeFacts(doc, facts)
    }, 'import')
  },

  exportFile: exportTextFile,

  async applyFile(doc, bytes, context, origin) {
    const decoded = decode(bytes)
    const facts = await factsFor(decoded, bytes, context)
    const changed = transactChanges(doc, () => {
      applyTextToYText(textOf(doc), decoded.text)
      writeFacts(doc, facts)
    }, origin)
    return { changed }
  },

  toText(doc) {
    return textOf(doc).toString()
  },

  referencedAssets(doc) {
    const original = textFileFacts(doc).original
    return original ? [original.asset] : []
  },
}
