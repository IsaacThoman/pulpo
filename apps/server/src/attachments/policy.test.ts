import { describe, expect, it } from 'vitest'
import {
  attachmentsRequireAgentMode,
  canonicalUploadedMimeType,
  isConfirmedRasterImage,
} from './policy.js'

describe('canonicalUploadedMimeType', () => {
  it('uses the detected MIME type for supported image bytes', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(canonicalUploadedMimeType('application/octet-stream', png)).toBe('image/png')
  })

  it('downgrades a spoofed image MIME type', () => {
    expect(canonicalUploadedMimeType('image/png', Buffer.from('not an image'))).toBe('application/octet-stream')
  })

  it('preserves arbitrary non-image metadata for Agent mode', () => {
    expect(canonicalUploadedMimeType('application/zip', Buffer.from('archive'))).toBe('application/zip')
    expect(canonicalUploadedMimeType('image/svg+xml', Buffer.from('<svg/>'))).toBe('application/octet-stream')
  })
})

describe('attachmentsRequireAgentMode', () => {
  it('allows only confirmed raster image MIME types without Agent mode', () => {
    expect(isConfirmedRasterImage('image/jpeg')).toBe(true)
    expect(attachmentsRequireAgentMode([{ mimeType: 'image/png' }, { mimeType: 'image/gif' }])).toBe(false)
    expect(attachmentsRequireAgentMode([{ mimeType: 'image/png' }, { mimeType: 'application/pdf' }])).toBe(true)
    expect(attachmentsRequireAgentMode([{ mimeType: 'image/svg+xml' }])).toBe(true)
  })
})
