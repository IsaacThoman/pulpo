import { afterEach, describe, expect, it } from 'vitest'
import i18n from '@/i18n'
import { formatBalance, formatNumber, formatSecondsLabel } from './format'

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
})
