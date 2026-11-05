import type * as Y from 'yjs'
import { FILE_DOC_MAX_MARKDOWN_LENGTH } from '@pulpo/contracts'
import { DOC_FRAGMENT_NAME, DOC_SCHEMA_VERSION } from '../doc-schema/version.js'
import type { LiveFormatId } from './live-format.js'
import { TEXT_EXTENSIONS, TEXT_FIELD, TEXT_FILE_NAMES, TEXT_MAX_FILE_BYTES, TEXT_SCHEMA_VERSION, textMimeType } from './text/layout.js'

/**
 * What every part of Pulpo needs to know about a live format without loading its codec or editor:
 * which names it owns, its schema version, and how it is stored and served. Servers pair each
 * entry with its codec (`@pulpo/client-core/office/codecs`); clients pick an editor by `id`.
 *
 * A format is live once it is listed here: its files can become collaborative documents, new
 * files of it can be created, and agents edit it through pull and push. See docs/live-formats.md.
 */
export interface LiveFormatInfo {
  readonly id: LiveFormatId
  /** Bumped whenever the Y.Doc layout changes in a way older clients would misread. */
  readonly schemaVersion: number
  /** Lower-case extensions, without the dot. The first is used for new files. */
  readonly extensions: readonly string[]
  /** Whole names (lower-case) that open as this format although their extension does not, e.g. `Dockerfile`. */
  readonly fileNames?: readonly string[]
  /**
   * Whether opening an uploaded file for editing converts it at once. True when the codec writes
   * the file back byte for byte; Markdown is false, because the editor may reformat it.
   */
  readonly lossless: boolean
  /** Largest uploaded file that can become a live document of this format. */
  readonly maxFileBytes: number
  mimeType(extension: string): string
  /** Whether a document holds anything yet, so a cached copy can show before the first sync. */
  hasContent(doc: Y.Doc): boolean
}

export const MARKDOWN_FORMAT: LiveFormatInfo = {
  id: 'markdown',
  schemaVersion: DOC_SCHEMA_VERSION,
  extensions: ['md', 'markdown'],
  // Named only by its extension, as `isMarkdownName` counts it.
  fileNames: ['.md', '.markdown'],
  lossless: false,
  // Characters, which bounds the bytes at four times as many.
  maxFileBytes: FILE_DOC_MAX_MARKDOWN_LENGTH,
  mimeType: () => 'text/markdown',
  hasContent: (doc) => doc.getXmlFragment(DOC_FRAGMENT_NAME).length > 0,
}

export const TEXT_FORMAT: LiveFormatInfo = {
  id: 'text',
  schemaVersion: TEXT_SCHEMA_VERSION,
  extensions: TEXT_EXTENSIONS,
  fileNames: TEXT_FILE_NAMES,
  lossless: true,
  maxFileBytes: TEXT_MAX_FILE_BYTES,
  mimeType: textMimeType,
  hasContent: (doc) => doc.getText(TEXT_FIELD).length > 0,
}

/** Every live format, in the order creation menus list them. */
export const LIVE_FORMATS: readonly LiveFormatInfo[] = [MARKDOWN_FORMAT, TEXT_FORMAT]

const BY_ID = new Map<string, LiveFormatInfo>(LIVE_FORMATS.map((format) => [format.id, format]))
const BY_EXTENSION = new Map<string, LiveFormatInfo>()
const BY_NAME = new Map<string, LiveFormatInfo>()
for (const format of LIVE_FORMATS) {
  for (const extension of format.extensions) {
    if (BY_EXTENSION.has(extension)) throw new Error(`Two live formats claim .${extension}`)
    BY_EXTENSION.set(extension, format)
  }
  for (const name of format.fileNames ?? []) BY_NAME.set(name, format)
}

/** The lower-case extension of a name, without the dot; dotfiles such as `.env` have none. */
export function nameExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isLiveFormatId(value: unknown): value is LiveFormatId {
  return typeof value === 'string' && BY_ID.has(value)
}

/** The live format registered under `id`, if this build knows it. */
export function liveFormat(id: string | null | undefined): LiveFormatInfo | null {
  return id ? BY_ID.get(id) ?? null : null
}

/** The live format a file name belongs to, or null for names that stay ordinary files. */
export function liveFormatOfName(name: string): LiveFormatInfo | null {
  const lower = name.toLowerCase()
  return BY_EXTENSION.get(nameExtension(name)) ?? BY_NAME.get(lower) ?? null
}

/** The MIME type to store and serve for a live document named `name`. */
export function liveMimeType(format: LiveFormatInfo, name: string): string {
  return format.mimeType(nameExtension(name) || format.extensions[0]!)
}

/** Each format's schema version, as clients announce what they can edit when joining a document. */
export function liveSchemaVersions(formats: readonly LiveFormatInfo[] = LIVE_FORMATS): Record<string, number> {
  return Object.fromEntries(formats.map((format) => [format.id, format.schemaVersion]))
}
