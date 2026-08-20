import { describe, expect, it } from 'vitest'
import { parseBillingSettings } from '../settings/application-settings.js'
import { effectiveStorageLimit, storageDefaultForPlan } from './storage-entitlements.js'

describe('storage plan defaults', () => {
  const settings = parseBillingSettings({
    babyStorageLimitBytes: 5,
    eightStorageLimitBytes: 25,
    fatStorageLimitBytes: 100,
  })

  it.each([
    ['baby', 5],
    ['eight', 25],
    ['fat', 100],
  ] as const)('resolves the %s plan allowance', (plan, expected) => {
    expect(storageDefaultForPlan(settings, plan)).toBe(expected)
  })

  it('accepts zero as an explicit override', () => {
    expect(effectiveStorageLimit(settings, 'fat', 0)).toEqual({
      storageLimitBytes: 0,
      storageLimitOverridden: true,
    })
  })

  it('returns to the plan default when an override is reset', () => {
    expect(effectiveStorageLimit(settings, 'eight', null)).toEqual({
      storageLimitBytes: 25,
      storageLimitOverridden: false,
    })
  })
})
