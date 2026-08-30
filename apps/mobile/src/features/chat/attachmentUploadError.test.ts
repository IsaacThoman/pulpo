import { describe, expect, it } from 'vitest'
import { ApiError } from '../../api/client'
import { attachmentUploadErrorMessage } from './attachmentUploadError'

describe('attachmentUploadErrorMessage', () => {
  it('explains unreadable provider files', () => {
    expect(attachmentUploadErrorMessage(new Error('Attachment is empty')))
      .toBe('Pulpo couldn’t read this file. Save a copy to Files, then select the copy and try again.')
  })

  it('explains validation responses from a direct upload', () => {
    expect(attachmentUploadErrorMessage(new Error('Upload failed (400)')))
      .toBe('Pulpo couldn’t verify this file. Save a fresh copy to Files, then try again.')
  })

  it('distinguishes storage quota failures', () => {
    expect(attachmentUploadErrorMessage(new ApiError(413, 'storage_quota_exceeded', 'quota exceeded')))
      .toBe('Not enough storage remains for this file. Free some storage and try again.')
  })

  it('gives network failures a retry action', () => {
    expect(attachmentUploadErrorMessage(new TypeError('Network request failed')))
      .toBe('Connection lost during upload. Check your connection and try again.')
  })

  it('preserves an actionable configured size limit', () => {
    expect(attachmentUploadErrorMessage(new Error('Attachment exceeds the 25 MB limit')))
      .toBe('Attachment exceeds the 25 MB limit')
  })
})
