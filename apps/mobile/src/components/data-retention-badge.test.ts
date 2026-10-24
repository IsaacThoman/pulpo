import { describe, expect, it } from 'vitest'
import { dataRetentionBadgeColors, lucideComponentName } from './data-retention-badge'

describe('data retention badge', () => {
  it('maps Lucide icon names to lucide-react-native component names', () => {
    expect(lucideComponentName('shield')).toBe('Shield')
    expect(lucideComponentName('shield-question-mark')).toBe('ShieldQuestionMark')
    expect(lucideComponentName('arrow-down-0-1')).toBe('ArrowDown01')
  })

  it('tints the tag color for the badge fill and border', () => {
    expect(dataRetentionBadgeColors('#8b5cf6')).toEqual({ backgroundColor: '#8b5cf61f', borderColor: '#8b5cf64d' })
  })
})
