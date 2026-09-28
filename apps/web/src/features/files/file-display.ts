import { isMarkdownName, type FileNameError, type FileNode } from '@pulpo/contracts'
import { ApiError } from '@/lib/api'
import { ui, uit } from '@/i18n/ui'

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

/** Short type description for the Kind column. */
export function fileKindLabel(node: Pick<FileNode, 'kind' | 'name'>): string {
  if (node.kind === 'folder') return ui("Folder")
  // The extension alone decides the type, whether or not the file is editable yet.
  if (isMarkdownName(node.name)) return ui("Markdown")
  const extension = fileExtension(node.name)
  return extension ? extension.toUpperCase() : ui("File")
}

export function fileNameErrorMessage(error: FileNameError): string {
  switch (error) {
    case 'empty': return ui("Name is required")
    case 'too_long': return ui("Names can be at most 255 characters")
    case 'reserved': return ui("This name is reserved")
    case 'invalid_character': return ui("Names cannot contain \"/\" or control characters")
  }
}

/** Translates the Files API's known failures; anything else keeps the server's message. */
export function filesErrorMessage(error: unknown, name?: string): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'file_name_conflict': return name ? uit`An item named "${name}" already exists here` : ui("An item with this name already exists here")
      case 'file_name_empty':
      case 'file_name_too_long':
      case 'file_name_reserved':
      case 'file_name_invalid_character':
        return fileNameErrorMessage(error.code.slice('file_name_'.length) as FileNameError)
      case 'file_move_cycle': return ui("A folder cannot be moved into itself")
      case 'file_tree_too_deep': return ui("Folders can be nested at most 32 levels deep")
      case 'file_revision_conflict': return ui("This item changed on another device. Refresh and try again.")
      case 'storage_quota_exceeded': return ui("This file would exceed your storage allowance")
      case 'files_disabled': return ui("Files are disabled by the administrator")
      case 'file_too_large_to_edit': return ui("This file is too large to edit")
      case 'file_not_text': return ui("This file isn't plain text, so it can't be edited")
      case 'file_not_markdown': return ui("Only .md and .markdown files can be edited")
      case 'not_found': return ui("This item no longer exists")
      default: return error.message
    }
  }
  return error instanceof Error ? error.message : ui("Something went wrong")
}
