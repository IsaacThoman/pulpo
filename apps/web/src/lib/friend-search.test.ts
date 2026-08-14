import { describe, expect, it } from 'vitest'
import {
  friendSearchHighlight,
  nextFriendSearchIndex,
  normalizedFriendSearchQuery,
  shouldSearchFriends,
} from './friend-search'

describe('friend search UI helpers', () => {
  it('normalizes pasted usernames without removing display-name spaces', () => {
    expect(normalizedFriendSearchQuery('  @IsaacThoman ')).toBe('isaacthoman')
    expect(normalizedFriendSearchQuery(' Isaac Thomas ')).toBe('isaac thomas')
    expect(shouldSearchFriends('ab')).toBe(false)
    expect(shouldSearchFriends('@abc')).toBe(true)
  })

  it('highlights case-insensitive substring matches without changing text', () => {
    expect(friendSearchHighlight('Isaac Thomas', 'THOM')).toEqual([
      { text: 'Isaac ', match: false },
      { text: 'Thom', match: true },
      { text: 'as', match: false },
    ])
    expect(friendSearchHighlight('Isaac Thomas', 'isacc')).toEqual([{ text: 'Isaac Thomas', match: false }])
  })

  it('wraps keyboard selection through the result list', () => {
    expect(nextFriendSearchIndex(-1, 1, 3)).toBe(0)
    expect(nextFriendSearchIndex(0, -1, 3)).toBe(2)
    expect(nextFriendSearchIndex(2, 1, 3)).toBe(0)
    expect(nextFriendSearchIndex(0, 1, 0)).toBe(-1)
  })
})
