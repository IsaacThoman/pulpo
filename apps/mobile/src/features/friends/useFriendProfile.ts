import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { FriendProfile, FriendProfileDetail, UsageVisibility } from '@pulpo/contracts'
import { ApiError } from '../../api/client'
import { usageVisibilityOf } from '../profile/profileDraft'
import { usageKeys } from '../usage/api'
import { USAGE_VISIBILITY_ICONS, joinedLabel, usageVisibilitySummary } from '../usage/format'
import { usePersonUsage } from '../usage/hooks'
import { friendProfileQuery, friendsApi } from './api'
import { friendsSinceLabel } from './format'
import { useFriendActions, useFriendsContext } from './hooks'

/** The one thing the viewer can do about someone from their profile, if anything. */
export type FriendProfileAction =
  | { kind: 'add' | 'accept' | 'cancel'; label: string; pendingLabel: string; pending: boolean; onPress: () => void }
  | { kind: 'friends'; label: string }

/** Who can see a profile's usage, as an icon and a line beside it. */
export interface ProfileUsageVisibility {
  level: UsageVisibility
  icon: string
  label: string
}

/**
 * Someone's profile by username, as the web's `/:username` page shows it: who they are, how they
 * relate to the viewer, and their usage when they share it. The viewer's own profile comes from
 * their session and shows all of their usage.
 */
export function useFriendProfile(username: string) {
  const { namespace, user, poolsEnabled } = useFriendsContext()
  const queryClient = useQueryClient()
  const normalized = username.trim().toLowerCase()
  // Decided once: renaming yourself from this screen must not turn it into a stranger's profile.
  const [own] = useState(() => Boolean(user) && normalized === user!.username.toLowerCase())
  const query = useQuery({ ...friendProfileQuery(namespace, username), enabled: Boolean(namespace && normalized) && !own })
  // A 404 means the account is gone or blocked the viewer since it loaded; drop the cached copy.
  const gone = query.error instanceof ApiError && query.error.status === 404
  const detail = own || gone ? undefined : query.data
  const self = own || detail?.relationship === 'self'
  const { run, pending } = useFriendActions(namespace)

  // A profile cached before usage visibility existed has no flag: show neither the usage nor the
  // notice until the fresh profile says which applies.
  const shared = self ? true : detail?.usageVisible
  const usage = usePersonUsage({ namespace, username: self ? null : normalized, enabled: shared === true })
  const usageShown = shared === true && !usage.usagePrivate
  // Decided by the profile alone. A refused usage request reloads the profile (usePersonUsage);
  // dropping the cache on the refusal itself would send the request again, and again.
  const usageHidden = !self && (gone || shared === false)

  // Usage someone stopped sharing must not wait in the cache for the next visit.
  useEffect(() => {
    if (usageHidden && namespace) queryClient.removeQueries({ queryKey: usageKeys.profile(namespace, normalized) })
  }, [namespace, normalized, queryClient, usageHidden])

  const action = (profile: FriendProfileDetail): FriendProfileAction | null => {
    const { relationship, requestId } = profile
    const target = profile.profile
    if (relationship === 'self') return null
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

  const identity: FriendProfile | undefined = own && user
    ? { id: user.id, displayName: user.name, username: user.username, avatarUrl: user.avatarUrl, profileColor: user.profileColor }
    : detail?.profile
  const level = own ? usageVisibilityOf(user) : detail?.usageVisibility
  const visibility: ProfileUsageVisibility | undefined = level
    ? { level, icon: USAGE_VISIBILITY_ICONS[level], label: usageVisibilitySummary(level, self) }
    : undefined
  const { refetch: refetchProfile } = query
  const { refetch: refetchUsage } = usage

  return {
    query,
    /** The viewer's own profile. */
    self,
    identity,
    detail,
    action: detail ? action(detail) : null,
    email: own ? user?.email : undefined,
    joined: joinedLabel(own ? user?.createdAt : detail?.joinedAt),
    friendsSince: detail?.relationship === 'friends' && detail.friendsSince ? friendsSinceLabel(detail.friendsSince) : undefined,
    visibility,
    usage,
    /** Usage is shared with the viewer and can be shown. */
    usageShown,
    /** The owner has not shared their usage with the viewer. */
    usagePrivate: !self && Boolean(detail) && (shared === false || usage.usagePrivate),
    /** The leaderboard ranks friends, so it can only compare someone who is one. */
    canCompare: !self && usageShown && detail?.relationship === 'friends',
    /** Plan usage limits exist only where the instance bills usage. */
    showLimits: self && poolsEnabled,
    mutualFriends: detail && !self ? detail.mutualFriends : undefined,
    refresh: () => Promise.all([own ? Promise.resolve() : refetchProfile(), shared === true ? refetchUsage() : Promise.resolve()]),
  }
}

export type FriendProfileModel = ReturnType<typeof useFriendProfile>
