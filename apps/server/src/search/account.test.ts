import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  entitlements: vi.fn(),
  customLimits: vi.fn(),
}))

vi.mock('../billing/entitlements.js', () => ({ getBillingEntitlements: mocks.entitlements }))
vi.mock('../billing/routes.js', async (original) => ({
  ...await original<typeof import('../billing/routes.js')>(),
  loadCustomLimitSummaries: mocks.customLimits,
}))

const { searchUsageLimits } = await import('./account.js')

const resetAt = new Date('2026-12-01T00:00:00Z')

describe('Search usage limits', () => {
  it('lists the weekly, 5-hour, and custom limits Pulpo shows', async () => {
    mocks.entitlements.mockResolvedValue({
      plan: 'eight',
      weeklyLimitMicros: 10_000_000, weeklyRemainingMicros: 6_000_000, weeklyPendingMicros: 500_000,
      weeklyRemainingPercentage: 60, weeklyResetAt: resetAt,
      fiveHourLimitMicros: 2_000_000, fiveHourSpentMicros: 200_000, fiveHourPendingMicros: 0,
      fiveHourRemainingMicros: 1_800_000, fiveHourRemainingPercentage: 90, fiveHourResetAt: null,
    })
    mocks.customLimits.mockResolvedValue([{
      id: 'research', name: 'Research allowance', period: 'daily', models: [], remainingPercentage: 25,
      availableBarPercentage: 25, pendingMicros: 0, pendingBarPercentage: 0, resetsAt: null,
    }])
    const limits = await searchUsageLimits('user-1')
    expect(limits.map(({ id, label, remainingPercentage }) => ({ id, label, remainingPercentage }))).toEqual([
      { id: 'weekly', label: 'Weekly usage', remainingPercentage: 60 },
      { id: 'five_hour', label: '5-hour usage', remainingPercentage: 90 },
      { id: 'research', label: 'Research allowance', remainingPercentage: 25 },
    ])
    expect(limits[0]).toMatchObject({ availableBarPercentage: 60, pendingBarPercentage: 5 })
    expect(mocks.customLimits).toHaveBeenCalledWith('user-1', 'eight')
  })

  it('omits plan bars the account does not have', async () => {
    mocks.entitlements.mockResolvedValue({ plan: 'baby', weeklyRemainingPercentage: null, fiveHourRemainingPercentage: null })
    mocks.customLimits.mockResolvedValue([])
    expect(await searchUsageLimits('user-1')).toEqual([])
  })
})
