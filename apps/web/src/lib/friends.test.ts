import { describe, expect, it } from 'vitest'
import { friendRequestAge } from './friends'

describe('friend request age', () => {
  const now = Date.parse('2026-08-13T18:00:00.000Z')

  it('uses concise relative labels for recent requests', () => {
    expect(friendRequestAge('2026-08-13T10:00:00.000Z', now)).toBe('today')
    expect(friendRequestAge('2026-08-12T10:00:00.000Z', now)).toBe('yesterday')
    expect(friendRequestAge('2026-08-10T10:00:00.000Z', now)).toBe('3 days ago')
  })

  it('safely omits invalid dates', () => {
    expect(friendRequestAge('not-a-date', now)).toBe('')
  })
})
