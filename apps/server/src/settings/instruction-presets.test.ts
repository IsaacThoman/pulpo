import { describe, expect, it } from 'vitest'
import type { PersonalizationSettings } from '@pulpo/contracts'
import { composeCustomInstructions } from './instruction-presets.js'

const personalization: PersonalizationSettings = {
  instructionPresets: [
    { id: 'first', title: 'First', instructions: 'First preset.', color: '#112233', defaultEnabled: true },
    { id: 'second', title: 'Second', instructions: 'Second preset.', color: '#445566', defaultEnabled: false },
  ],
}

describe('custom-instruction preset composition', () => {
  it('uses per-preset defaults when the user has no explicit choice', () => {
    expect(composeCustomInstructions(personalization, {})).toBe('First preset.')
  })

  it('lets explicit choices override defaults and preserves admin order', () => {
    expect(composeCustomInstructions(personalization, {
      instructionPresetSelections: { first: false, second: true, deleted: true },
      customInstructions: 'User instructions.',
    })).toBe('Second preset.\n\nUser instructions.')
  })

  it('prepends every enabled preset before custom instructions', () => {
    expect(composeCustomInstructions(personalization, {
      instructionPresetSelections: { second: true },
      customInstructions: '  User instructions.  ',
    })).toBe('First preset.\n\nSecond preset.\n\nUser instructions.')
  })

  it('ignores malformed and stale selection values', () => {
    expect(composeCustomInstructions(personalization, {
      instructionPresetSelections: { first: 'false', deleted: true },
    })).toBe('First preset.')
  })
})
