import type { FileNode } from '@pulpo/contracts'

export type FilePreviewKind = 'image' | 'pdf' | 'video' | 'audio' | 'markdown' | 'text' | null

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

export function filePreviewKind(node: Pick<FileNode, 'kind' | 'name' | 'mimeType' | 'sizeBytes'>): FilePreviewKind {
  if (node.kind !== 'blob') return null
  const mime = (node.mimeType ?? '').toLowerCase()
  const extension = fileExtension(node.name)
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (node.sizeBytes > MAX_INLINE_PREVIEW_BYTES) return null
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf' || extension === 'pdf') return 'pdf'
  if (node.sizeBytes > MAX_TEXT_PREVIEW_BYTES) return null
  if (extension === 'md' || extension === 'markdown' || mime === 'text/markdown') return 'markdown'
  if (mime.startsWith('text/') || mime === 'application/json' || TEXT_EXTENSIONS.has(extension)) return 'text'
  return null
}
