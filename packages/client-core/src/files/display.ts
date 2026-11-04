import type { FileNode } from '@pulpo/contracts'

export type FilePreviewKind = 'image' | 'pdf' | 'video' | 'audio' | 'markdown' | 'quiz' | 'text' | null

/** Largest file that is fetched into memory for an inline preview. */
export const MAX_INLINE_PREVIEW_BYTES = 50 * 1024 * 1024
export const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024

const TEXT_EXTENSIONS = new Set([
  'txt', 'log', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'xml', 'html', 'css', 'js', 'jsx',
  'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'sh', 'sql', 'env',
])
export const CODE_EXTENSIONS = new Set(['json', 'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'sh', 'sql', 'html', 'css', 'xml'])
export const ARCHIVE_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'tgz', '7z', 'rar'])
export const SHEET_EXTENSIONS = new Set(['csv', 'tsv', 'xls', 'xlsx', 'numbers'])

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
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
  const mime = (mimeType ?? '').toLowerCase()
  if (mime.startsWith('audio/') || mime.startsWith('video/')) return mime
  return MEDIA_MIME_TYPES[fileExtension(name)] ?? null
}

export function filePreviewKind(node: Pick<FileNode, 'kind' | 'name' | 'mimeType' | 'sizeBytes'>): FilePreviewKind {
  if (node.kind !== 'blob') return null
  const mime = (node.mimeType ?? '').toLowerCase()
  const extension = fileExtension(node.name)
  const media = mime.startsWith('image/') ? null : mediaMimeType(node.name, mime)
  if (media?.startsWith('video/')) return 'video'
  if (media?.startsWith('audio/')) return 'audio'
  if (node.sizeBytes > MAX_INLINE_PREVIEW_BYTES) return null
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf' || extension === 'pdf') return 'pdf'
  if (node.sizeBytes > MAX_TEXT_PREVIEW_BYTES) return null
  if (extension === 'md' || extension === 'markdown' || mime === 'text/markdown') return 'markdown'
  if (extension === 'quiz') return 'quiz'
  if (mime.startsWith('text/') || mime === 'application/json' || TEXT_EXTENSIONS.has(extension)) return 'text'
  return null
}
