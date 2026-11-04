import { describe, expect, it } from 'vitest'
import { dateToSerial } from '../dates.js'
import { Errors, type Scalar } from '../formula/types.js'
import { parseInput, parseNumberDetailed, parseNumberText } from './parse.js'

const OPTIONS = { currentYear: 2024 }
/** 2024-01-31. */
const JAN_31 = 45322
const time = (hours: number, minutes = 0, seconds = 0) => (hours * 3600 + minutes * 60 + seconds) / 86_400

describe('parseInput: numbers', () => {
  it.each<[string, number, string | undefined]>([
    ['123', 123, undefined],
    [' 123 ', 123, undefined],
    ['-123', -123, undefined],
    ['+5', 5, undefined],
    ['007', 7, undefined],
    ['1.5', 1.5, undefined],
    ['.5', 0.5, undefined],
    ['-.5', -0.5, undefined],
    ['1.', 1, undefined],
    ['0', 0, undefined],
    ['(12)', -12, undefined],
    ['($1,234.50)', -1234.5, '"$"#,##0.00'],
    ['1,234', 1234, '#,##0'],
    ['1,234.5', 1234.5, '#,##0.00'],
    ['1,234,567', 1234567, '#,##0'],
    ['-1,234', -1234, '#,##0'],
    ['$5', 5, '"$"#,##0'],
    ['$1,234.50', 1234.5, '"$"#,##0.00'],
    ['-$5', -5, '"$"#,##0'],
    ['$-5', -5, '"$"#,##0'],
    ['50%', 0.5, '0%'],
    ['12.5%', 0.125, '0.00%'],
    ['50 %', 0.5, '0%'],
    ['%50', 0.5, '0%'],
    ['-50%', -0.5, '0%'],
    ['1,000%', 10, '0%'],
    ['1e3', 1000, '0.00E+00'],
    ['1.5E-3', 0.0015, '0.00E+00'],
    ['-2E+2', -200, '0.00E+00'],
    ['1 1/2', 1.5, '# ?/?'],
    ['-2 3/4', -2.75, '# ?/?'],
    ['0 1/2', 0.5, '# ?/?'],
    ['1 3/16', 1.1875, '# ??/??'],
    ['1234567890123456789', 1234567890123450000, undefined],
    ['0.1234567890123456789', 0.123456789012345, undefined],
    ['123456789012345678.9', 123456789012345000, undefined],
  ])('%j → %s (%s)', (input, value, numFmt) => {
    const parsed = parseInput(input, OPTIONS)
    expect(parsed.value).toBe(value)
    expect(parsed.numFmt).toBe(numFmt)
  })
})

