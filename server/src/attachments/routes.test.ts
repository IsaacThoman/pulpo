import { describe, expect, it } from 'vitest'
import { attachmentStorageErrorCode, attachmentUploadContentType } from './routes.js'

describe('attachmentUploadContentType', () => {
  it('uses the registered raw-body parser for local uploads', () => {
    expect(attachmentUploadContentType('local', 'image/png')).toBe('application/octet-stream')
  })

  it('preserves the signed content type for S3 uploads', () => {
    expect(attachmentUploadContentType('s3', 'image/png')).toBe('image/png')
  })
})

describe('attachmentStorageErrorCode', () => {
  it('exposes a safe filesystem error code', () => {
    expect(attachmentStorageErrorCode(Object.assign(new Error('sensitive path'), { code: 'EACCES' }))).toBe('attachment_storage_eacces')
  })

  it('falls back without exposing an arbitrary error message', () => {
    expect(attachmentStorageErrorCode(new Error('/private/path'))).toBe('attachment_storage_error')
  })
})
