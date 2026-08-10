import { describe, expect, it } from 'vitest'
import { attachmentSizeError, hasStorageCapacity } from './storage-quota.js'

describe('attachment storage quota', () => {
  it('accepts a file that exactly fills the remaining allowance', () => {
    expect(hasStorageCapacity(750, 1_000, 250)).toBe(true)
  })

  it('rejects files beyond the remaining allowance', () => {
    expect(hasStorageCapacity(751, 1_000, 250)).toBe(false)
    expect(hasStorageCapacity(1_100, 1_000, 1)).toBe(false)
  })

  it('enforces the configured per-file attachment limit', () => {
    const limit = 40 * 1024 * 1024
    expect(attachmentSizeError(limit, limit)).toBeNull()
    expect(attachmentSizeError(limit + 1, limit)).toBe('Attachment exceeds the 40 MB limit')
  })
})
