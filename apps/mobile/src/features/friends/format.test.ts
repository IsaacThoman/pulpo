import { describe, expect, it } from 'vitest'
import type { FriendProfile, PoolSummary } from '@pulpo/contracts'
import { friendsEntryDetail, invitationMembersLabel, poolDisclosure, poolMembersLabel, poolUsageRows, profileDetail } from './format'

const profile = (id: string): FriendProfile => ({ id, displayName: id, username: id.toLowerCase(), avatarUrl: null, profileColor: null })
const pool = (members: string[], invited: string[] = []): NonNullable<PoolSummary['pool']> => ({
  id: 'pool',
  ownerUserId: 'me',
  pooledBalanceMicros: 15_000_000,
  sharedUsage: null,
  members: members.map((id) => ({ profile: profile(id), owner: id === 'me', contributionBalanceMicros: 5_000_000, reservedMicros: 0, joinedAt: '2026-09-01T00:00:00.000Z' })),
  pendingInvitations: invited.map((id) => ({ id: `invite-${id}`, poolId: 'pool', inviter: profile('me'), invitee: profile(id), memberCount: members.length, createdAt: '2026-09-01T00:00:00.000Z' })),
})
const bar = (remainingPercentage: number, resetsAt: string | null) => ({ remainingPercentage, availableBarPercentage: remainingPercentage, pendingMicros: 250_000, pendingBarPercentage: 5, resetsAt })

describe('friends formatting', () => {
  it('describes people by their handle and any detail', () => {
    expect(profileDetail(profile('Alice'))).toBe('@alice')
    expect(profileDetail(profile('Alice'), 'Requested today')).toBe('@alice · Requested today')
  })

  it('counts Pool seats, pending invitations among them', () => {
    expect(poolMembersLabel(pool(['me', 'Alice']))).toBe('2 of 6 members')
    expect(poolMembersLabel(pool(['me', 'Alice'], ['Bob']))).toBe('2 of 6 members · 1 pending')
    expect(invitationMembersLabel(3)).toBe('3 of 6 members')
  })

  it('summarizes what waits in the Settings entry', () => {
    expect(friendsEntryDetail(0, true)).toBe('Friends, requests, and your Pool')
    expect(friendsEntryDetail(0, false)).toBe('Friends and requests')
    expect(friendsEntryDetail(1, true)).toBe('1 request waiting')
    expect(friendsEntryDetail(3, false)).toBe('3 requests waiting')
  })
})

describe('Pool shared usage', () => {
  it('has no rows when nobody in the Pool shares', () => {
    expect(poolUsageRows(pool(['me']))).toEqual([])
  })

  it('shows the shared weekly usage and the viewer’s five-hour limit as percentages', () => {
    const shared = { ...pool(['me', 'Alice']), sharedUsage: { total: bar(64, '2026-11-09T00:00:00.000Z'), fiveHour: bar(80, null) } }
    const rows = poolUsageRows(shared, 'en-US')
    expect(rows.map((row) => [row.label, row.remainingPercentage, row.pendingBarPercentage])).toEqual([
      ['Shared usage', 64, 5],
      ['Your 5-hour shared limit', 80, 5],
    ])
    expect(rows[0]?.hint).toBe('Weekly usage shared by Pulpo Fat subscribers in this Pool')
    expect(rows[0]?.reset).toMatch(/^Resets Nov/)
    expect(rows[1]?.reset).toBe('Starts on first use')
    expect(JSON.stringify(rows)).not.toMatch(/micros|\$/i)
  })
})

describe('Pool disclosure', () => {
  it('explains sharing without credits, balances, or prices', () => {
    const copy = [poolDisclosure.invite('Alice'), poolDisclosure.join].flatMap((item) => [item.title, item.message, item.confirm]).join(' ')
    expect(copy).toMatch(/usage/)
    expect(copy).not.toMatch(/\$|credit|balance|price|money|spend/i)
  })
})
