import { useRef, useState, type ReactNode, type RefObject } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import type { FriendConnection, FriendProfile, PoolInvitation, PoolSummary } from '@pulpo/contracts'
import { Crown, MoreHorizontal } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { formatBalance } from '@/lib/format'
import { ProfileIdentity } from '@/components/FriendIdentity'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ui, uit } from '@/i18n/ui'

type Props = {
  query: UseQueryResult<PoolSummary, Error>
  currentUserId: string
  friends: FriendConnection[]
  busy: boolean
  act: (key: string, operation: () => Promise<unknown>, success: string) => Promise<void>
  inviteTarget: FriendProfile | null
  inviteTriggerRef: RefObject<HTMLButtonElement | null>
  onInviteClose: () => void
  friendActions: (profile: FriendProfile) => ReactNode
}

export function PoolSection({ query, currentUserId, friends, busy, act, inviteTarget, inviteTriggerRef, onInviteClose, friendActions }: Props) {
  const [joinTarget, setJoinTarget] = useState<PoolInvitation | null>(null)
  const joinTriggerRef = useRef<HTMLButtonElement | null>(null)
  const sectionRef = useRef<HTMLElement | null>(null)
  const restoreFocus = (target: HTMLButtonElement | null) => {
    if (target?.isConnected && !target.disabled) target.focus()
    else sectionRef.current?.focus()
  }
  const pool = query.data?.pool
  const isOwner = pool?.ownerUserId === currentUserId
  const mustTransfer = Boolean(isOwner && pool && pool.members.length > 1)
  const friendIds = new Set(friends.map((friend) => friend.profile.id))
  const incoming = query.data?.incomingInvitations ?? []
  const inviteUnavailable = !query.isSuccess || busy || Boolean(pool && (
    !isOwner || pool.members.length + pool.pendingInvitations.length >= 6
    || pool.members.some((member) => member.profile.id === inviteTarget?.id)
    || pool.pendingInvitations.some((invite) => invite.invitee.id === inviteTarget?.id)
  )) || !friendIds.has(inviteTarget?.id ?? '')

  const invite = () => {
    if (!inviteTarget || inviteUnavailable) return
    const target = inviteTarget
    onInviteClose()
    void act(`invite:${target.id}`, () => apiRequest('/api/pools/invitations', {
      method: 'POST', body: { userId: target.id, balanceDisclosureAccepted: true },
    }), uit`Invitation sent to ${target.displayName}.`)
  }
  const join = () => {
    if (!joinTarget || pool || busy || !query.isSuccess || !incoming.some((invite) => invite.id === joinTarget.id)) return
    const target = joinTarget
    setJoinTarget(null)
    void act(`join:${target.id}`, () => apiRequest(`/api/pools/invitations/${target.id}/accept`, {
      method: 'POST', body: { balanceDisclosureAccepted: true },
    }), ui('You joined the Pool.'))
  }

  return <>
    {incoming.length > 0 && <section className="overflow-hidden rounded-xl border" aria-label={ui('Pool invitations')}>
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-medium">{ui('Pool invitations')}</h2>
        {pool && <p className="mt-1 text-xs text-muted-foreground">{ui('Leave your current Pool before joining another.')}</p>}
      </div>
      <div className="divide-y">{incoming.map((invitation) => <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <ProfileIdentity profile={invitation.inviter} detail={uit`${invitation.memberCount} of 6 members`} />
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(`decline-pool:${invitation.id}`, () => apiRequest(`/api/pools/invitations/${invitation.id}/decline`, { method: 'POST' }), ui('Invitation dismissed.'))}>{ui('Dismiss')}</Button>
          <Button size="sm" disabled={busy || Boolean(pool) || !query.isSuccess} onClick={(event) => { joinTriggerRef.current = event.currentTarget; setJoinTarget(invitation) }}>{ui('Join')}</Button>
        </div>
      </div>)}</div>
    </section>}

    {query.error && <div role="alert" className="px-4 py-6 text-center"><p className="text-sm text-destructive">{query.error.message}</p><Button className="mt-3" size="sm" variant="outline" onClick={() => void query.refetch()}>{ui('Try again')}</Button></div>}
    {pool && <section ref={sectionRef} tabIndex={-1} className="overflow-hidden rounded-xl border" aria-label={ui('Pool')}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-medium">{ui('Pool')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{uit`${pool.members.length} of 6 members`}{pool.pendingInvitations.length > 0 && <> · {uit`${pool.pendingInvitations.length} pending`}</>}</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">{ui('Pool balance')}</div>
          <div className="text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatBalance(pool.pooledBalanceMicros / 1_000_000)}</div>
        </div>
      </div>
      <div className="divide-y">{pool.members.map((member) => {
        const self = member.profile.id === currentUserId
        const friend = friendIds.has(member.profile.id)
        return <div key={member.profile.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <ProfileIdentity profile={member.profile} />
            {self && <span className="shrink-0 text-xs text-muted-foreground">{ui('You')}</span>}
            {member.owner && <Crown className="size-3.5 shrink-0 text-amber-500" aria-label={ui('Pool owner')} />}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="text-right">
              <div className="text-sm font-medium tabular-nums">{formatBalance(member.contributionBalanceMicros / 1_000_000)}</div>
              {member.reservedMicros > 0 && <div className="text-xs text-muted-foreground">{formatBalance(member.reservedMicros / 1_000_000)} {ui('reserved')}</div>}
            </div>
            {!self && (isOwner || friend) && <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" disabled={busy} aria-label={uit`More options for ${member.profile.displayName}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isOwner && <>
                  <DropdownMenuItem onClick={() => void act(`owner:${member.profile.id}`, () => apiRequest('/api/pools/owner', { method: 'PATCH', body: { userId: member.profile.id } }), uit`${member.profile.displayName} is now the Pool owner.`)}>{ui('Make owner')}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => {
                    if (confirm(uit`Remove ${member.profile.displayName} from the Pool? Existing reserved charges may still settle against their account.`)) {
                      void act(`remove-pool:${member.profile.id}`, () => apiRequest(`/api/pools/members/${member.profile.id}`, { method: 'DELETE' }), uit`${member.profile.displayName} left the Pool.`)
                    }
                  }}>{ui('Remove from Pool')}</DropdownMenuItem>
                  {friend && <DropdownMenuSeparator />}
                </>}
                {friend && friendActions(member.profile)}
              </DropdownMenuContent>
            </DropdownMenu>}
          </div>
        </div>
      })}</div>
      {isOwner && pool.pendingInvitations.length > 0 && <div className="border-t">
        <div className="px-4 py-3">
          <h3 className="text-sm font-medium">{ui('Pending invitations')}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{ui('Pending invitations reserve a Pool seat.')}</p>
        </div>
        <div className="divide-y">{pool.pendingInvitations.map((invitation) => <div key={invitation.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <ProfileIdentity profile={invitation.invitee} />
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(`cancel-pool:${invitation.id}`, () => apiRequest(`/api/pools/invitations/${invitation.id}`, { method: 'DELETE' }), ui('Invitation canceled.'))}>{ui('Cancel')}</Button>
        </div>)}</div>
      </div>}
      <div className="flex flex-wrap items-center gap-3 border-t px-4 py-3">
        <Button size="sm" variant="outline" disabled={busy || mustTransfer} aria-describedby={mustTransfer ? 'pool-leave-help' : undefined} onClick={() => {
          if (confirm(ui('Leave this Pool? Existing reserved charges may still settle against your account.'))) {
            void act('leave-pool', () => apiRequest(`/api/pools/members/${currentUserId}`, { method: 'DELETE' }), ui('You left the Pool.'))
          }
        }}>{ui('Leave Pool')}</Button>
        {mustTransfer && <p id="pool-leave-help" className="text-xs text-muted-foreground">{ui('Transfer ownership before leaving this Pool.')}</p>}
      </div>
    </section>}

    <Dialog open={Boolean(inviteTarget)} onOpenChange={(open) => { if (!open) onInviteClose() }}>
      <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(inviteTriggerRef.current) }}>
        <DialogHeader><DialogTitle>{ui('Share your balance?')}</DialogTitle><DialogDescription>{uit`Inviting ${inviteTarget?.displayName ?? ''} makes your current balance available for every Pool member to view and spend.`}</DialogDescription></DialogHeader>
        <ContributionBalance label={ui('Your current account balance')} micros={query.data?.accountBalanceMicros ?? 0} />
        <DialogFooter><Button variant="outline" onClick={onInviteClose}>{ui('Cancel')}</Button><Button disabled={inviteUnavailable} onClick={invite}>{ui('Invite and share')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(joinTarget)} onOpenChange={(open) => { if (!open) setJoinTarget(null) }}>
      <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(joinTriggerRef.current) }}>
        <DialogHeader><DialogTitle>{ui('Join this Pool?')}</DialogTitle><DialogDescription>{ui('Your current balance will become visible and spendable by all Pool members. Existing reserved charges can still settle after you leave.')}</DialogDescription></DialogHeader>
        <ContributionBalance label={ui('Balance you will contribute')} micros={query.data?.accountBalanceMicros ?? 0} />
        <DialogFooter><Button variant="outline" onClick={() => setJoinTarget(null)}>{ui('Cancel')}</Button><Button disabled={busy || Boolean(pool) || !query.isSuccess || !incoming.some((invite) => invite.id === joinTarget?.id)} onClick={join}>{ui('Join and share')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}

function ContributionBalance({ label, micros }: { label: string; micros: number }) {
  return <div className="rounded-lg bg-muted/50 p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold">{formatBalance(micros / 1_000_000)}</div></div>
}
