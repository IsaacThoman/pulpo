import { detectImageMime } from '../agent/images.js'

const CONFIRMED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

export function canonicalUploadedMimeType(declaredMimeType: string, bytes: Uint8Array): string {
  const detectedImageMime = detectImageMime(bytes)
  if (detectedImageMime) return detectedImageMime
  if (declaredMimeType.toLowerCase().startsWith('image/')) return 'application/octet-stream'
  return declaredMimeType
}

export function isConfirmedRasterImage(mimeType: string): boolean {
  return CONFIRMED_IMAGE_MIME_TYPES.has(mimeType.toLowerCase())
}

export function attachmentsRequireAgentMode(rows: Array<{ mimeType: string }>): boolean {
  return rows.some((row) => !isConfirmedRasterImage(row.mimeType))
}
