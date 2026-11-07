import { describe, expect, it } from 'vitest'
import { periodLabel, planBenefits, planButtonColors, planStorageLabel, priceLabel, subscriptionStatusLabel } from './format'

const subscription = {
  provider: 'app_store' as const, plan: 'eight' as const, pendingPlan: null, status: 'active' as const,
  cancelAtPeriodEnd: false, currentPeriodEnd: '2026-12-01T12:00:00.000Z',
}

describe('App Store formatting', () => {
  it('shows the App Store’s price with its period', () => {
    expect(priceLabel({ displayPrice: '$9.99', periodUnit: 'month', periodValue: 1 })).toBe('$9.99/month')
    expect(priceLabel({ displayPrice: '29,99 €', periodUnit: 'month', periodValue: 3 })).toBe('29,99 € every 3 months')
    expect(priceLabel({ displayPrice: '$9.99', periodUnit: null, periodValue: null })).toBe('$9.99')
  })

  it('describes renewal, cancellation, a pending plan change, and billing problems', () => {
    expect(subscriptionStatusLabel(subscription, 'en-US')).toBe('Renews Dec 1, 2026')
    expect(subscriptionStatusLabel({ ...subscription, cancelAtPeriodEnd: true }, 'en-US')).toBe('Ends Dec 1, 2026')
    expect(subscriptionStatusLabel({ ...subscription, plan: 'fat', pendingPlan: 'eight' }, 'en-US')).toBe('Pulpo Eight starts Dec 1, 2026')
    expect(subscriptionStatusLabel({ ...subscription, status: 'past_due' })).toMatch(/couldn’t renew/)
  })

  it('puts the period after a large price', () => {
    expect(periodLabel({ periodUnit: 'month', periodValue: 1 })).toBe('/ month')
    expect(periodLabel({ periodUnit: 'month', periodValue: 3 })).toBe('every 3 months')
    expect(periodLabel({ periodUnit: null, periodValue: null })).toBeNull()
  })

  it('describes plan storage and the web’s selling points', () => {
    expect(planStorageLabel(10 * 1024 ** 3)).toBe('10 GB')
    expect(planStorageLabel(1.5 * 1024 ** 3)).toBe('1.5 GB')
    expect(planStorageLabel(500 * 1024 ** 2)).toBe('500 MB')
    const plans = { storageLimitBytes: { baby: 2 * 1024 ** 3, eight: 10 * 1024 ** 3, fat: 25 * 1024 ** 3 }, fatSharedWeeklyPercent: 40 }
    expect(planBenefits('eight', plans)).toEqual(['Everything in Pulpo Baby', 'High usage limits', '10 GB of file storage', 'Cancel any time'])
    expect(planBenefits('fat', plans)).toEqual(['Everything in Pulpo Eight', 'Highest usage limits', 'Share 40% of your weekly usage', '25 GB of file storage'])
    expect(planBenefits('fat', null)).toEqual(['Everything in Pulpo Eight', 'Highest usage limits'])
  })
})

describe('planButtonColors', () => {
  const contrast = (a: string, b: string) => {
    const lum = (hex: string) => {
      const [r, g, b] = (hex.slice(1).match(/.{2}/g) ?? []).map((c) => { const v = parseInt(c, 16) / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
    }
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
    return (hi! + 0.05) / (lo! + 0.05)
  }
  it('keeps each plan button label at 4.5:1 or better in light and dark mode', () => {
    for (const plan of ['eight', 'fat'] as const) {
      for (const dark of [false, true]) {
        const { background, text } = planButtonColors(plan, dark)
        expect(contrast(text, background), `${plan} ${dark ? 'dark' : 'light'}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
