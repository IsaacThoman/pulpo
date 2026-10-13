import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { nextUsageTierHint, type DailySpendSummary, type UsageTier } from '@/lib/billing'
import { ServiceTierInfo } from './ServiceTierInfo'

const tiers: UsageTier[] = [
  { minPaidCents: 0, minDaysSinceFirstPayment: 0, dailyLimitMicros: 3_000_000 },
  { minPaidCents: 500, minDaysSinceFirstPayment: 0, dailyLimitMicros: 10_000_000 },
  { minPaidCents: 5_000, minDaysSinceFirstPayment: 7, dailyLimitMicros: 25_000_000 },
]

function daily(overrides: Partial<DailySpendSummary> = {}): DailySpendSummary {
  return {
    tier: 1,
    limitOverridden: false,
    limitMicros: 10_000_000,
    spentMicros: 2_500_000,
    pendingMicros: 0,
    remainingMicros: 7_500_000,
    remainingPercentage: 75,
    availableBarPercentage: 75,
    pendingBarPercentage: 0,
    resetsAt: '2026-10-14T00:00:00.000Z',
    paidCents: 800,
    firstPaidAt: '2026-10-10T00:00:00.000Z',
    next: { tier: 2, dailyLimitMicros: 25_000_000, remainingPaidCents: 4_200, minDaysSinceFirstPayment: 7, availableAt: '2026-10-17T12:00:00.000Z' },
    ...overrides,
  }
}

describe('ServiceTierInfo', () => {
  const now = Date.parse('2026-10-13T12:00:00.000Z')

  it('explains what the next tier needs', () => {
    expect(nextUsageTierHint(daily(), now)).toBe('Pay $42.00 more and wait until Oct 17, 2026 to reach tier 2 ($25.00 per day).')
    expect(nextUsageTierHint(daily({ next: { ...daily().next!, remainingPaidCents: 0 } }), now)).toBe('You reach tier 2 ($25.00 per day) on Oct 17, 2026.')
    expect(nextUsageTierHint(daily({ next: { ...daily().next!, availableAt: '2026-10-01T00:00:00.000Z' } }), now)).toBe('Pay $42.00 more to reach tier 2 ($25.00 per day).')
    expect(nextUsageTierHint(daily({ tier: 0, firstPaidAt: null, next: { ...daily().next!, availableAt: null } }), now))
      .toBe('Pay $42.00 more and wait 7 days after your first payment to reach tier 2 ($25.00 per day).')
    expect(nextUsageTierHint(daily({ limitOverridden: true }), now)).toBeNull()
    expect(nextUsageTierHint(daily({ next: null }), now)).toBeNull()
  })

  it('shows today\'s usage and each tier\'s requirements', () => {
    const html = renderToStaticMarkup(<ServiceTierInfo daily={daily()} tiers={tiers} now={now} />)
    expect(html).toContain('$2.50 of $10.00 used today')
    expect(html).toContain('aria-label="Daily usage" aria-valuenow="75"')
    expect(html).toContain('Pay $42.00 more and wait until Oct 17, 2026 to reach tier 2 ($25.00 per day).')
    expect(html).toContain('No payment needed')
    expect(html).toContain('$25')
    // Only the current tier is marked, and only it carries the current-tier label.
    expect(html.match(/aria-current="true"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-current="true"[\s\S]*Tier 1[\s\S]*Current tier/)
  })

  it('marks which requirements are met', () => {
    const html = renderToStaticMarkup(<ServiceTierInfo daily={daily()} tiers={tiers} now={now} />)
    // $5 paid is met; $50 paid and 7 days since the first payment (3 days ago) are not.
    expect(html.match(/aria-label="Met"/g)).toHaveLength(2)
    expect(html.match(/aria-label="Not met yet"/g)).toHaveLength(2)
  })

  it('drops the current tier when an admin set the limit', () => {
    const html = renderToStaticMarkup(<ServiceTierInfo daily={daily({ limitOverridden: true })} tiers={tiers} now={now} />)
    expect(html).toContain('Custom limit')
    expect(html).toContain('An admin set a custom daily limit for your account.')
    expect(html).not.toContain('Current tier')
  })
})
