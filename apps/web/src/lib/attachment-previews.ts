import { attachmentKind } from './attachments'
import { previewKindForFile } from './code-preview'
import { QUIZ_EXTENSION } from '@pulpo/client-core/quiz'
import {
  fileExtension,
  fileFamily,
  isTextFile,
  MAX_HTML_PREVIEW_BYTES,
  MAX_MARKDOWN_PREVIEW_BYTES,
  MAX_NOTEBOOK_PREVIEW_BYTES,
  MAX_TABLE_PREVIEW_BYTES,
  MAX_TEXT_PREVIEW_BYTES,
} from '@pulpo/client-core/files'

/**
 * `sandbox` files (HTML, JSX) run in the isolated code preview sandbox; SVG stays a plain image.
 * `text` covers code, highlighted by the file's name.
 */
export type AttachmentPreviewKind = 'image' | 'pdf' | 'markdown' | 'quiz' | 'text' | 'table' | 'audio' | 'video' | 'sandbox' | 'notebook'

export const MAX_MEDIA_PREVIEW_BYTES = 100 * 1024 * 1024
/** Markdown renders as a whole, so long files show their start. */
export const MAX_TEXT_PREVIEW_CHARACTERS = 200_000

export function attachmentPreviewKind(name: string, mimeType: string): AttachmentPreviewKind | null {
  const mime = mimeType.toLowerCase()
  const ext = fileExtension(name)
  const kind = attachmentKind(name, mimeType)
  const family = fileFamily(name, mimeType)

  if (kind === 'image') return 'image'
  if (kind === 'pdf') return 'pdf'
  if (kind === 'audio') return 'audio'
  if (kind === 'video') return 'video'
  if (family === 'delimited' || mime === 'text/csv' || mime === 'text/tab-separated-values') return 'table'
  if (ext === 'md' || mime === 'text/markdown') return 'markdown'
  if (ext === QUIZ_EXTENSION) return 'quiz'
  if (family === 'notebook') return 'notebook'
  if (previewKindForFile(name, mimeType)) return 'sandbox'
  if (isTextFile(name, mimeType)) return 'text'
  return null
}

export function isTextPreviewKind(kind: AttachmentPreviewKind): boolean {
  return kind === 'markdown' || kind === 'quiz' || kind === 'text' || kind === 'table' || kind === 'sandbox' || kind === 'notebook'
}

export function previewSizeLimit(kind: AttachmentPreviewKind): number {
  switch (kind) {
    case 'markdown':
    case 'quiz': return MAX_MARKDOWN_PREVIEW_BYTES
    case 'text': return MAX_TEXT_PREVIEW_BYTES
    case 'table': return MAX_TABLE_PREVIEW_BYTES
    case 'notebook': return MAX_NOTEBOOK_PREVIEW_BYTES
    case 'sandbox': return MAX_HTML_PREVIEW_BYTES
    default: return MAX_MEDIA_PREVIEW_BYTES
  }
}

/** Markdown renders as a whole, so a long file previews its start. */
export function truncateTextPreview(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_TEXT_PREVIEW_CHARACTERS) return { text, truncated: false }
  return { text: text.slice(0, MAX_TEXT_PREVIEW_CHARACTERS), truncated: true }
}
