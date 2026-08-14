export const MAX_COMPOSER_ATTACHMENTS = 6

export type AttachmentVisualKind =
  | 'image'
  | 'pdf'
  | 'text'
  | 'code'
  | 'spreadsheet'
  | 'presentation'
  | 'archive'
  | 'audio'
  | 'video'
  | 'file'

const IMAGE_EXTENSIONS = new Set(['gif', 'jpeg', 'jpg', 'png', 'webp'])
const CODE_EXTENSIONS = new Set([
  'c', 'cc', 'cpp', 'cs', 'css', 'go', 'h', 'hpp', 'html', 'java', 'js', 'jsx',
  'json', 'kt', 'kts', 'php', 'py', 'rb', 'rs', 'sh', 'sql', 'swift', 'toml',
  'ts', 'tsx', 'vue', 'xml', 'yaml', 'yml',
])
const TEXT_EXTENSIONS = new Set(['log', 'md', 'rtf', 'txt'])
const SPREADSHEET_EXTENSIONS = new Set(['csv', 'numbers', 'ods', 'tsv', 'xls', 'xlsx'])
const PRESENTATION_EXTENSIONS = new Set(['key', 'odp', 'ppt', 'pptx'])
const ARCHIVE_EXTENSIONS = new Set(['7z', 'bz2', 'gz', 'rar', 'tar', 'tgz', 'zip'])
const AUDIO_EXTENSIONS = new Set(['aac', 'aiff', 'flac', 'm4a', 'mp3', 'ogg', 'wav'])
const VIDEO_EXTENSIONS = new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'webm'])

function extension(name: string): string | null {
  return name.trim().toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] ?? null
}

export function attachmentVisualKind(name: string, mimeType: string): AttachmentVisualKind {
  const mime = mimeType.trim().toLowerCase()
  const ext = extension(name)
  if (mime.startsWith('image/') || (ext && IMAGE_EXTENSIONS.has(ext))) return 'image'
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (mime.startsWith('audio/') || (ext && AUDIO_EXTENSIONS.has(ext))) return 'audio'
  if (mime.startsWith('video/') || (ext && VIDEO_EXTENSIONS.has(ext))) return 'video'
  if (
    mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('numbers')
    || (ext && SPREADSHEET_EXTENSIONS.has(ext))
  ) return 'spreadsheet'
  if (
    mime.includes('presentation') || mime.includes('powerpoint') || mime.includes('keynote')
    || (ext && PRESENTATION_EXTENSIONS.has(ext))
  ) return 'presentation'
  if (mime.includes('zip') || mime.includes('compressed') || (ext && ARCHIVE_EXTENSIONS.has(ext))) return 'archive'
  if (
    mime.includes('javascript') || mime.includes('json') || mime.includes('yaml')
    || mime.includes('xml') || (ext && CODE_EXTENSIONS.has(ext))
  ) return 'code'
  if (mime.startsWith('text/') || mime.includes('word') || mime.includes('opendocument.text') || (ext && TEXT_EXTENSIONS.has(ext))) return 'text'
  return 'file'
}

export function isImageAttachment(name: string, mimeType: string): boolean {
  return attachmentVisualKind(name, mimeType) === 'image'
}

export function attachmentTypeLabel(name: string, mimeType: string): string {
  const ext = extension(name)
  if (ext) return ext.toUpperCase()
  const labels: Record<AttachmentVisualKind, string> = {
    image: 'Image', pdf: 'PDF', text: 'Document', code: 'Code', spreadsheet: 'Spreadsheet',
    presentation: 'Presentation', archive: 'Archive', audio: 'Audio', video: 'Video', file: 'File',
  }
  return labels[attachmentVisualKind(name, mimeType)]
}

export function formatAttachmentSize(size?: number): string {
  if (!size || size < 0) return 'Unknown size'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function attachmentMetadata(name: string, mimeType: string, size?: number): string {
  return `${attachmentTypeLabel(name, mimeType)} · ${formatAttachmentSize(size)}`
}

export function fitAttachmentPreviewSize(
  sourceWidth: number,
  sourceHeight: number,
  maximumWidth = 320,
  maximumHeight = 420,
): { width: number; height: number } {
  const safeMaximumWidth = Number.isFinite(maximumWidth) && maximumWidth > 0 ? maximumWidth : 320
  const safeMaximumHeight = Number.isFinite(maximumHeight) && maximumHeight > 0 ? maximumHeight : 420
  if (
    !Number.isFinite(sourceWidth) || sourceWidth <= 0
    || !Number.isFinite(sourceHeight) || sourceHeight <= 0
  ) return { width: safeMaximumWidth, height: Math.min(safeMaximumWidth, safeMaximumHeight) }

  const scale = Math.min(safeMaximumWidth / sourceWidth, safeMaximumHeight / sourceHeight)
  return {
    width: Math.round(sourceWidth * scale),
    height: Math.round(sourceHeight * scale),
  }
}

export function selectAttachmentBatch<T extends { uri: string }>(
  current: T[],
  incoming: T[],
  limit = MAX_COMPOSER_ATTACHMENTS,
): { accepted: T[]; duplicateCount: number; overflowCount: number } {
  const known = new Set(current.map((attachment) => attachment.uri))
  const unique: T[] = []
  let duplicateCount = 0
  for (const attachment of incoming) {
    if (known.has(attachment.uri)) {
      duplicateCount += 1
      continue
    }
    known.add(attachment.uri)
    unique.push(attachment)
  }
  const remaining = Math.max(0, limit - current.length)
  return {
    accepted: unique.slice(0, remaining),
    duplicateCount,
    overflowCount: Math.max(0, unique.length - remaining),
  }
}
