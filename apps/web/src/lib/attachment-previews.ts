import { attachmentKind } from './attachments'
import { previewKindForFile } from './code-preview'

/** `sandbox` files (HTML, JSX) run in the isolated code preview sandbox; SVG stays a plain image. */
export type AttachmentPreviewKind = 'image' | 'pdf' | 'markdown' | 'text' | 'table' | 'audio' | 'video' | 'sandbox'

export const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024
export const MAX_MEDIA_PREVIEW_BYTES = 100 * 1024 * 1024
export const MAX_TEXT_PREVIEW_CHARACTERS = 200_000
/** Tables are parsed and rendered lazily, so they can preview much larger files than plain text. */
export const MAX_TABLE_PREVIEW_BYTES = 25 * 1024 * 1024
export const MAX_TABLE_PREVIEW_COLUMNS = 200

const TEXT_EXTENSIONS = new Set([
  'c', 'cc', 'cpp', 'cs', 'css', 'go', 'h', 'hpp', 'html', 'java', 'js', 'jsx', 'json',
  'kt', 'kts', 'log', 'md', 'php', 'py', 'rb', 'rs', 'sh', 'sql', 'swift', 'toml', 'ts',
  'tsx', 'txt', 'vue', 'xml', 'yaml', 'yml',
])

function extension(name: string): string | null {
  return name.trim().toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] ?? null
}

export function attachmentPreviewKind(name: string, mimeType: string): AttachmentPreviewKind | null {
  const mime = mimeType.toLowerCase()
  const ext = extension(name)
  const kind = attachmentKind(name, mimeType)

  if (kind === 'image') return 'image'
  if (kind === 'pdf') return 'pdf'
  if (kind === 'audio') return 'audio'
  if (kind === 'video') return 'video'
  if (mime === 'text/csv' || mime === 'text/tab-separated-values' || ext === 'csv' || ext === 'tsv') return 'table'
  if (ext === 'md' || mime === 'text/markdown') return 'markdown'
  if (previewKindForFile(name, mimeType)) return 'sandbox'
  if (
    mime.startsWith('text/') || mime.includes('javascript') || mime.includes('json')
    || mime.includes('yaml') || mime === 'application/xml' || mime.endsWith('+xml')
    || (ext && TEXT_EXTENSIONS.has(ext))
  ) return 'text'
  return null
}

export function isTextPreviewKind(kind: AttachmentPreviewKind): boolean {
  return kind === 'markdown' || kind === 'text' || kind === 'table' || kind === 'sandbox'
}

export function previewSizeLimit(kind: AttachmentPreviewKind): number {
  if (kind === 'table') return MAX_TABLE_PREVIEW_BYTES
  return isTextPreviewKind(kind) ? MAX_TEXT_PREVIEW_BYTES : MAX_MEDIA_PREVIEW_BYTES
}

export function formatTextPreview(name: string, mimeType: string, text: string): { text: string; truncated: boolean } {
  const ext = extension(name)
  const isJson = ext === 'json' || mimeType.toLowerCase().includes('json')
  let formatted = text
  if (isJson) {
    try {
      formatted = JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      // Keep malformed or partial JSON readable as plain text.
    }
  }
  if (formatted.length <= MAX_TEXT_PREVIEW_CHARACTERS) return { text: formatted, truncated: false }
  return { text: formatted.slice(0, MAX_TEXT_PREVIEW_CHARACTERS), truncated: true }
}

/** Reads a delimited file a batch of rows at a time, so huge tables only parse what is on screen. */
export interface DelimitedReader {
  headers: string[]
  /** Parses up to `count` more data rows, each padded or cut to the header width. */
  next: (count: number) => string[][]
  readonly done: boolean
}

export function createDelimitedReader(
  name: string,
  mimeType: string,
  text: string,
  maxColumns = MAX_TABLE_PREVIEW_COLUMNS,
): DelimitedReader | null {
  const delimiter = extension(name) === 'tsv' || mimeType.toLowerCase() === 'text/tab-separated-values' ? '\t' : ','
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0

  const readRow = (): string[] | null => {
    while (index < text.length) {
      const row: string[] = []
      let cell = ''
      let quoted = false
      const finishCell = () => {
        if (row.length < maxColumns) row.push(cell)
        cell = ''
      }

      while (index < text.length) {
        const character = text[index]!
        if (character === '"') {
          if (quoted && text[index + 1] === '"') {
            cell += '"'
            index += 2
            continue
          }
          quoted = !quoted
          index += 1
          continue
        }
        if (!quoted && character === delimiter) {
          finishCell()
          index += 1
          continue
        }
        if (!quoted && (character === '\n' || character === '\r')) {
          index += character === '\r' && text[index + 1] === '\n' ? 2 : 1
          break
        }
        cell += character
        index += 1
      }
      finishCell()
      // Blank lines carry no data, so they are skipped rather than shown as empty rows.
      if (row.length > 1 || row[0]) return row
    }
    return null
  }

  const headerRow = readRow()
  if (!headerRow || headerRow.length < 2) return null
  const width = headerRow.length

  return {
    headers: headerRow.map((value, column) => value.trim() || `Column ${column + 1}`),
    next(count) {
      const rows: string[][] = []
      while (rows.length < count) {
        const row = readRow()
        if (!row) break
        if (row.length < width) row.push(...Array<string>(width - row.length).fill(''))
        rows.push(row.length > width ? row.slice(0, width) : row)
      }
      return rows
    },
    get done() {
      return index >= text.length
    },
  }
}
