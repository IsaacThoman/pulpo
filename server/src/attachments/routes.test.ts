import { describe, expect, it } from 'vitest'
import { attachmentUploadContentType } from './routes.js'

describe('attachmentUploadContentType', () => {
  it('uses the registered raw-body parser for local uploads', () => {
    expect(attachmentUploadContentType('local', 'image/png')).toBe('application/octet-stream')
  })

  it('preserves the signed content type for S3 uploads', () => {
    expect(attachmentUploadContentType('s3', 'image/png')).toBe('image/png')
  })
})
