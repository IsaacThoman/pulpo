import { previewKindForFile } from '@pulpo/client-core/code-preview'
import { getContentUriAsync } from 'expo-file-system/legacy'
import { startActivityAsync } from 'expo-intent-launcher'
import { AttachmentPreviewError, previewWebDocument, supportsWebDocumentPreview } from './attachmentPreview'

export async function openAttachmentFile(uri: string, title: string, mimeType?: string): Promise<void> {
  // Pages run in the app's sandboxed web preview rather than a browser that would give them a real origin.
  if (supportsWebDocumentPreview && previewKindForFile(title, mimeType) === 'html' && uri.startsWith('file://')) {
    try {
      return await previewWebDocument(uri, title)
    } catch (error) {
      // Pages too large to run open in the system viewer instead.
      if (!(error instanceof AttachmentPreviewError && error.code === 'ERR_ATTACHMENT_PREVIEW_UNSUPPORTED')) throw error
    }
  }
  // FileProvider exposes a cached attachment through a temporary read grant.
  // Passing file:// directly fails on Android and exposes no usable file.
  if (!uri.startsWith('file://') && !uri.startsWith('content://')) throw new Error('Download the attachment before opening it.')
  const data = uri.startsWith('content://') ? uri : await getContentUriAsync(uri)
  await startActivityAsync('android.intent.action.VIEW', {
    data,
    type: mimeType || '*/*',
    flags: 1, // Intent.FLAG_GRANT_READ_URI_PERMISSION
  })
}
