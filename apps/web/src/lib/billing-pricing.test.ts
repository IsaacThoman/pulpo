import { describe, expect, it } from 'vitest'
import { chargeCentsForCredits, creditCentsFromInput } from './billing-pricing'

describe('Pulpo platform credit pricing', () => {
  it.each([
    [500, 579],
    [1_000, 1_106],
    [2_500, 2_685],
    [5_000, 5_316],
    [10_000, 10_579],
  ])('charges %i credit cents as %i cents before tax', (creditCents, chargeCents) => {
    expect(chargeCentsForCredits(creditCents)).toBe(chargeCents)
  })

  it('rejects values that cannot represent an integer number of cents', () => {
    expect(() => chargeCentsForCredits(10.5)).toThrow()
    expect(() => chargeCentsForCredits(-1)).toThrow()
  })

  it.each([
    ['5', 500],
    ['25.5', 2_550],
    ['100.00', 10_000],
    ['', null],
    ['5.001', null],
    ['five', null],
  ])('parses %j as %j cents', (value, cents) => {
    expect(creditCentsFromInput(value)).toBe(cents)
  })
})
