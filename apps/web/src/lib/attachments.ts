const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
])

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

export function isSupportedImageMime(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.has(mimeType.toLowerCase())
}

export function isSupportedImageFile(file: File): boolean {
  if (isSupportedImageMime(file.type)) return true
  const name = file.name.toLowerCase()
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return IMAGE_EXTENSIONS.has(name.slice(dot))
}

export function extensionForImageMime(mimeType: string): string {
  return MIME_TO_EXTENSION[mimeType.toLowerCase()] ?? '.png'
}

/** Normalize image metadata so byte-valid images reach the server with a useful name and MIME type. */
export function normalizeImageFile(file: File): File | null {
  if (!isSupportedImageFile(file)) return null
  const mimeType = file.type && isSupportedImageMime(file.type)
    ? file.type
    : guessMimeFromName(file.name) ?? 'image/png'
  const extension = extensionForImageMime(mimeType)
  const baseName = file.name?.trim()
  const hasExtension = baseName && IMAGE_EXTENSIONS.has(baseName.slice(baseName.lastIndexOf('.')).toLowerCase())
  const name = hasExtension
    ? baseName
    : baseName && baseName !== 'image'
      ? `${baseName}${extension}`
      : `image-${Date.now()}${extension}`
  if (file.name === name && file.type === mimeType) return file
  return new File([file], name, { type: mimeType, lastModified: file.lastModified })
}

function guessMimeFromName(name: string): string | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return null
}

export function collectImageFiles(list: FileList | File[] | DataTransferItemList | null | undefined): File[] {
  if (!list) return []
  const files: File[] = []
  if (typeof DataTransferItemList !== 'undefined' && list instanceof DataTransferItemList) {
    for (const item of Array.from(list)) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (!file) continue
      const normalized = normalizeImageFile(file)
      if (normalized) files.push(normalized)
    }
    return files
  }
  for (const file of Array.from(list as FileList | File[])) {
    const normalized = normalizeImageFile(file)
    if (normalized) files.push(normalized)
  }
  return files
}

export function collectUploadFiles(list: FileList | File[] | DataTransferItemList | null | undefined): File[] {
  if (!list) return []
  const values = typeof DataTransferItemList !== 'undefined' && list instanceof DataTransferItemList
    ? Array.from(list).flatMap((item) => item.kind === 'file' && item.getAsFile() ? [item.getAsFile()!] : [])
    : Array.from(list as FileList | File[])
  return values.map((file) => normalizeImageFile(file) ?? file)
}

export type NonImageAttachmentRestriction = 'enable_agent' | 'model_not_capable' | 'agent_unavailable'

export function nonImageAttachmentRestriction(input: {
  hasNonImage: boolean
  agentModeEnabled: boolean
  agentAvailable: boolean
  agentCapable: boolean
}): NonImageAttachmentRestriction | null {
  if (!input.hasNonImage) return null
  if (!input.agentAvailable) return 'agent_unavailable'
  if (!input.agentCapable) return 'model_not_capable'
  if (!input.agentModeEnabled) return 'enable_agent'
  return null
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}
