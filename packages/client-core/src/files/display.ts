import type { FileNode } from '@pulpo/contracts'
import { isQuizFileName } from '../quiz.js'
import { baseMimeType, fileExtension, fileTypeOf, isTextFile } from './file-types.js'

export {
  ARCHIVE_EXTENSIONS,
  CODE_EXTENSIONS,
  fileExtension,
  SHEET_EXTENSIONS,
} from './file-types.js'

/**
 * How Files shows an uploaded file. `text` covers code too (highlighted by its name), `table` is
 * CSV/TSV as a grid, and `html`/`svg` render in the opaque-origin sandbox with a source view.
 */
export type FilePreviewKind =
  | 'image'
  | 'pdf'
  | 'video'
  | 'audio'
  | 'markdown'
  | 'quiz'
  | 'text'
  | 'table'
  | 'html'
  | 'svg'
  | 'notebook'
  | null

/** Largest file that is fetched into memory for an inline preview. */
export const MAX_INLINE_PREVIEW_BYTES = 50 * 1024 * 1024
/** Markdown and quizzes render as a whole, so they keep a tighter limit than virtualized text. */
export const MAX_MARKDOWN_PREVIEW_BYTES = 2 * 1024 * 1024
/** Text and code render line by line in a virtualized view. */
export const MAX_TEXT_PREVIEW_BYTES = 10 * 1024 * 1024
/** Grids index the file once and parse rows as they scroll into view. */
export const MAX_TABLE_PREVIEW_BYTES = 25 * 1024 * 1024
/** Notebooks often carry their plots as base64 images. */
export const MAX_NOTEBOOK_PREVIEW_BYTES = 25 * 1024 * 1024
/** Pages run in the sandbox; matches the iOS web preview's limit. */
export const MAX_HTML_PREVIEW_BYTES = 10 * 1024 * 1024

/** The largest file each preview fetches; larger files offer a download instead. */
export function previewByteLimit(kind: Exclude<FilePreviewKind, null>): number {
  switch (kind) {
    case 'markdown':
    case 'quiz': return MAX_MARKDOWN_PREVIEW_BYTES
    case 'text': return MAX_TEXT_PREVIEW_BYTES
    case 'table': return MAX_TABLE_PREVIEW_BYTES
    case 'notebook': return MAX_NOTEBOOK_PREVIEW_BYTES
    case 'html':
    case 'svg': return MAX_HTML_PREVIEW_BYTES
    default: return MAX_INLINE_PREVIEW_BYTES
  }
}

/** Browser-playable media types by extension, for files stored under a generic type. */
const MEDIA_MIME_TYPES: Record<string, string> = {
  aac: 'audio/aac', flac: 'audio/flac', m4a: 'audio/mp4', mp3: 'audio/mpeg', oga: 'audio/ogg', ogg: 'audio/ogg',
  opus: 'audio/ogg', wav: 'audio/wav', m4v: 'video/mp4', mov: 'video/quicktime', mp4: 'video/mp4', webm: 'video/webm',
}

/**
 * The audio or video type to play a file as: its stored type when that is already media, otherwise
 * the one its extension implies. Agent-written and untyped uploads are often stored as
 * `application/octet-stream`, which some browsers refuse to play.
 */
export function mediaMimeType(name: string, mimeType: string | null | undefined): string | null {
  const mime = baseMimeType(mimeType)
  if (mime.startsWith('audio/') || mime.startsWith('video/')) return mime
  return MEDIA_MIME_TYPES[fileExtension(name)] ?? null
}

/** The preview a file gets by its name and type, before size limits. */
export function previewKindOf(name: string, mimeType: string | null | undefined): Exclude<FilePreviewKind, null> | null {
  const mime = baseMimeType(mimeType)
  const type = fileTypeOf(name, mimeType)
  // Streams are played by the browser, whatever the extension claims, except source code whose
  // extension a media type shares (`.ts` is TypeScript, but browsers upload it as `video/mp2t`).
  if (type?.family === 'code' && (mime.startsWith('video/') || mime.startsWith('audio/'))) return 'text'
  // Media is played by its stored type, or the one its extension implies for untyped uploads.
  const media = mime.startsWith('image/') ? null : mediaMimeType(name, mime)
  if (media?.startsWith('video/')) return 'video'
  if (media?.startsWith('audio/')) return 'audio'
  if (isQuizFileName(name)) return 'quiz'
  switch (type?.family) {
    case 'markdown': return 'markdown'
    case 'delimited': return 'table'
    case 'html': return 'html'
    case 'svg': return 'svg'
    case 'notebook': return 'notebook'
    case 'pdf': return 'pdf'
    case 'image': return mime.startsWith('image/') || !mime || mime === 'application/octet-stream' ? 'image' : null
    // Other media (WMA, MKV) only plays where its stored type says so; otherwise it's a download.
    case 'video':
    case 'audio': return null
    // Office files (RTF included, though it is text) keep their download until their viewers exist.
    case 'document':
    case 'spreadsheet':
    case 'presentation': return null
    default: break
  }
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('image/')) return 'image'
  return isTextFile(name, mimeType) ? 'text' : null
}

export function filePreviewKind(node: Pick<FileNode, 'kind' | 'name' | 'mimeType' | 'sizeBytes'>): FilePreviewKind {
  if (node.kind !== 'blob') return null
  const kind = previewKindOf(node.name, node.mimeType)
  if (!kind) return null
  // Media streams from a URL, so only in-memory previews are capped.
  if (kind === 'video' || kind === 'audio') return kind
  return node.sizeBytes > previewByteLimit(kind) ? null : kind
}