describe('parseInput: dates and times', () => {
  it.each<[string, number, string]>([
    ['1/31/2024', JAN_31, 'm/d/yyyy'],
    ['01/31/2024', JAN_31, 'm/d/yyyy'],
    ['1-31-2024', JAN_31, 'm/d/yyyy'],
    ['1/31/24', JAN_31, 'm/d/yyyy'],
    ['2024-01-31', JAN_31, 'm/d/yyyy'],
    ['2024/1/31', JAN_31, 'm/d/yyyy'],
    ['31-Jan-2024', JAN_31, 'd-mmm-yy'],
    ['31 Jan 2024', JAN_31, 'd-mmm-yy'],
    ['31-jan-24', JAN_31, 'd-mmm-yy'],
    ['31/Jan/2024', JAN_31, 'd-mmm-yy'],
    ['31-January-2024', JAN_31, 'd-mmm-yy'],
    ['Jan 31, 2024', JAN_31, 'd-mmm-yy'],
    ['January 31, 2024', JAN_31, 'd-mmm-yy'],
    ['January 31 2024', JAN_31, 'd-mmm-yy'],
    ['Jan-31-2024', JAN_31, 'd-mmm-yy'],
    ['JAN 31,2024', JAN_31, 'd-mmm-yy'],
    ['Sept 5, 2024', dateToSerial(2024, 9, 5), 'd-mmm-yy'],
    ['31-Jan', JAN_31, 'd-mmm'],
    ['Jan 31', JAN_31, 'd-mmm'],
    ['1/31', JAN_31, 'd-mmm'],
    ['1/2', 45293, 'd-mmm'],
    ['Jan-24', 45315, 'd-mmm'],
    ['January 2024', 45292, 'mmm-yy'],
    ['Jan 2024', 45292, 'mmm-yy'],
    ['Jan-2024', 45292, 'mmm-yy'],
    ['Jan-32', dateToSerial(1932, 1, 1), 'mmm-yy'],
    ['1/2024', 45292, 'mmm-yy'],
    ['1/32', dateToSerial(1932, 1, 1), 'mmm-yy'],
    ['2/30', dateToSerial(1930, 2, 1), 'mmm-yy'],
    ['2/29/2024', 45351, 'm/d/yyyy'],
    ['2/29/1900', 60, 'm/d/yyyy'],
    ['3/1/1900', 61, 'm/d/yyyy'],
    ['1/1/1900', 1, 'm/d/yyyy'],
    ['12/31/9999', 2958465, 'm/d/yyyy'],
    ['5/1/30', dateToSerial(1930, 5, 1), 'm/d/yyyy'],
    ['5/1/29', dateToSerial(2029, 5, 1), 'm/d/yyyy'],
    ['5/1/00', dateToSerial(2000, 5, 1), 'm/d/yyyy'],
    ['13:45', time(13, 45), 'h:mm'],
    ['1:45 PM', time(13, 45), 'h:mm AM/PM'],
    ['1:45 pm', time(13, 45), 'h:mm AM/PM'],
    ['1:45PM', time(13, 45), 'h:mm AM/PM'],
    ['1:45p', time(13, 45), 'h:mm AM/PM'],
    ['1:45 a', time(1, 45), 'h:mm AM/PM'],
    ['12:00 AM', 0, 'h:mm AM/PM'],
    ['12:00 PM', 0.5, 'h:mm AM/PM'],
    ['12:30 AM', time(0, 30), 'h:mm AM/PM'],
    ['13:45:30', time(13, 45, 30), 'h:mm:ss'],
    ['1:45:30 PM', time(13, 45, 30), 'h:mm:ss AM/PM'],
    ['13:45:30.5', time(13, 45, 30.5), 'mm:ss.0'],
    ['1 PM', time(13), 'h:mm AM/PM'],
    ['9 am', time(9), 'h:mm AM/PM'],
    ['25:30', time(25, 30), '[h]:mm:ss'],
    ['24:00', 1, '[h]:mm:ss'],
    ['45:30.5', (45 * 60 + 30.5) / 86_400, 'mm:ss.0'],
    ['0:00', 0, 'h:mm'],
    ['1/31/2024 13:45', JAN_31 + time(13, 45), 'm/d/yyyy h:mm'],
    ['2024-01-31 1:45 PM', JAN_31 + time(13, 45), 'm/d/yyyy h:mm'],
    ['Jan 31, 2024 1:45 PM', JAN_31 + time(13, 45), 'm/d/yyyy h:mm'],
    ['31-Jan-2024 13:45:30', JAN_31 + time(13, 45, 30), 'm/d/yyyy h:mm'],
    ['1/31/2024 3 PM', JAN_31 + time(15), 'm/d/yyyy h:mm'],
    ['1/31/2024  3pm', JAN_31 + time(15), 'm/d/yyyy h:mm'],
  ])('%j → %s (%s)', (input, value, numFmt) => {
    const parsed = parseInput(input, OPTIONS)
    expect(parsed.value).toBeCloseTo(value, 10)
    expect(parsed.numFmt).toBe(numFmt)
  })

  it('uses the 1904 date system', () => {
    expect(parseInput('1/1/1904', { date1904: true }).value).toBe(0)
    expect(parseInput('1/1/2024', { date1904: true }).value).toBe(43830)
    expect(parseInput('12/31/1903', { date1904: true }).value).toBe('12/31/1903')
    expect(parseInput('2/29/1900', { date1904: true }).value).toBe('2/29/1900')
  })

  it('defaults a missing year to the current one', () => {
    expect(parseInput('1/31').value).toBe(dateToSerial(new Date().getFullYear(), 1, 31))
  })
})

