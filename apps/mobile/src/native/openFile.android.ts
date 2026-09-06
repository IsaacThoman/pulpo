import { getContentUriAsync } from 'expo-file-system/legacy'
import { startActivityAsync } from 'expo-intent-launcher'

export async function openAttachmentFile(uri: string, _title: string, mimeType?: string): Promise<void> {
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
