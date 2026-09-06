import { previewFile } from './attachmentPreview'

export function openAttachmentFile(uri: string, title: string, _mimeType?: string): Promise<void> {
  return previewFile(uri, title)
}
