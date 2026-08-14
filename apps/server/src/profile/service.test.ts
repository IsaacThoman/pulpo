import { describe, expect, it } from 'vitest'
import { profileAvatarUrl, publicFriendProfile } from './service.js'

describe('public friend profiles', () => {
  const profile = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Isaac',
    username: 'isaac',
    avatarObjectKey: 'private/object/key',
    avatarVersion: 4,
    profileColor: '#10b981',
  }

  it('exposes a versioned application URL without leaking the object key', () => {
    expect(profileAvatarUrl(profile)).toBe('/api/users/11111111-1111-4111-8111-111111111111/avatar?v=4')
    expect(publicFriendProfile(profile)).toEqual({
      id: profile.id,
      displayName: 'Isaac',
      username: 'isaac',
      avatarUrl: '/api/users/11111111-1111-4111-8111-111111111111/avatar?v=4',
      profileColor: '#10b981',
    })
  })
})
