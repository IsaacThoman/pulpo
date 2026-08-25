import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { FriendConnection, FriendsList, PoolInvitation, PoolMember, PoolSummary } from '@pulpo/contracts'
import { Crown, LoaderCircle, MoreHorizontal, UserRoundPlus, UsersRound } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { formatBalance } from '@/lib/format'
import { queryClient } from '@/lib/query-client'
import { useAuth } from '@/stores/auth'
import { FriendsTabs } from '@/components/FriendsTabs'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ui, uit } from '@/i18n/ui'

export function PoolPage() {
  const user = useAuth((state) => state.user)
  const [inviteTarget, setInviteTarget] = useState<FriendConnection | null>(null)
  const [joinTarget, setJoinTarget] = useState<PoolInvitation | null>(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const poolQuery = useQuery({ queryKey: ['pool', user?.id], queryFn: () => apiRequest<PoolSummary>('/api/pools/me'), enabled: Boolean(user?.id), staleTime: 0, refetchOnWindowFocus: 'always' })
  const friendsQuery = useQuery({ queryKey: ['friends', user?.id], queryFn: () => apiRequest<FriendsList>('/api/friends'), enabled: Boolean(user?.id) })
  const pool = poolQuery.data?.pool
  const isOwner = pool?.ownerUserId === user?.id
  const unavailable = new Set([...(pool?.members.map((member) => member.profile.id) ?? []), ...(pool?.pendingInvitations.map((invite) => invite.invitee.id) ?? [])])
  const eligible = (friendsQuery.data?.friends ?? []).filter((friend) => !unavailable.has(friend.profile.id))

  const act = async (key: string, operation: () => Promise<unknown>, success: string) => {
    setBusy(key); setMessage('')
    try {
      await operation(); setMessage(success)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['pool'] }), queryClient.invalidateQueries({ queryKey: ['pool-pending-count'] }), queryClient.invalidateQueries({ queryKey: ['usage'] }), queryClient.invalidateQueries({ queryKey: ['billing'] })])
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update the Pool') }
    finally { setBusy('') }
  }

  const invite = () => {
    if (!inviteTarget) return
    const target = inviteTarget
    setInviteTarget(null)
    void act(`invite:${target.profile.id}`, () => apiRequest('/api/pools/invitations', { method: 'POST', body: { userId: target.profile.id, balanceDisclosureAccepted: true } }), `Invitation sent to ${target.profile.displayName}.`)
  }
  const join = () => {
    if (!joinTarget) return
    const target = joinTarget
    setJoinTarget(null)
    void act(`join:${target.id}`, () => apiRequest(`/api/pools/invitations/${target.id}/accept`, { method: 'POST', body: { balanceDisclosureAccepted: true } }), 'You joined the Pool.')
  }

  return <div className="flex h-full flex-col">
    <FriendsTabs />
    <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-3xl space-y-5 px-5 py-6">
      <div><h2 className="text-lg font-medium">{ui("Your Pool")}</h2><p className="mt-1 text-sm text-muted-foreground">{ui("Share credits with up to six friends while keeping each contribution separate.")}</p></div>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      {poolQuery.isLoading ? <div className="rounded-xl border py-16 text-center text-sm text-muted-foreground"><LoaderCircle className="mx-auto mb-2 size-5 animate-spin" />{ui("Loading Pool…")}</div>
        : poolQuery.error ? <div className="rounded-xl border p-8 text-center text-sm text-destructive">{poolQuery.error.message}</div>
          : pool ? <>
            <section className="rounded-xl border p-5"><div className="text-xs text-muted-foreground">{ui("Pool balance")}</div><div className="mt-1 text-3xl font-semibold text-emerald-600 dark:text-emerald-400">{formatBalance(pool.pooledBalanceMicros / 1_000_000)}</div><div className="mt-2 text-xs text-muted-foreground">{pool.members.length} {ui("of 6 members ·")} {pool.pendingInvitations.length} {ui("pending")}</div></section>
            <section className="overflow-hidden rounded-xl border"><div className="flex items-center justify-between border-b px-4 py-3"><h3 className="text-sm font-medium">{ui("Contributions")}</h3><span className="text-xs text-muted-foreground">{pool.members.length}</span></div><div className="divide-y">{pool.members.map((member) => <MemberRow key={member.profile.id} member={member} currentUserId={user!.id} isOwner={isOwner} busy={busy} onTransfer={() => void act(`owner:${member.profile.id}`, () => apiRequest('/api/pools/owner', { method: 'PATCH', body: { userId: member.profile.id } }), `${member.profile.displayName} is now the Pool owner.`)} onRemove={() => { if (confirm(`Remove ${member.profile.displayName} from the Pool? Existing reserved charges may still settle against their account.`)) void act(`remove:${member.profile.id}`, () => apiRequest(`/api/pools/members/${member.profile.id}`, { method: 'DELETE' }), `${member.profile.displayName} left the Pool.`) }} />)}</div></section>
            {isOwner && <section className="overflow-hidden rounded-xl border"><div className="border-b px-4 py-3"><h3 className="text-sm font-medium">{ui("Invite friends")}</h3><p className="mt-0.5 text-xs text-muted-foreground">{ui("Pending invitations reserve a Pool seat.")}</p></div>{eligible.length ? <div className="divide-y">{eligible.map((friend) => <div key={friend.profile.id} className="flex items-center justify-between gap-3 px-4 py-3"><Identity name={friend.profile.displayName} username={friend.profile.username} avatarUrl={friend.profile.avatarUrl} /><Button size="sm" disabled={Boolean(busy) || pool.members.length + pool.pendingInvitations.length >= 6} onClick={() => setInviteTarget(friend)}><UserRoundPlus />{ui("Invite")}</Button></div>)}</div> : <div className="px-4 py-7 text-center text-sm text-muted-foreground">{ui("No eligible friends to invite.")}</div>}</section>}
            {isOwner && pool.pendingInvitations.length > 0 && <section className="overflow-hidden rounded-xl border"><div className="border-b px-4 py-3 text-sm font-medium">{ui("Pending invitations")}</div><div className="divide-y">{pool.pendingInvitations.map((invite) => <div key={invite.id} className="flex items-center justify-between px-4 py-3"><Identity name={invite.invitee.displayName} username={invite.invitee.username} avatarUrl={invite.invitee.avatarUrl} /><Button size="sm" variant="ghost" onClick={() => void act(`cancel:${invite.id}`, () => apiRequest(`/api/pools/invitations/${invite.id}`, { method: 'DELETE' }), 'Invitation canceled.')}>{ui("Cancel")}</Button></div>)}</div></section>}
            <Button variant="outline" disabled={Boolean(busy)} onClick={() => { if (confirm(isOwner && pool.members.length > 1 ? 'Transfer ownership before leaving this Pool.' : 'Leave this Pool? Existing reserved charges may still settle against your account.')) void act('leave', () => apiRequest(`/api/pools/members/${user!.id}`, { method: 'DELETE' }), 'You left the Pool.') }}>{ui("Leave Pool")}</Button>
            {(poolQuery.data?.incomingInvitations.length ?? 0) > 0 && <section className="overflow-hidden rounded-xl border"><div className="border-b px-4 py-3"><h3 className="text-sm font-medium">{ui("Pool invitations")}</h3><p className="mt-0.5 text-xs text-muted-foreground">{ui("Leave your current Pool before joining another.")}</p></div><div className="divide-y">{poolQuery.data!.incomingInvitations.map((invite) => <div key={invite.id} className="flex items-center justify-between gap-3 px-4 py-3"><div><Identity name={invite.inviter.displayName} username={invite.inviter.username} avatarUrl={invite.inviter.avatarUrl} /><p className="ml-13 mt-1 text-xs text-muted-foreground">{invite.memberCount} {ui("member")}{invite.memberCount === 1 ? '' : ui("s")}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void act(`decline:${invite.id}`, () => apiRequest(`/api/pools/invitations/${invite.id}/decline`, { method: 'POST' }), 'Invitation dismissed.')}>{ui("Dismiss")}</Button><Button size="sm" disabled title={ui("Leave your current Pool before joining")}>{ui("Join")}</Button></div></div>)}</div></section>}
          </> : <>
            {(poolQuery.data?.incomingInvitations.length ?? 0) > 0 && <section className="overflow-hidden rounded-xl border"><div className="border-b px-4 py-3 text-sm font-medium">{ui("Pool invitations")}</div><div className="divide-y">{poolQuery.data!.incomingInvitations.map((invite) => <div key={invite.id} className="flex items-center justify-between gap-3 px-4 py-3"><div><Identity name={invite.inviter.displayName} username={invite.inviter.username} avatarUrl={invite.inviter.avatarUrl} /><p className="ml-13 mt-1 text-xs text-muted-foreground">{invite.memberCount} {ui("member")}{invite.memberCount === 1 ? '' : ui("s")}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void act(`decline:${invite.id}`, () => apiRequest(`/api/pools/invitations/${invite.id}/decline`, { method: 'POST' }), 'Invitation dismissed.')}>{ui("Dismiss")}</Button><Button size="sm" onClick={() => setJoinTarget(invite)}>{ui("Join")}</Button></div></div>)}</div></section>}
            <div className="rounded-xl border px-6 py-10 text-center"><UsersRound className="mx-auto size-6 text-muted-foreground" /><h3 className="mt-3 text-sm font-medium">{ui("Start a Pool")}</h3><p className="mt-1 text-xs text-muted-foreground">{ui("Invite a friend below. Your Pool is created when the invitation is sent.")}</p></div>
            <section className="overflow-hidden rounded-xl border"><div className="border-b px-4 py-3 text-sm font-medium">{ui("Invite a friend")}</div>{eligible.length ? <div className="divide-y">{eligible.map((friend) => <div key={friend.profile.id} className="flex items-center justify-between px-4 py-3"><Identity name={friend.profile.displayName} username={friend.profile.username} avatarUrl={friend.profile.avatarUrl} /><Button size="sm" onClick={() => setInviteTarget(friend)}><UserRoundPlus />{ui("Invite")}</Button></div>)}</div> : <div className="p-7 text-center text-sm text-muted-foreground">{ui("Add a friend first to create a Pool.")}</div>}</section>
          </>}
    </div></div>
    <Dialog open={Boolean(inviteTarget)} onOpenChange={(open) => { if (!open) setInviteTarget(null) }}><DialogContent><DialogHeader><DialogTitle>{ui("Share your balance?")}</DialogTitle><DialogDescription>{ui("Inviting")} {inviteTarget?.profile.displayName} {ui("makes your current balance available for every Pool member to view and spend.")}</DialogDescription></DialogHeader><div className="rounded-lg bg-muted/50 p-4"><div className="text-xs text-muted-foreground">{ui("Your current account balance")}</div><div className="mt-1 text-2xl font-semibold">{formatBalance((poolQuery.data?.accountBalanceMicros ?? user?.balanceMicros ?? 0) / 1_000_000)}</div></div><DialogFooter><Button variant="outline" onClick={() => setInviteTarget(null)}>{ui("Cancel")}</Button><Button onClick={invite}>{ui("Invite and share")}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(joinTarget)} onOpenChange={(open) => { if (!open) setJoinTarget(null) }}><DialogContent><DialogHeader><DialogTitle>{ui("Join this Pool?")}</DialogTitle><DialogDescription>{ui("Your current balance will become visible and spendable by all Pool members. Existing reserved charges can still settle after you leave.")}</DialogDescription></DialogHeader><div className="rounded-lg bg-muted/50 p-4"><div className="text-xs text-muted-foreground">{ui("Balance you will contribute")}</div><div className="mt-1 text-2xl font-semibold">{formatBalance((poolQuery.data?.accountBalanceMicros ?? user?.balanceMicros ?? 0) / 1_000_000)}</div></div><DialogFooter><Button variant="outline" onClick={() => setJoinTarget(null)}>{ui("Cancel")}</Button><Button onClick={join}>{ui("Join and share")}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}

