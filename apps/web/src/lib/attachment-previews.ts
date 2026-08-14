import { attachmentKind } from './attachments'

export type AttachmentPreviewKind = 'image' | 'pdf' | 'text' | 'table' | 'audio' | 'video'

export const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024
export const MAX_MEDIA_PREVIEW_BYTES = 100 * 1024 * 1024
export const MAX_TEXT_PREVIEW_CHARACTERS = 200_000

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
  if (
    mime.startsWith('text/') || mime.includes('javascript') || mime.includes('json')
    || mime.includes('yaml') || mime === 'application/xml' || mime.endsWith('+xml')
    || (ext && TEXT_EXTENSIONS.has(ext))
  ) return 'text'
  return null
}

export function previewSizeLimit(kind: AttachmentPreviewKind): number {
  return kind === 'text' || kind === 'table' ? MAX_TEXT_PREVIEW_BYTES : MAX_MEDIA_PREVIEW_BYTES
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

export interface DelimitedPreview {
  headers: string[]
  rows: string[][]
  truncated: boolean
}

export function parseDelimitedPreview(
  name: string,
  mimeType: string,
  text: string,
  maxRows = 50,
  maxColumns = 12,
): DelimitedPreview | null {
  const delimiter = extension(name) === 'tsv' || mimeType.toLowerCase() === 'text/tab-separated-values' ? '\t' : ','
  const parsed: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let index = 0

  const finishCell = () => {
    if (row.length < maxColumns) row.push(cell)
    cell = ''
  }
  const finishRow = () => {
    finishCell()
    parsed.push(row)
    row = []
  }

  while (index < text.length && parsed.length <= maxRows) {
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
      finishRow()
      if (character === '\r' && text[index + 1] === '\n') index += 1
      index += 1
      continue
    }
    cell += character
    index += 1
  }
  if (cell || row.length) finishRow()
  if (!parsed.length || parsed[0]!.length < 2) return null

  const [headerRow, ...dataRows] = parsed
  return {
    headers: headerRow!.map((value, column) => value.trim() || `Column ${column + 1}`),
    rows: dataRows.slice(0, maxRows),
    truncated: index < text.length || dataRows.length > maxRows,
  }
}
