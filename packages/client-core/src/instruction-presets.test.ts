import { describe, expect, it } from 'vitest'
import { instructionPresetEnabled } from './instruction-presets.js'

describe('instruction presets', () => {
  it('follows the admin default until the account chooses', () => {
    expect(instructionPresetEnabled({ id: 'casual', defaultEnabled: false }, {})).toBe(false)
    expect(instructionPresetEnabled({ id: 'casual', defaultEnabled: true }, {})).toBe(true)
    expect(instructionPresetEnabled({ id: 'casual', defaultEnabled: true }, { other: false })).toBe(true)
  })

  it('prefers explicit selections in either direction', () => {
    expect(instructionPresetEnabled({ id: 'casual', defaultEnabled: false }, { casual: true })).toBe(true)
    expect(instructionPresetEnabled({ id: 'casual', defaultEnabled: true }, { casual: false })).toBe(false)
  })
})