describe('parseInput: text, booleans, errors', () => {
  it.each<[string, Scalar]>([
    ['abc', 'abc'],
    ['   ', '   '],
    ['1,23', '1,23'],
    ['12,34', '12,34'],
    ['1234,567', '1234,567'],
    [',123', ',123'],
    ['1.2.3', '1.2.3'],
    ['1e309', '1e309'],
    ['$5%', '$5%'],
    ['5$', '5$'],
    ['--5', '--5'],
    ['(-5)', '(-5)'],
    ['1 1/0', '1 1/0'],
    ['1 3/2', '1 3/2'],
    ['2/30/2024', '2/30/2024'],
    ['2/29/2023', '2/29/2023'],
    ['12/31/1899', '12/31/1899'],
    ['13/1/2024', '13/1/2024'],
    ['0/1/2024', '0/1/2024'],
    ['1/0/2024', '1/0/2024'],
    ['31/1/2024', '31/1/2024'],
    ['1/1/999', '1/1/999'],
    ['Foo 5, 2024', 'Foo 5, 2024'],
    ['13:60', '13:60'],
    ['13:45:60', '13:45:60'],
    ['13 PM', '13 PM'],
    ['13', 13],
    ['1/31/2024 25:00', '1/31/2024 25:00'],
    ['2024-01-31T13:45', '2024-01-31T13:45'],
    ['TRUE', true],
    ['false', false],
    [' True ', true],
    ['#N/A', Errors.NA],
    ['#div/0!', Errors.DIV0],
    ['#REF!', Errors.REF],
    ['#VALUE!', Errors.VALUE],
    ['#NAME?', Errors.NAME],
    ['#foo', '#foo'],
    ["'123", '123'],
    ["'", ''],
    ["'=1", '=1'],
    ["'TRUE", 'TRUE'],
    ['', null],
    ['x'.repeat(300), 'x'.repeat(300)],
  ])('%j → %j', (input, value) => {
    const parsed = parseInput(input, OPTIONS)
    expect(parsed.value).toBe(value)
    expect(parsed.numFmt).toBeUndefined()
  })
})

describe('parseNumberText', () => {
  it.each<[string, number | undefined]>([
    ['123', 123],
    [' -1,234.5 ', -1234.5],
    ['$1,000', 1000],
    ['50%', 0.5],
    ['(12)', -12],
    ['1e3', 1000],
    ['1/31/2024', JAN_31],
    ['2024-01-31', JAN_31],
    ['3:30 PM', time(15, 30)],
    ['1 1/2', 1.5],
    ['TRUE', undefined],
    ['', undefined],
    ['  ', undefined],
    ['#N/A', undefined],
    ['abc', undefined],
    ['1,23', undefined],
    ['12abc', undefined],
    ['Infinity', undefined],
    ['NaN', undefined],
    ['0x10', undefined],
    ['1_000', undefined],
  ])('%j → %s', (input, value) => expect(parseNumberText(input, OPTIONS)).toBe(value))

  it('tells what kind of number the text was', () => {
    expect(parseNumberDetailed('1/31/2024')?.kind).toBe('date')
    expect(parseNumberDetailed('13:45')?.kind).toBe('time')
    expect(parseNumberDetailed('1/31/2024 1:45 PM')?.kind).toBe('datetime')
    expect(parseNumberDetailed('50%')?.kind).toBe('percent')
    expect(parseNumberDetailed('$5')?.kind).toBe('currency')
    expect(parseNumberDetailed('1e5')?.kind).toBe('scientific')
    expect(parseNumberDetailed('1 1/2')?.kind).toBe('fraction')
    expect(parseNumberDetailed('5')?.kind).toBe('number')
  })
})
