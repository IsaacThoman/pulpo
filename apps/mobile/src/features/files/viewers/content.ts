import { codeLanguageFor, decodeTextBytes, fileExtension, previewKindOf } from '@pulpo/client-core/files'
import { highlightTree, splitHighlightedLines, type HighlightedLine } from '@pulpo/client-core/highlight'

/** How the app shows a file it opens itself rather than handing to the system viewer. */
export type InAppViewer = 'table' | 'text' | 'notebook'

/**
 * The in-app viewer for a file: CSV/TSV grids, highlighted code and text, and notebooks. Pages,
 * images, PDFs, media, and Office files keep the system viewers (Quick Look on iOS).
 */
export function inAppViewer(name: string, mimeType?: string | null): InAppViewer | null {
  const kind = previewKindOf(name, mimeType)
  if (kind === 'table' || kind === 'notebook') return kind
  return kind === 'text' ? 'text' : null
}

/** Files larger than this open in the system viewer (or share sheet) instead. */
export const MAX_IN_APP_VIEWER_BYTES = 25 * 1024 * 1024

/** A text file's bytes as text: UTF-8, UTF-16 with a byte order mark, or Windows-1252. */
export function decodeFileText(bytes: Uint8Array): string {
  return decodeTextBytes(bytes).text
}

/** Highlighting runs on the JS thread; larger files show as plain text. */
export const MAX_NATIVE_HIGHLIGHT_CHARACTERS = 100_000

/** A file's lines, highlighted by its name (plain text when too large or unknown). */
export function viewerLines(text: string, name: string, mimeType?: string | null, language?: string | null): { lines: HighlightedLine[]; plain: string[]; highlighted: boolean } {
  const normalized = text.replace(/\r\n?/g, '\n')
  const grammar = language !== undefined ? language : codeLanguageFor(name, mimeType)
  const tree = grammar === null ? null : highlightTree(normalized, grammar, MAX_NATIVE_HIGHLIGHT_CHARACTERS)
  return { lines: splitHighlightedLines(normalized, tree), plain: normalized.split('\n'), highlighted: tree !== null }
}

/** JSON pretty-printed, or null when the file isn't JSON (or already formatted, or too large). */
export function formattedJson(text: string, name: string, mimeType?: string | null): string | null {
  const extension = fileExtension(name)
  if (extension === 'jsonl' || extension === 'ndjson' || codeLanguageFor(name, mimeType) !== 'json' || text.length > 5_000_000) return null
  try {
    const formatted = JSON.stringify(JSON.parse(text), null, 2)
    return formatted === text ? null : formatted
  } catch {
    return null
  }
}
