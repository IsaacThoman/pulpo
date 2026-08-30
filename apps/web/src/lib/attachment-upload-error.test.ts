import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { attachmentUploadErrorMessage } from './attachment-upload-error'

describe('attachmentUploadErrorMessage', () => {
  it('adapts structured API failures', () => {
    expect(attachmentUploadErrorMessage(new ApiError(413, 'storage_quota_exceeded', 'quota exceeded')))
      .toBe('Not enough storage remains for this file. Free some storage and try again.')
  })

  it('adapts browser network failures', () => {
    expect(attachmentUploadErrorMessage(new TypeError('Failed to fetch')))
      .toBe('Connection lost during upload. Check your connection and try again.')
  })
})
