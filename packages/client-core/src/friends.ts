import type { FriendConnection, FriendProfile, FriendsList, PoolSummary } from '@pulpo/contracts'

/** A Pool holds at most six members; pending invitations reserve a seat each. */
export const POOL_MAX_MEMBERS = 6

export function normalizedFriendSearchQuery(value: string): string {
  return value.trim().replace(/^@/, '').trim().toLowerCase()
}

export function shouldSearchFriends(value: string): boolean {
  return normalizedFriendSearchQuery(value).length >= 3
}

export interface HighlightPart {
  text: string
  match: boolean
}

export function friendSearchHighlight(value: string, query: string): HighlightPart[] {
  const needle = normalizedFriendSearchQuery(query)
  if (!needle) return [{ text: value, match: false }]
  const index = value.toLowerCase().indexOf(needle)
  if (index < 0) return [{ text: value, match: false }]
  return [
    { text: value.slice(0, index), match: false },
    { text: value.slice(index, index + needle.length), match: true },
    { text: value.slice(index + needle.length), match: false },
  ].filter((part) => part.text.length > 0)
}

export function nextFriendSearchIndex(current: number, direction: 1 | -1, count: number): number {
  if (count <= 0) return -1
  if (current < 0) return direction === 1 ? 0 : count - 1
  return (current + direction + count) % count
}

/** Why a friend search failed, as the people searching should read it. */
export function friendSearchErrorMessage(failure: { status?: number; network?: boolean }): string {
  if (failure.status === 429) return 'Too many searches. Wait a moment and try again.'
  if (failure.network) return 'You appear to be offline. Reconnect to search for friends.'
  return 'Could not search for friends. Try again.'
}

/** How long ago a friend request was made: "today", "yesterday", "3 days ago", or a short date. */
export function friendRequestAge(isoDate: string, now = Date.now(), locale?: string): string {
  const timestamp = Date.parse(isoDate)
  if (!Number.isFinite(timestamp)) return ''

  const elapsedDays = Math.max(0, Math.floor((now - timestamp) / 86_400_000))
  if (elapsedDays === 0) return 'today'
  if (elapsedDays === 1) return 'yesterday'
  if (elapsedDays < 7) return `${elapsedDays} days ago`

  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(timestamp)
}

/** What the Friends page shows and offers, derived from the friends list and the viewer's Pool. */
export interface FriendsOverview {
  /** Friends outside the viewer's Pool; Pool members are listed with the Pool instead. */
  friends: FriendConnection[]
  /** Friends the viewer's Pool has a pending invitation for. */
  invitedIds: ReadonlySet<string>
  /** Accepted friends, Pool members among them. */
  friendIds: ReadonlySet<string>
  /** Whether the viewer can invite friends to a Pool: they own one, or have none yet (inviting creates it). */
  canInvite: boolean
  /** Whether every Pool seat is taken by a member or a pending invitation. */
  poolFull: boolean
  isOwner: boolean
  /** The owner must hand the Pool to another member before leaving it. */
  mustTransfer: boolean
}

export function friendsOverview(
  list: FriendsList | undefined,
  pool: PoolSummary | undefined,
  viewerId: string,
): FriendsOverview {
  const current = pool?.pool ?? null
  const memberIds = new Set(current?.members.map((member) => member.profile.id))
  const isOwner = current?.ownerUserId === viewerId
  return {
    friends: (list?.friends ?? []).filter((friend) => !memberIds.has(friend.profile.id)),
    invitedIds: new Set(current?.pendingInvitations.map((invite) => invite.invitee.id)),
    friendIds: new Set(list?.friends.map((friend) => friend.profile.id)),
    canInvite: pool !== undefined && (!current || isOwner),
    poolFull: Boolean(current && current.members.length + current.pendingInvitations.length >= POOL_MAX_MEMBERS),
    isOwner,
    mustTransfer: Boolean(isOwner && current && current.members.length > 1),
  }
}

/** Whether the viewer may invite this friend to their Pool right now. */
export function canInviteToPool(overview: FriendsOverview, pool: PoolSummary | undefined, profile: FriendProfile): boolean {
  const current = pool?.pool ?? null
  if (!overview.canInvite || overview.poolFull || !overview.friendIds.has(profile.id)) return false
  return !current || (!current.members.some((member) => member.profile.id === profile.id)
    && !current.pendingInvitations.some((invite) => invite.invitee.id === profile.id))
}
