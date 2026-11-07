import { expect, it } from 'vitest'
import { calculationBudget } from '../budget.js'
import { Errors, type FunctionContext } from '../types.js'
import { call, createContext, row } from './testing.js'

function weekday(ctx: FunctionContext, serial: number): number {
  return ((serial + (ctx.date1904 ? 5 : -1)) % 7 + 7) % 7
}

it('matches a day-by-day reference for every valid weekend mask in both date systems', () => {
  for (const date1904 of [false, true]) {
    const ctx = createContext({ date1904 })
    const max = date1904 ? 2_957_003 : 2_958_465
    for (let bits = 0; bits < 127; bits++) {
      const mask = bits.toString(2).padStart(7, '0')
      const working = (s: number) => mask[(weekday(ctx, s) + 6) % 7] === '0'
      for (const start of [0, 1, 55, 59, 60, 61, 62, 45000, max - 1, max]) {
        // Duplicates, fractional serials, weekends, out-of-interval dates, and holiday
        // chains which move the result across additional holidays are intentional.
        const holidays = [start + 1, start + 1.8, start + 2, start + 3, start + 7, start + 8, start + 9, start, 2, 2.5, 12, max]
        const set = new Set(holidays.map(Math.floor))
        const business = (s: number) => working(s) && !set.has(s)
        for (const days of [-30, -7, -1, 0, 1, 7, 30]) {
          let serial = start, left = Math.abs(days)
          while (left && serial >= 0 && serial <= max) {
            serial += days < 0 ? -1 : 1
            if (business(serial)) left--
          }
          expect(call('WORKDAY.INTL', [start + 0.75, days, mask, row(...holidays)], ctx), `${date1904}/${mask}/${start}/${days}`)
            .toEqual(serial < 0 || serial > max ? Errors.NUM : serial)
          if (mask === '0000011') expect(call('WORKDAY', [start, days, row(...holidays)], ctx))
            .toEqual(serial < 0 || serial > max ? Errors.NUM : serial)
        }
        const end = Math.min(max, start + 47)
        let count = 0
        for (let s = start; s <= end; s++) if (business(s)) count++
        expect(call('NETWORKDAYS.INTL', [start, end, mask, row(...holidays)], ctx)).toBe(count)
        expect(call('NETWORKDAYS.INTL', [end, start, mask, row(...holidays)], ctx)).toBe(start === end ? count : count === 0 ? 0 : -count)
        if (mask === '0000011') expect(call('NETWORKDAYS', [start, end, row(...holidays)], ctx)).toBe(count)
      }
    }
  }
})

it('rejects impossible offsets before arithmetic loses unit precision', () => {
  for (const days of [1e100, -1e100, 1e308, -1e308]) {
    expect(call('WORKDAY', [45000, days])).toBe(Errors.NUM)
    expect(call('WORKDAY.INTL', [45000, days, '1111110'])).toBe(Errors.NUM)
  }
})

it('handles a dense holiday calendar and long distances with bounded work', () => {
  const holidays = row(...Array.from({ length: 500 }, (_, i) => 45000 + i))
  expect(call('WORKDAY.INTL', [45000, 1, '0000000', holidays])).toBe(45500)
  expect(call('WORKDAY.INTL', [45499, -1, '0000000', holidays])).toBe(44999)
  const restore = calculationBudget(100)
  try {
    expect(call('WORKDAY.INTL', [1, 300000, '1111110'])).toBe(2100001)
    expect(call('NETWORKDAYS.INTL', [0, 2958465, '1111110'])).toBe(422638)
  } finally { restore() }
})