function Identity({ name, username, avatarUrl }: { name: string; username: string; avatarUrl: string | null }) { return <div className="flex min-w-0 items-center gap-3"><ProfileAvatar name={name} avatarUrl={avatarUrl} className="size-10" fallbackClassName="text-xs" /><div className="min-w-0"><div className="truncate text-sm font-medium">{name}</div><div className="truncate text-xs text-muted-foreground">@{username}</div></div></div> }

function MemberRow({ member, currentUserId, isOwner, busy, onTransfer, onRemove }: { member: PoolMember; currentUserId: string; isOwner: boolean; busy: string; onTransfer: () => void; onRemove: () => void }) {
  return <div className="flex items-center justify-between gap-3 px-4 py-3"><div className="flex min-w-0 items-center gap-3"><ProfileAvatar name={member.profile.displayName} avatarUrl={member.profile.avatarUrl} className="size-10" fallbackClassName="text-xs" /><div className="min-w-0"><div className="flex items-center gap-1.5 truncate text-sm font-medium">{member.profile.displayName}{member.owner && <Crown className="size-3.5 text-amber-500" aria-label={ui("Pool owner")} />}</div><div className="text-xs text-muted-foreground">@{member.profile.username}{member.profile.id === currentUserId ? ui(" · You") : ''}</div></div></div><div className="flex items-center gap-2"><div className="text-right"><div className="text-sm font-medium tabular-nums">{formatBalance(member.contributionBalanceMicros / 1_000_000)}</div>{member.reservedMicros > 0 && <div className="text-xs text-muted-foreground">{formatBalance(member.reservedMicros / 1_000_000)} {ui("reserved")}</div>}</div>{isOwner && member.profile.id !== currentUserId && <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" disabled={Boolean(busy)} aria-label={uit`Manage ${member.profile.displayName}`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={onTransfer}>{ui("Make owner")}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={onRemove}>{ui("Remove from Pool")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</div></div>
}
