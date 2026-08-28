import { ApiError, isNetworkError } from '../../api/client'

const unreadableFileMessage = 'Pulpo couldn’t read this file. Save a copy to Files, then select the copy and try again.'
const invalidFileMessage = 'Pulpo couldn’t verify this file. Save a fresh copy to Files, then try again.'

function uploadStatus(message: string): number | undefined {
  const match = message.match(/^Upload failed \((\d{3})\)$/i)
  return match ? Number(match[1]) : undefined
}

export function attachmentUploadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'storage_quota_exceeded') return 'Not enough storage remains for this file. Free some storage and try again.'
    if (error.code === 'attachment_too_large') return error.message
    if (error.code === 'attachment_validation_failed' || error.code === 'attachment_size_mismatch') return invalidFileMessage
    if (error.code === 'request_timeout') return 'The upload timed out. Check your connection and try again.'
    if (error.status === 401 || error.status === 403) return 'Your session can’t upload this file. Sign in again and retry.'
    if (error.status === 413) return 'The server rejected this file’s size. Choose a smaller file or ask an administrator to raise the limit.'
    if (error.status >= 500) return 'The server couldn’t accept the upload right now. Try again in a moment.'
  }

  if (isNetworkError(error)) return 'Connection lost during upload. Check your connection and try again.'

  const message = error instanceof Error ? error.message.trim() : ''
  if (/attachment is empty|file does not exist|unable to upload|failed to access|couldn.t open|cannot read/i.test(message)) {
    return unreadableFileMessage
  }
  if (/attachment exceeds|not enough storage|storage allowance/i.test(message)) return message

  const status = uploadStatus(message)
  if (status === 400 || status === 409 || status === 422) return invalidFileMessage
  if (status === 401 || status === 403) return 'Your session can’t upload this file. Sign in again and retry.'
  if (status === 413) return 'The server rejected this file’s size. Choose a smaller file or ask an administrator to raise the limit.'
  if (status !== undefined && status >= 500) return 'The server couldn’t accept the upload right now. Try again in a moment.'

  return message || 'Upload failed. Try selecting the file again.'
}
