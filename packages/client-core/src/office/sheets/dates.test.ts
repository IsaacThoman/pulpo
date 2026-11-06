import { describe, expect, it } from 'vitest'
import { dateToSerial, epochMsToSerial, MAX_DATE_SERIAL_1900, MAX_DATE_SERIAL_1904, serialToEpochMs, serialToParts, timeToFraction } from './dates.js'

describe('dateToSerial', () => {
  it.each<[number, number, number, number]>([
    [1900, 1, 1, 1],
    [1900, 1, 0, 0],
    [1899, 12, 31, 0],
    [1899, 12, 30, -1],
    [1900, 2, 28, 59],
    [1900, 2, 29, 60],
    [1900, 3, 0, 60],
    [1900, 1, 60, 60],
    [1900, 3, 1, 61],
    [1900, 3, -1, 59],
    [1900, 12, 31, 366],
    [1901, 1, 1, 367],
    [1930, 1, 1, 10959],
    [2000, 1, 1, 36526],
    [2000, 2, 29, 36585],
    [2024, 1, 1, 45292],
    [2024, 1, 32, 45323],
    [2024, 14, 1, 45689],
    [2024, 0, 1, 45261],
    [2024, 3, 0, 45351],
    [9999, 12, 31, MAX_DATE_SERIAL_1900],
  ])('%s-%s-%s → %s', (year, month, day, serial) => expect(dateToSerial(year, month, day)).toBe(serial))

  it.each<[number, number, number, number]>([
    [1904, 1, 1, 0],
    [1904, 1, 2, 1],
    [1904, 2, 29, 59],
    [1903, 12, 31, -1],
    [2024, 1, 1, 43830],
    [9999, 12, 31, MAX_DATE_SERIAL_1904],
  ])('1904 system: %s-%s-%s → %s', (year, month, day, serial) => expect(dateToSerial(year, month, day, true)).toBe(serial))

  it('keeps years below 100 literal', () => {
    expect(dateToSerial(99, 1, 1)).toBeLessThan(0)
    expect(dateToSerial(99, 1, 1)).not.toBe(dateToSerial(1999, 1, 1))
  })
})

describe('serialToParts', () => {
  const parts = (serial: number, date1904 = false) => {
    const p = serialToParts(serial, date1904)
    return p && [p.year, p.month, p.day, p.hours, p.minutes, p.seconds, p.milliseconds, p.weekday]
  }

  it.each<[number, (number | undefined)[] | undefined]>([
    [0, [1900, 1, 0, 0, 0, 0, 0, 6]],
    [1, [1900, 1, 1, 0, 0, 0, 0, 0]],
    [59, [1900, 2, 28, 0, 0, 0, 0, 2]],
    [60, [1900, 2, 29, 0, 0, 0, 0, 3]],
    [61, [1900, 3, 1, 0, 0, 0, 0, 4]],
    [45292, [2024, 1, 1, 0, 0, 0, 0, 1]],
    [45292.75, [2024, 1, 1, 18, 0, 0, 0, 1]],
    [45292 + 1.5 / 86_400, [2024, 1, 1, 0, 0, 1, 500, 1]],
    [45292.999999999, [2024, 1, 2, 0, 0, 0, 0, 2]],
    [0.999999999, [1900, 1, 1, 0, 0, 0, 0, 0]],
    [59.9999999999, [1900, 2, 29, 0, 0, 0, 0, 3]],
    [MAX_DATE_SERIAL_1900, [9999, 12, 31, 0, 0, 0, 0, 5]],
    [MAX_DATE_SERIAL_1900 + 0.5, [9999, 12, 31, 12, 0, 0, 0, 5]],
    [MAX_DATE_SERIAL_1900 + 1, undefined],
    [MAX_DATE_SERIAL_1900 + 0.9999999999, undefined],
    [-1, undefined],
    [-0.0001, undefined],
    [Number.NaN, undefined],
    [Number.POSITIVE_INFINITY, undefined],
  ])('%s → %j', (serial, expected) => expect(parts(serial)).toEqual(expected))

  it.each<[number, (number | undefined)[] | undefined]>([
    [0, [1904, 1, 1, 0, 0, 0, 0, 5]],
    [59, [1904, 2, 29, 0, 0, 0, 0, 1]],
    [43830.5, [2024, 1, 1, 12, 0, 0, 0, 1]],
    [MAX_DATE_SERIAL_1904, [9999, 12, 31, 0, 0, 0, 0, 5]],
    [MAX_DATE_SERIAL_1904 + 1, undefined],
    [-1, undefined],
  ])('1904 system: %s → %j', (serial, expected) => expect(parts(serial, true)).toEqual(expected))
})

describe('time and epoch conversions', () => {
  it('converts times of day to fractions', () => {
    expect(timeToFraction(12, 0, 0)).toBe(0.5)
    expect(timeToFraction(18, 30, 0)).toBeCloseTo(0.7708333333, 9)
    expect(timeToFraction(0, 0, 1)).toBeCloseTo(1 / 86_400, 15)
    expect(timeToFraction(25, 0, 0)).toBeCloseTo(25 / 24, 12)
  })

  it.each<[number, number]>([
    [Date.UTC(2024, 0, 1), 45292],
    [Date.UTC(2024, 0, 1, 12), 45292.5],
    [Date.UTC(1900, 0, 1), 1],
    [Date.UTC(1900, 1, 28), 59],
    [Date.UTC(1900, 1, 28, 12), 59.5],
    [Date.UTC(1900, 2, 1), 61],
    [Date.UTC(1899, 11, 31), 0],
  ])('epoch %s → serial %s', (ms, serial) => {
    expect(epochMsToSerial(ms)).toBe(serial)
    expect(serialToEpochMs(serial)).toBe(ms)
  })

  it('maps the fake leap day to March 1 and handles 1904', () => {
    expect(serialToEpochMs(60)).toBe(Date.UTC(1900, 2, 1))
    expect(epochMsToSerial(Date.UTC(1904, 0, 1), true)).toBe(0)
    expect(epochMsToSerial(Date.UTC(2024, 0, 1, 6), true)).toBe(43830.25)
    expect(serialToEpochMs(43830.25, true)).toBe(Date.UTC(2024, 0, 1, 6))
  })
})
