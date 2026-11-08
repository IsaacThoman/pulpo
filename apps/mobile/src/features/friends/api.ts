import { queryOptions, type QueryClient } from '@tanstack/react-query'
import type { FriendProfileDetail, FriendSearchResponse, FriendsList, InviteCodeList, PoolSummary } from '@pulpo/contracts'
import { apiRequest } from '../../api/client'

/**
 * Query keys, scoped to the account's cache namespace. The realtime `friends` and `pool` scopes
 * refresh everything under their prefix (providers/realtimeSync.ts).
 */
export const friendsKeys = {
  all: (namespace: string) => ['friends', namespace] as const,
  list: (namespace: string) => ['friends', namespace, 'list'] as const,
  pendingCount: (namespace: string) => ['friends', namespace, 'pending-count'] as const,
  inviteCodes: (namespace: string) => ['friends', namespace, 'invite-codes'] as const,
  profile: (namespace: string, username: string) => ['friends', namespace, 'profile', username] as const,
}

export const poolKeys = {
  all: (namespace: string) => ['pool', namespace] as const,
  summary: (namespace: string) => ['pool', namespace, 'summary'] as const,
  pendingCount: (namespace: string) => ['pool', namespace, 'pending-count'] as const,
}

export function friendsListQuery(namespace: string) {
  return queryOptions({ queryKey: friendsKeys.list(namespace), queryFn: () => apiRequest<FriendsList>('/api/friends'), staleTime: 0 })
}

/** Anyone's profile by username, with how they relate to the viewer and the friends they share. */
export function friendProfileQuery(namespace: string, username: string) {
  const normalized = username.trim().toLowerCase()
  return queryOptions({
    queryKey: friendsKeys.profile(namespace, normalized),
    queryFn: () => apiRequest<FriendProfileDetail>(`/api/profiles/${encodeURIComponent(normalized)}`),
    staleTime: 0,
  })
}

export function poolQuery(namespace: string) {
  return queryOptions({ queryKey: poolKeys.summary(namespace), queryFn: () => apiRequest<PoolSummary>('/api/pools/me'), staleTime: 0 })
}

export function inviteCodesQuery(namespace: string) {
  return queryOptions({ queryKey: friendsKeys.inviteCodes(namespace), queryFn: () => apiRequest<InviteCodeList>('/api/invite-codes') })
}

/** Friend requests and Pool invitations waiting on the viewer, for the Settings entry's badge. */
export function pendingSocialCountQuery(namespace: string, pools: boolean) {
  return queryOptions({
    queryKey: [...friendsKeys.pendingCount(namespace), pools] as const,
    queryFn: async () => {
      const [friends, pool] = await Promise.all([
        apiRequest<{ count: number }>('/api/friends/pending-count'),
        pools ? apiRequest<{ count: number }>('/api/pools/pending-count') : Promise.resolve({ count: 0 }),
      ])
      return friends.count + pool.count
    },
  })
}

export function searchFriends(query: string, signal?: AbortSignal) {
  return apiRequest<FriendSearchResponse>(`/api/friends/search?q=${encodeURIComponent(query)}`, { signal })
}

/** The friends and Pool requests the Friends screen makes. */
export const friendsApi = {
  sendRequest: (userId: string) => apiRequest<{ requestId: string; status: 'pending' | 'accepted' }>('/api/friends/requests', { method: 'POST', body: { userId } }),
  acceptRequest: (requestId: string) => apiRequest(`/api/friends/requests/${requestId}/accept`, { method: 'POST' }),
  /** Declines an incoming request or cancels an outgoing one. */
  deleteRequest: (requestId: string) => apiRequest(`/api/friends/requests/${requestId}`, { method: 'DELETE' }),
  removeFriend: (userId: string) => apiRequest(`/api/friends/${userId}`, { method: 'DELETE' }),
  block: (userId: string) => apiRequest('/api/friends/blocks', { method: 'POST', body: { userId } }),
  unblock: (userId: string) => apiRequest(`/api/friends/blocks/${userId}`, { method: 'DELETE' }),
  createInviteCode: () => apiRequest('/api/invite-codes', { method: 'POST' }),
  revokeInviteCode: (id: string) => apiRequest(`/api/invite-codes/${id}`, { method: 'DELETE' }),
  // The person confirms what sharing a Pool means before either call (see FriendsScreen).
  inviteToPool: (userId: string) => apiRequest('/api/pools/invitations', { method: 'POST', body: { userId, balanceDisclosureAccepted: true } }),
  joinPool: (invitationId: string) => apiRequest(`/api/pools/invitations/${invitationId}/accept`, { method: 'POST', body: { balanceDisclosureAccepted: true } }),
  dismissPoolInvitation: (invitationId: string) => apiRequest(`/api/pools/invitations/${invitationId}/decline`, { method: 'POST' }),
  cancelPoolInvitation: (invitationId: string) => apiRequest(`/api/pools/invitations/${invitationId}`, { method: 'DELETE' }),
  makePoolOwner: (userId: string) => apiRequest('/api/pools/owner', { method: 'PATCH', body: { userId } }),
  /** Removes a member, or leaves when it is the viewer. */
  removePoolMember: (userId: string) => apiRequest(`/api/pools/members/${userId}`, { method: 'DELETE' }),
}

/** Friendships change Pool membership and shared usage, and Pools change what friends can be invited. */
export function refreshFriends(queryClient: QueryClient, namespace: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: friendsKeys.all(namespace) }),
    queryClient.invalidateQueries({ queryKey: poolKeys.all(namespace) }),
    queryClient.invalidateQueries({ queryKey: ['usage-limits', namespace] }),
  ])
}
