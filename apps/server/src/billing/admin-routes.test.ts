import { describe, expect, it } from 'vitest'
import { subscriberTotals } from './admin-routes.js'

describe('billing dashboard subscriber totals', () => {
  it('counts both providers and books App Store revenue after Apple’s commission', () => {
    expect(subscriberTotals([
      { plan: 'eight', provider: 'stripe', count: 2, canceling: 1, pastDue: 0 },
      { plan: 'eight', provider: 'app_store', count: 1, canceling: 0, pastDue: 1 },
      { plan: 'fat', provider: 'app_store', count: 1, canceling: 0, pastDue: 0 },
    ])).toEqual({
      eight: 3,
      fat: 1,
      appStore: 2,
      canceling: 1,
      pastDue: 1,
      monthlyRecurringCents: 2 * 800 + 849 + 2_549,
    })
  })
})
