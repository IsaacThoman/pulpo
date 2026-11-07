import { describe, expect, it } from 'vitest'
import { dateToSerial } from '../dates.js'
import { fillSeries } from './fill.js'

const serial = (date: string, date1904 = false) => {
  const [year, month, day] = date.split('-').map(Number)
  return dateToSerial(year!, month!, day!, date1904)
}

export const calendarCases = [
  { name: '31st through leap February', source: ['2023-12-31', '2024-01-31'], expected: ['2024-02-29', '2024-03-31', '2024-04-30'] },
  { name: 'clipped source retains day', source: ['2024-01-31', '2024-02-29'], expected: ['2024-03-31', '2024-04-30', '2024-05-31'] },
  { name: 'yearly leap day recovers', source: ['2024-02-29', '2025-02-28'], expected: ['2026-02-28', '2027-02-28', '2028-02-29'] },
  { name: 'four-year leap step reaches non-leap century', source: ['2092-02-29', '2096-02-29'], expected: ['2100-02-28', '2104-02-29'] },
  { name: 'up/left through February', source: ['2024-03-31', '2024-04-30'], backward: true, expected: ['2024-02-29', '2024-01-31', '2023-12-31'] },
  { name: 'descending months', source: ['2024-05-31', '2024-04-30'], expected: ['2024-03-31', '2024-02-29', '2024-01-31'] },
  { name: 'backward yearly leap day', source: ['2024-02-29', '2025-02-28'], backward: true, expected: ['2023-02-28', '2022-02-28', '2021-02-28', '2020-02-29'] },
  { name: 'ordinary daily series includes weekends', source: ['2024-03-01'], expected: ['2024-03-02', '2024-03-03', '2024-03-04'] },
]

describe.each([false, true])('date autofill, date1904=%s', (date1904) => {
  it.each(calendarCases)('$name', ({ source, expected, backward }) => {
    for (const fraction of [0, 0.5, (13 * 3600 + 21 * 60 + 12.25) / 86400]) {
      const results = fillSeries(source.map((date) => ({ value: serial(date, date1904) + fraction, formula: false, numFmt: 'yyyy-mm-dd hh:mm:ss' })), expected.length, backward, date1904)
      results.forEach((result, i) => {
        expect(result.kind).toBe('value')
        if (result.kind === 'value') expect(result.value).toBeCloseTo(serial(expected[i]!, date1904) + fraction, 8)
      })
    }
  })
})

it.each([
  { source: [59.5], backward: false, expected: [60.5, 61.5] },
  { source: [61.5], backward: true, expected: [60.5, 59.5] },
  { source: [31, 60], backward: false, expected: [91, 121, 152] },
  { source: [0.5], date1904: true, backward: false, expected: [1.5, 2.5] },
])('steps across workbook epoch boundaries: $source', ({ source, backward, expected, date1904 }) => {
  expect(fillSeries(source.map((value) => ({ value, formula: false, numFmt: 'm/d/yyyy h:mm' })), expected.length, backward, date1904)).toEqual(expected.map((value) => ({ kind: 'value', value })))
})

it('keeps weekday-name lists cyclic in both directions (there is no workday-date fill mode)', () => {
  const source = [{ value: 'Friday', formula: false, numFmt: 'General' }]
  expect(fillSeries(source, 3)).toEqual(['Saturday', 'Sunday', 'Monday'].map((value) => ({ kind: 'value', value })))
  expect(fillSeries(source, 2, true)).toEqual(['Thursday', 'Wednesday'].map((value) => ({ kind: 'value', value })))
})
