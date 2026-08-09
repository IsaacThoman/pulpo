import { describe, expect, it } from 'vitest'
import { resolvePresetIconName } from './preset-icon-options'

describe('resolvePresetIconName', () => {
  it('preserves canonical names and falls back for stale values', () => {
    expect(resolvePresetIconName('camera')).toBe('camera')
    expect(resolvePresetIconName('not-a-lucide-icon')).toBe('circle')
    expect(resolvePresetIconName(undefined)).toBe('circle')
  })
})
