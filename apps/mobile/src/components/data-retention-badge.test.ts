import { describe, expect, it } from 'vitest'
import { lucideComponentName } from './data-retention-badge'

describe('data retention badge', () => {
  it('maps Lucide icon names to lucide-react-native component names', () => {
    expect(lucideComponentName('shield')).toBe('Shield')
    expect(lucideComponentName('shield-question-mark')).toBe('ShieldQuestionMark')
    expect(lucideComponentName('arrow-down-0-1')).toBe('ArrowDown01')
  })
})
