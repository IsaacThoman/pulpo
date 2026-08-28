import { attachmentUploadErrorMessage as sharedAttachmentUploadErrorMessage } from '@pulpo/client-core'
import { ApiError, isNetworkError } from './api'

export function attachmentUploadErrorMessage(error: unknown): string {
  return sharedAttachmentUploadErrorMessage({
    message: error instanceof Error ? error.message : undefined,
    status: error instanceof ApiError ? error.status : undefined,
    code: error instanceof ApiError ? error.code : undefined,
    network: isNetworkError(error),
  })
}
