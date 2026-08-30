import { describe, expect, it } from 'vitest'
import { SETTINGS_SECTION_IDS } from './settings-dialog'

describe('settings dialog sections', () => {
  it('keeps profile and security separate and in the expected navigation order', () => {
    expect(SETTINGS_SECTION_IDS).toEqual([
      'general',
      'profile',
      'security',
      'connections',
      'personalization',
      'interface',
      'billing',
      'api',
      'data',
      'trash',
      'about',
    ])
    expect(SETTINGS_SECTION_IDS).not.toContain('account')
  })
})
