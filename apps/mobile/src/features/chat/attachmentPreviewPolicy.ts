export interface PreviewAttachment {
  id: string
  name: string
  uri?: string
  kind: 'image' | 'file'
}

export interface AttachmentPreviewFrame {
  x: number
  y: number
  width: number
  height: number
}

export function fittedFullscreenImageFrame(
  viewportWidth: number,
  viewportHeight: number,
  imageWidth: number,
  imageHeight: number,
): AttachmentPreviewFrame {
  const safeViewportWidth = Math.max(1, viewportWidth)
  const safeViewportHeight = Math.max(1, viewportHeight)
  const safeImageWidth = Math.max(1, imageWidth)
  const safeImageHeight = Math.max(1, imageHeight)
  const imageRatio = safeImageWidth / safeImageHeight
  const viewportRatio = safeViewportWidth / safeViewportHeight
  if (imageRatio >= viewportRatio) {
    const height = safeViewportWidth / imageRatio
    return { x: 0, y: (safeViewportHeight - height) / 2, width: safeViewportWidth, height }
  }
  const width = safeViewportHeight * imageRatio
  return { x: (safeViewportWidth - width) / 2, y: 0, width, height: safeViewportHeight }
}

export function imagePreviewGroup<T extends PreviewAttachment>(
  attachments: readonly T[],
  selectedId: string,
): { items: T[]; initialIndex: number } | null {
  const items = attachments.filter((attachment) => attachment.kind === 'image')
  const initialIndex = items.findIndex((attachment) => attachment.id === selectedId)
  return initialIndex < 0 ? null : { items, initialIndex }
}

export function previewSource(attachment: PreviewAttachment):
  | { kind: 'local'; uri: string }
  | { kind: 'download'; id: string; name: string } {
  return attachment.uri
    ? { kind: 'local', uri: attachment.uri }
    : { kind: 'download', id: attachment.id, name: attachment.name }
}

export function previewFallbackMessage(errorCode?: string): string {
  return errorCode === 'ERR_ATTACHMENT_PREVIEW_UNSUPPORTED'
    ? 'iOS cannot preview this file type, but you can open it in another app.'
    : 'The file could not be previewed. You can open it in another app instead.'
}
