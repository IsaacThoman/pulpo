import { describe, expect, it } from 'vitest'
import { isPeoplePath, profileOrigin, profilePathUsername } from './profile'

describe('People paths', () => {
  it.each(['/friends', '/friends/leaderboard', '/octo', '/jordan', '/Jordan', '/jordan/'])('counts %s', (path) => {
    expect(isPeoplePath(path)).toBe(true)
  })

  it.each(['/', '/files', '/Files', '/api-keys', '/billing', '/usage', '/admin', '/admin/users', '/c/chat-1', '/files/trash', '/share/token'])("doesn't count %s", (path) => {
    expect(isPeoplePath(path)).toBe(false)
  })

  it('reads the username from a profile path, never from a reserved route', () => {
    expect(profilePathUsername('/Jordan')).toBe('Jordan')
    expect(profilePathUsername('/API-KEYS')).toBeUndefined()
    expect(profilePathUsername('/jordan/usage')).toBeUndefined()
  })
})

describe('profile origins', () => {
  it.each(['/friends', '/friends/leaderboard', '/friends/leaderboard?scope=pool'])('keeps %s', (origin) => {
    expect(profileOrigin({ peopleOrigin: origin })).toBe(origin)
  })

  it.each([
    undefined, null, 'friends', 42, {}, { peopleOrigin: 7 },
    { peopleOrigin: '/billing' }, { peopleOrigin: '/friends/pool' }, { peopleOrigin: '/friendsx' },
    { peopleOrigin: 'https://example.com/friends' }, { peopleOrigin: '//example.com/friends' }, { peopleOrigin: '/friends#top' },
  ])('falls back to Friends for %j', (state) => {
    expect(profileOrigin(state)).toBe('/friends')
  })
})
