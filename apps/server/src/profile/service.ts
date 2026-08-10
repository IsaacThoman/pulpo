import type { FriendProfile } from '@pulpo/contracts'
import { users } from '../database/schema.js'

export type ProfileRow = Pick<typeof users.$inferSelect, 'id' | 'name' | 'username' | 'avatarObjectKey' | 'avatarVersion' | 'profileColor'>

export function profileAvatarUrl(row: Pick<ProfileRow, 'id' | 'avatarObjectKey' | 'avatarVersion'>): string | null {
  return row.avatarObjectKey ? `/api/users/${row.id}/avatar?v=${row.avatarVersion}` : null
}

export function publicFriendProfile(row: ProfileRow): FriendProfile {
  return {
    id: row.id,
    displayName: row.name,
    username: row.username,
    avatarUrl: profileAvatarUrl(row),
    profileColor: row.profileColor,
  }
}
