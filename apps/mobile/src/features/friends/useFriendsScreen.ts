import { useEffect, useRef, useState } from 'react'
import { Alert } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useQuery } from '@tanstack/react-query'
import { canInviteToPool, friendRequestAge, friendsOverview } from '@pulpo/client-core'
import type { FriendConnection, FriendProfile, FriendSearchResult, FriendSuggestion, PoolInvitation, PoolMember } from '@pulpo/contracts'
import { friendsApi, friendsListQuery, inviteCodesQuery, poolQuery } from './api'
import { mutualFriendsLabel, poolDisclosure } from './format'
import { useFriendActions, useFriendSearch, useFriendsContext } from './hooks'

/** One entry in a person's actions menu: a SwiftUI menu on iOS, a Material menu on Android. */
export interface FriendMenuAction {
  label: string
  icon: string
  onPress: () => void
  destructive?: boolean
  disabled?: boolean
  /** Starts a new group, as the web's menus separate Pool actions from friend actions. */
  separated?: boolean
}

const COPIED_MS = 1_500

/** Everything the Friends screen shows and does, shared by its iOS and Android layouts. */
export function useFriendsScreen({ openProfile }: { openProfile: (profile: FriendProfile) => void }) {
  const { namespace, user, poolsEnabled, inviteCodesEnabled } = useFriendsContext()
  const viewerId = user?.id ?? ''
  const list = useQuery({ ...friendsListQuery(namespace), enabled: Boolean(namespace) })
  const pool = useQuery({ ...poolQuery(namespace), enabled: Boolean(namespace) && poolsEnabled })
  const inviteCodes = useQuery({ ...inviteCodesQuery(namespace), enabled: Boolean(namespace) && inviteCodesEnabled })
  const poolSummary = poolsEnabled ? pool.data : undefined
  const overview = friendsOverview(list.data, poolSummary, viewerId)
  const [searchInput, setSearchInput] = useState('')
  const search = useFriendSearch(searchInput, list.dataUpdatedAt)
  const { run, pending, busy } = useFriendActions(namespace)
  const [copied, setCopied] = useState<string | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  const copy = (key: string, value: string) => {
    void Clipboard.setStringAsync(value).then(() => {
      setCopied(key)
      clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(null), COPIED_MS)
    })
  }

  const confirm = (title: string, message: string | undefined, label: string, onConfirm: () => void, destructive = true) => {
    Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: label, style: destructive ? 'destructive' : 'default', onPress: onConfirm }])
  }

  const actions = {
    sendRequest: (result: FriendSearchResult) => void run(`request:${result.profile.id}`, () => friendsApi.sendRequest(result.profile.id), (response) => {
      search.update(result.profile.id, { relationship: response.status === 'accepted' ? 'friends' : 'outgoing', requestId: response.requestId })
    }),
    // The list refresh after sending drops them from suggestions; they show under Sent requests.
    sendSuggestion: (suggestion: FriendSuggestion) => void run(`request:${suggestion.profile.id}`, () => friendsApi.sendRequest(suggestion.profile.id)),
    dismissSuggestion: (suggestion: FriendSuggestion) => void run(`dismiss:${suggestion.profile.id}`, () => friendsApi.dismissSuggestion(suggestion.profile.id)),
    acceptSearchResult: (result: FriendSearchResult) => {
      const requestId = result.requestId
      if (!requestId) return
      void run(`accept:${requestId}`, () => friendsApi.acceptRequest(requestId), () => search.update(result.profile.id, { relationship: 'friends' }))
    },
    accept: (connection: FriendConnection) => void run(`accept:${connection.requestId}`, () => friendsApi.acceptRequest(connection.requestId)),
    decline: (connection: FriendConnection) => void run(`decline:${connection.requestId}`, () => friendsApi.deleteRequest(connection.requestId)),
    cancelRequest: (connection: FriendConnection) => void run(`cancel:${connection.requestId}`, () => friendsApi.deleteRequest(connection.requestId)),
    removeFriend: (profile: FriendProfile) => confirm(`Remove ${profile.displayName} from your friends?`, undefined, 'Remove', () => {
      void run(`unfriend:${profile.id}`, () => friendsApi.removeFriend(profile.id))
    }),
    block: (profile: FriendProfile) => confirm(`Block ${profile.displayName}?`, 'Any friendship or pending request will be removed.', 'Block', () => {
      void run(`block:${profile.id}`, () => friendsApi.block(profile.id), () => search.remove(profile.id))
    }),
    unblock: (profile: FriendProfile) => void run(`unblock:${profile.id}`, () => friendsApi.unblock(profile.id)),
    inviteToPool: (profile: FriendProfile) => {
      const disclosure = poolDisclosure.invite(profile.displayName)
      confirm(disclosure.title, disclosure.message, disclosure.confirm, () => {
        // The Pool may have changed while the confirmation was open.
        if (!canInviteToPool(overview, poolSummary, profile)) return
        void run(`invite:${profile.id}`, () => friendsApi.inviteToPool(profile.id))
      }, false)
    },
    joinPool: (invitation: PoolInvitation) => confirm(poolDisclosure.join.title, poolDisclosure.join.message, poolDisclosure.join.confirm, () => {
      void run(`join:${invitation.id}`, () => friendsApi.joinPool(invitation.id))
    }, false),
    dismissPoolInvitation: (invitation: PoolInvitation) => void run(`decline-pool:${invitation.id}`, () => friendsApi.dismissPoolInvitation(invitation.id)),
    cancelPoolInvitation: (invitation: PoolInvitation) => void run(`cancel-pool:${invitation.id}`, () => friendsApi.cancelPoolInvitation(invitation.id)),
    makeOwner: (member: PoolMember) => confirm(`Make ${member.profile.displayName} the Pool owner?`, 'Only the owner can invite and remove members.', 'Make Owner', () => {
      void run(`owner:${member.profile.id}`, () => friendsApi.makePoolOwner(member.profile.id))
    }, false),
    removeMember: (member: PoolMember) => confirm(`Remove ${member.profile.displayName} from the Pool?`, 'Usage already in progress may still count against their account.', 'Remove', () => {
      void run(`remove-pool:${member.profile.id}`, () => friendsApi.removePoolMember(member.profile.id))
    }),
    leavePool: () => confirm('Leave this Pool?', 'Usage already in progress may still count against your account.', 'Leave', () => {
      void run('leave-pool', () => friendsApi.removePoolMember(viewerId))
    }),
    generateInviteCode: () => void run('invite-code:new', () => friendsApi.createInviteCode()),
    revokeInviteCode: (id: string) => void run(`invite-code:${id}`, () => friendsApi.revokeInviteCode(id)),
    copyHandle: () => { if (user) copy('handle', user.username) },
    copyInviteCode: (id: string, code: string) => copy(id, code),
  }

  const friendMenu = (profile: FriendProfile): FriendMenuAction[] => [
    { label: 'Remove Friend', icon: 'person.badge.minus', onPress: () => actions.removeFriend(profile), disabled: busy },
    { label: 'Block', icon: 'hand.raised', onPress: () => actions.block(profile), destructive: true, disabled: busy },
  ]

  /** Inviting is offered to friends outside the Pool when the viewer owns it or has none yet. */
  const friendRowMenu = (profile: FriendProfile): FriendMenuAction[] => [
    ...(overview.canInvite && !overview.invitedIds.has(profile.id)
      ? [{ label: overview.poolFull ? 'Pool Full' : 'Invite to Pool', icon: 'person.2.badge.plus', onPress: () => actions.inviteToPool(profile), disabled: overview.poolFull || busy }]
      : []),
    ...friendMenu(profile),
  ]

  const memberMenu = (member: PoolMember): FriendMenuAction[] => [
    ...(overview.isOwner ? [
      { label: 'Make Owner', icon: 'crown', onPress: () => actions.makeOwner(member), disabled: busy },
      { label: 'Remove from Pool', icon: 'person.crop.circle.badge.minus', onPress: () => actions.removeMember(member), destructive: true, disabled: busy },
    ] : []),
    ...(overview.friendIds.has(member.profile.id)
      ? friendMenu(member.profile).map((action, index) => index === 0 && overview.isOwner ? { ...action, separated: true } : action)
      : []),
  ]

  const requestMenu = (connection: FriendConnection): FriendMenuAction[] => [
    { label: 'Decline Request', icon: 'xmark', onPress: () => actions.decline(connection), disabled: pending.has(`decline:${connection.requestId}`) },
    { label: 'Block', icon: 'hand.raised', onPress: () => actions.block(connection.profile), destructive: true, disabled: busy, separated: true },
  ]

  const poolInvitationMenu = (invitation: PoolInvitation): FriendMenuAction[] => [
    { label: 'Dismiss Invitation', icon: 'xmark', onPress: () => actions.dismissPoolInvitation(invitation), disabled: busy },
  ]

  const codes = inviteCodes.data
  const showInviteCodes = inviteCodesEnabled && Boolean(codes && (codes.quota > 0 || codes.codes.length > 0))

  return {
    user,
    list,
    pool,
    poolsEnabled,
    currentPool: poolSummary?.pool ?? null,
    poolInvitations: poolSummary?.incomingInvitations ?? [],
    overview,
    inviteCodes: showInviteCodes ? codes ?? null : null,
    inviteCodesRemaining: codes ? Math.max(0, codes.quota - codes.used) : 0,
    searchInput,
    setSearchInput,
    search,
    pending,
    busy,
    copied,
    actions,
    friendRowMenu,
    memberMenu,
    requestMenu,
    poolInvitationMenu,
    suggestions: list.data?.suggestions ?? [],
    openProfile,
    /** "Requested today · 2 mutuals": when a request was made, then the friends shared. */
    requestDetail: (verb: 'Requested' | 'Sent', connection: FriendConnection) => [
      `${verb} ${friendRequestAge(connection.requestedAt)}`,
      mutualFriendsLabel(connection.mutualFriends?.length ?? 0),
    ].filter(Boolean).join(' · '),
  }
}

export type FriendsScreenModel = ReturnType<typeof useFriendsScreen>
