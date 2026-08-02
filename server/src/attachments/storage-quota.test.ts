import { describe, expect, it } from 'vitest'
import { hasStorageCapacity } from './storage-quota.js'

describe('attachment storage quota', () => {
  it('accepts a file that exactly fills the remaining allowance', () => {
    expect(hasStorageCapacity(750, 1_000, 250)).toBe(true)
  })

  it('rejects files beyond the remaining allowance', () => {
    expect(hasStorageCapacity(751, 1_000, 250)).toBe(false)
    expect(hasStorageCapacity(1_100, 1_000, 1)).toBe(false)
  })
})
