import { POOL_MAX_MEMBERS } from '@pulpo/client-core'
import type { FriendProfile, PoolSummary } from '@pulpo/contracts'
import { resetLabel, type UsageLimitRow } from '../usage-limits/format'

type Pool = NonNullable<PoolSummary['pool']>

/** The Friends row's second line in Settings: what is waiting, or what the screen holds. */
export function friendsEntryDetail(pendingCount: number, poolsEnabled: boolean): string {
  if (pendingCount > 0) return pendingCount === 1 ? '1 request waiting' : `${pendingCount} requests waiting`
  return poolsEnabled ? 'Friends, requests, and your Pool' : 'Friends and requests'
}

/** A person's second line: their handle, then any detail ("Requested today"). */
export function profileDetail(profile: FriendProfile, detail?: string): string {
  return [`@${profile.username}`, detail].filter(Boolean).join(' · ')
}

/** How many friends the viewer shares with someone, as the web words it; nothing when none. */
export function mutualFriendsLabel(count: number): string | undefined {
  if (count <= 0) return undefined
  return count === 1 ? '1 mutual' : `${count} mutuals`
}

/** "Friends since Sep 1, 2026" on a friend's profile. */
export function friendsSinceLabel(iso: string, locale?: string): string | undefined {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return undefined
  return `Friends since ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)}`
}

export function poolMembersLabel(pool: Pool): string {
  const members = `${pool.members.length} of ${POOL_MAX_MEMBERS} members`
  return pool.pendingInvitations.length ? `${members} · ${pool.pendingInvitations.length} pending` : members
}

export function invitationMembersLabel(memberCount: number): string {
  return `${memberCount} of ${POOL_MAX_MEMBERS} members`
}

/**
 * The Pool's shared usage as usage limit rows. Percentages only, like the plan's own limits: the
 * app never shows balances, credits, or prices, so the web's Pool balance and each member's
 * contribution are left out.
 */
export function poolUsageRows(pool: Pool, locale?: string): UsageLimitRow[] {
  const shared = pool.sharedUsage
  if (!shared) return []
  const bar = (limit: NonNullable<typeof shared.fiveHour>) => ({
    remainingPercentage: limit.remainingPercentage,
    availableBarPercentage: limit.availableBarPercentage,
    pendingBarPercentage: limit.pendingBarPercentage,
  })
  const rows: UsageLimitRow[] = [{
    key: 'pool-shared',
    label: 'Shared usage',
    ...bar(shared.total),
    reset: resetLabel(shared.total.resetsAt, true, locale),
    hint: 'Weekly usage shared by Pulpo Fat subscribers in this Pool',
  }]
  if (shared.fiveHour) rows.push({ key: 'pool-five-hour', label: 'Your 5-hour shared limit', ...bar(shared.fiveHour), reset: resetLabel(shared.fiveHour.resetsAt, false, locale) })
  return rows
}

/**
 * What sharing a Pool means, confirmed before inviting or joining. The server records the consent
 * (`balanceDisclosureAccepted`); the app describes it as usage, never as an amount of money.
 */
export const poolDisclosure = {
  invite: (name: string) => ({
    title: `Invite ${name} to your Pool?`,
    message: `Everyone in a Pool shares their Pulpo usage. Inviting ${name} lets every Pool member see and use your account’s remaining usage.`,
    confirm: 'Invite and Share',
  }),
  join: {
    title: 'Join this Pool?',
    message: 'Everyone in a Pool shares their Pulpo usage. Joining lets every Pool member see and use your account’s remaining usage. Usage already in progress can still count against your account after you leave.',
    confirm: 'Join and Share',
  },
}
