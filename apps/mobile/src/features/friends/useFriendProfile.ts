import { useQuery } from '@tanstack/react-query'
import type { FriendProfileDetail } from '@pulpo/contracts'
import { ApiError } from '../../api/client'
import { friendProfileQuery, friendsApi } from './api'
import { friendsSinceLabel } from './format'
import { useFriendActions, useFriendsContext } from './hooks'

/** The one thing the viewer can do about someone from their profile, if anything. */
export type FriendProfileAction =
  | { kind: 'add' | 'accept' | 'cancel'; label: string; pendingLabel: string; pending: boolean; onPress: () => void }
  | { kind: 'friends'; label: string }
  | { kind: 'self'; label: string }

/** Someone's profile by username, as the web's `/:username` page shows it. */
export function useFriendProfile(username: string) {
  const { namespace } = useFriendsContext()
  const query = useQuery({ ...friendProfileQuery(namespace, username), enabled: Boolean(namespace && username.trim()) })
  // A 404 means the account is gone or blocked the viewer since it loaded; drop the cached copy.
  const gone = query.error instanceof ApiError && query.error.status === 404
  const detail = gone ? undefined : query.data
  const { run, pending } = useFriendActions(namespace)

  const action = (profile: FriendProfileDetail): FriendProfileAction => {
    const { relationship, requestId } = profile
    const target = profile.profile
    if (relationship === 'self') return { kind: 'self', label: 'This is you' }
    if (relationship === 'friends') return { kind: 'friends', label: 'Friends' }
    if (relationship === 'incoming' && requestId) {
      const key = `accept:${requestId}`
      return { kind: 'accept', label: 'Accept Request', pendingLabel: 'Accepting…', pending: pending.has(key), onPress: () => void run(key, () => friendsApi.acceptRequest(requestId)) }
    }
    if (relationship === 'outgoing' && requestId) {
      const key = `cancel:${requestId}`
      return { kind: 'cancel', label: 'Cancel Request', pendingLabel: 'Canceling…', pending: pending.has(key), onPress: () => void run(key, () => friendsApi.deleteRequest(requestId)) }
    }
    const key = `request:${target.id}`
    return { kind: 'add', label: 'Add Friend', pendingLabel: 'Sending…', pending: pending.has(key), onPress: () => void run(key, () => friendsApi.sendRequest(target.id)) }
  }

  return {
    query,
    detail,
    action: detail ? action(detail) : null,
    friendsSince: detail?.relationship === 'friends' && detail.friendsSince ? friendsSinceLabel(detail.friendsSince) : undefined,
    showMutualFriends: Boolean(detail && detail.relationship !== 'self'),
  }
}

export type FriendProfileModel = ReturnType<typeof useFriendProfile>
