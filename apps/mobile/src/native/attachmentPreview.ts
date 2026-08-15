import { Platform } from 'react-native'
import PulpoAttachmentPreview, {
  type PulpoImageGalleryItem,
  type PulpoImageTransitionFrame,
} from '../../modules/pulpo-attachment-preview'

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
export const supportsNativeImageTransition = Platform.OS === 'ios'
  && typeof PulpoAttachmentPreview?.animateImageTransition === 'function'
export const supportsNativeImageGallery = Platform.OS === 'ios'
  && typeof PulpoAttachmentPreview?.previewImages === 'function'

function attachmentPreviewError(cause: unknown, fallback: string): AttachmentPreviewError {
  const native = cause as { code?: string; message?: string }
  const details = `${native.code ?? ''} ${native.message ?? ''}`
  const code: AttachmentPreviewErrorCode = details.includes('AttachmentPreviewBusy')
    ? 'ERR_ATTACHMENT_PREVIEW_BUSY'
    : details.includes('AttachmentPreviewMissingFile')
      ? 'ERR_ATTACHMENT_PREVIEW_MISSING_FILE'
      : details.includes('AttachmentPreviewUnsupported')
        ? 'ERR_ATTACHMENT_PREVIEW_UNSUPPORTED'
        : native.code?.startsWith('ERR_ATTACHMENT_PREVIEW_')
          ? native.code as AttachmentPreviewErrorCode
          : 'ERR_ATTACHMENT_PREVIEW_UNAVAILABLE'
  const message = code === 'ERR_ATTACHMENT_PREVIEW_BUSY'
    ? 'Another preview is already open.'
    : code === 'ERR_ATTACHMENT_PREVIEW_MISSING_FILE'
      ? 'The attachment is no longer available.'
      : code === 'ERR_ATTACHMENT_PREVIEW_UNSUPPORTED'
        ? 'iOS cannot preview this attachment type.'
        : fallback
  return new AttachmentPreviewError(message, code)
}

export async function previewImages(
  items: PulpoImageGalleryItem[],
  initialIndex: number,
  sourceFrame?: PulpoImageTransitionFrame,
): Promise<void> {
  if (!supportsNativeImageGallery || !PulpoAttachmentPreview) {
    throw new AttachmentPreviewError('Native image previews are unavailable on this platform.', 'ERR_ATTACHMENT_PREVIEW_UNAVAILABLE')
  }
  try {
    await PulpoAttachmentPreview.previewImages(items, initialIndex, sourceFrame)
  } catch (cause) {
    throw attachmentPreviewError(cause, 'The images could not be previewed.')
  }
}

export async function animateImageTransition(
  uri: string,
  fromFrame: PulpoImageTransitionFrame,
  toFrame: PulpoImageTransitionFrame,
  opening: boolean,
): Promise<boolean> {
  if (!supportsNativeImageTransition || !PulpoAttachmentPreview) return false
  try {
    await PulpoAttachmentPreview.animateImageTransition(uri, fromFrame, toFrame, opening)
    return true
  } catch {
    return false
  }
}

export async function previewFile(uri: string, title: string): Promise<void> {
  if (!PulpoAttachmentPreview) {
    throw new AttachmentPreviewError('Native file previews are unavailable on this platform.', 'ERR_ATTACHMENT_PREVIEW_UNAVAILABLE')
  }
  try {
    await PulpoAttachmentPreview.previewFile(uri, title)
  } catch (cause) {
    throw attachmentPreviewError(cause, 'The file could not be previewed.')
  }
}
