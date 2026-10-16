import { previewKindForFile } from '@pulpo/client-core/code-preview'
import { AttachmentPreviewError, previewFile, previewWebDocument, supportsWebDocumentPreview } from './attachmentPreview'

export async function openAttachmentFile(uri: string, title: string, mimeType?: string): Promise<void> {
  // Quick Look renders HTML without running its scripts, so pages open in the sandboxed web preview.
  if (supportsWebDocumentPreview && previewKindForFile(title, mimeType) === 'html') {
    try {
      return await previewWebDocument(uri, title)
    } catch (error) {
      // Pages too large to run still open as a static Quick Look document.
      if (!(error instanceof AttachmentPreviewError && error.code === 'ERR_ATTACHMENT_PREVIEW_UNSUPPORTED')) throw error
    }
  }
  return previewFile(uri, title)
}
