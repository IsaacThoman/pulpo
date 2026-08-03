import { describe, expect, it } from 'vitest'
import { attachmentQuotaBytes } from './attachment-cache'

describe('attachment cache quotas', () => {
  it('uses the 50 MB default for invalid values', () => {
    expect(attachmentQuotaBytes(Number.NaN)).toBe(50 * 1024 * 1024)
  })

  it('converts megabytes and clamps negative quotas', () => {
    expect(attachmentQuotaBytes(12.5)).toBe(12.5 * 1024 * 1024)
    expect(attachmentQuotaBytes(-1)).toBe(0)
  })
})
