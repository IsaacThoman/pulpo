import { describe, expect, it } from 'vitest'
import { moveInstructionPreset } from './personalization-presets-logic'

describe('admin instruction preset ordering', () => {
  it('reorders presets without changing their stable ids or mutating the source', () => {
    const original = [{ id: 'first' }, { id: 'second' }, { id: 'third' }]
    expect(moveInstructionPreset(original, 2, -1)).toEqual([
      { id: 'first' }, { id: 'third' }, { id: 'second' },
    ])
    expect(original.map((preset) => preset.id)).toEqual(['first', 'second', 'third'])
    expect(moveInstructionPreset(original, 0, -1)).toBe(original)
  })
})
