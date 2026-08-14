export interface PreviewAttachment {
  id: string
  name: string
  uri?: string
  kind: 'image' | 'file'
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
