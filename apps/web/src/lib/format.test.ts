import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { formatBalance, formatChartNumber, formatNumber, formatSecondsLabel, timeAgo } from './format'

describe('locale-aware formatting', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('uses the selected Spanish locale for numbers, currency, and units', async () => {
    await i18n.changeLanguage('es-ES')

    expect(formatNumber(1_250)).toBe('1,25K')
    expect(formatBalance(12.5)).toContain('12,50')
    expect(formatSecondsLabel(2_000)).toBe('2 segundos')
  })

  it('uses k, m, and b units for chart values', () => {
    expect(formatChartNumber(999)).toBe('999')
    expect(formatChartNumber(12_500)).toBe('12.5k')
    expect(formatChartNumber(12_500_000)).toBe('12.5m')
    expect(formatChartNumber(12_500_000_000)).toBe('12.5b')
  })
})

describe('timeAgo', () => {
  afterEach(() => vi.restoreAllMocks())

  it('formats valid timestamps', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-26T12:00:00.000Z'))

    expect(timeAgo(Date.parse('2026-08-26T11:55:00.000Z'))).toContain('5')
  })

  it('does not throw when a search result has an invalid timestamp', () => {
    expect(timeAgo(Number.NaN)).toBe('')
    expect(timeAgo(Number.POSITIVE_INFINITY)).toBe('')
  })
})
