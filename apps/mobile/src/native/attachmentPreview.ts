import { Platform } from 'react-native'
import PulpoAttachmentPreview from '../../modules/pulpo-attachment-preview'

export type AttachmentPreviewErrorCode =
  | 'ERR_ATTACHMENT_PREVIEW_BUSY'
  | 'ERR_ATTACHMENT_PREVIEW_MISSING_FILE'
  | 'ERR_ATTACHMENT_PREVIEW_UNSUPPORTED'
  | 'ERR_ATTACHMENT_PREVIEW_UNAVAILABLE'

export class AttachmentPreviewError extends Error {
  code: AttachmentPreviewErrorCode | 'ERR_ATTACHMENT_PREVIEW_UNAVAILABLE'

  constructor(message: string, code: AttachmentPreviewError['code']) {
    super(message)
    this.name = 'AttachmentPreviewError'
    this.code = code
  }
}

export const supportsAttachmentPreview = Platform.OS === 'ios' && PulpoAttachmentPreview !== null

export async function previewFile(uri: string, title: string): Promise<void> {
  if (!PulpoAttachmentPreview) {
    throw new AttachmentPreviewError('Native file previews are unavailable on this platform.', 'ERR_ATTACHMENT_PREVIEW_UNAVAILABLE')
  }
  try {
    await PulpoAttachmentPreview.previewFile(uri, title)
  } catch (cause) {
    const native = cause as { code?: string; message?: string }
    const code = native.code?.startsWith('ERR_ATTACHMENT_PREVIEW_')
      ? native.code as AttachmentPreviewErrorCode
      : 'ERR_ATTACHMENT_PREVIEW_UNAVAILABLE'
    throw new AttachmentPreviewError(native.message ?? 'The file could not be previewed.', code)
  }
}
