import { describe, expect, it } from 'vitest'
import { builtinFormatCode, formatValue } from './index.js'

/** [serial, code, text] as Excel shows them. 45292 is Monday 2024-01-01. */
type Case = [number, string, string]

const NEW_YEAR = 45292
/** Tuesday 2024-01-30 18:00. */
const EVENING = 45321.75
/** 18:05:07 the same day. */
const LATER = EVENING + (5 * 60 + 7) / 86_400
const at = (hours: number, minutes = 0, seconds = 0) => (hours * 3600 + minutes * 60 + seconds) / 86_400

const text = (value: number, code: string, date1904 = false) => formatValue(value, code, { date1904 }).text

describe('date parts', () => {
  it.each<Case>([
    [NEW_YEAR, 'm/d/yyyy', '1/1/2024'],
    [NEW_YEAR, 'mm/dd/yyyy', '01/01/2024'],
    [NEW_YEAR, 'd-mmm-yy', '1-Jan-24'],
    [NEW_YEAR, 'dddd', 'Monday'],
    [NEW_YEAR, 'ddd', 'Mon'],
    [NEW_YEAR, 'ddddd', 'Monday'],
    [NEW_YEAR, 'mmmm', 'January'],
    [NEW_YEAR, 'mmmmm', 'J'],
    [NEW_YEAR, 'mmmmmm', 'January'],
    [NEW_YEAR, 'mmm', 'Jan'],
    [NEW_YEAR, 'm', '1'],
    [NEW_YEAR, 'mm', '01'],
    [NEW_YEAR, 'yy', '24'],
    [NEW_YEAR, 'yyyy', '2024'],
    [NEW_YEAR, 'y', '24'],
    [NEW_YEAR, 'yyy', '2024'],
    [NEW_YEAR, 'mmm-yy', 'Jan-24'],
    [NEW_YEAR, 'd', '1'],
    [NEW_YEAR, 'dd', '01'],
    [NEW_YEAR, 'YYYY-MM-DD', '2024-01-01'],
    [NEW_YEAR, 'D/M/YYYY', '1/1/2024'],
    [EVENING, 'mmmm d, yyyy', 'January 30, 2024'],
    [EVENING, 'dddd, mmmm dd, yyyy', 'Tuesday, January 30, 2024'],
    [EVENING, 'ddd mmm d', 'Tue Jan 30'],
    [EVENING, 'd.m.yyyy', '30.1.2024'],
    [EVENING, 'dd\\/mm\\/yyyy', '30/01/2024'],
    [EVENING, '"Date: "m/d', 'Date: 1/30'],
    [EVENING, 'yyyy"年"m"月"d"日"', '2024年1月30日'],
    [EVENING, 'yyyy-mm-dd"T"hh:mm:ss', '2024-01-30T18:00:00'],
    [EVENING, 'mmm d, h:mm', 'Jan 30, 18:00'],
    [45351, 'm/d/yyyy', '2/29/2024'],
    [45352, 'mmmm d', 'March 1'],
    [36526, 'dddd m/d/yy', 'Saturday 1/1/00'],
    [10959, 'm/d/yy', '1/1/30'],
    [44926, 'm/d/yyyy dddd', '12/31/2022 Saturday'],
    [NEW_YEAR + 0.999, 'm/d/yyyy', '1/1/2024'],
    [NEW_YEAR, 'e', '2024'],
    [NEW_YEAR, 'bbbb', '2567'],
    [NEW_YEAR, 'bb', '67'],
    [NEW_YEAR, 'ggg yyyy', ' 2024'],
    [NEW_YEAR, 'aaa', 'Mon'],
    [NEW_YEAR, 'aaaa', 'Monday'],
    [NEW_YEAR, 'mmmm', 'January'],
    [NEW_YEAR + 31, 'mmmm mmm mmmmm', 'February Feb F'],
    [NEW_YEAR + 60, 'mmmm', 'March'],
    [NEW_YEAR + 91, 'mmmm', 'April'],
    [NEW_YEAR + 121, 'mmmm', 'May'],
    [NEW_YEAR + 152, 'mmmm', 'June'],
    [NEW_YEAR + 182, 'mmmm', 'July'],
    [NEW_YEAR + 213, 'mmmm', 'August'],
    [NEW_YEAR + 244, 'mmmm', 'September'],
    [NEW_YEAR + 274, 'mmmm', 'October'],
    [NEW_YEAR + 305, 'mmmm', 'November'],
    [NEW_YEAR + 335, 'mmmm', 'December'],
    [NEW_YEAR + 1, 'dddd', 'Tuesday'],
    [NEW_YEAR + 2, 'dddd', 'Wednesday'],
    [NEW_YEAR + 3, 'dddd', 'Thursday'],
    [NEW_YEAR + 4, 'dddd', 'Friday'],
    [NEW_YEAR + 5, 'dddd', 'Saturday'],
    [NEW_YEAR + 6, 'dddd', 'Sunday'],
  ])('%s with %s → %j', (value, code, expected) => expect(text(value, code)).toBe(expected))
})

describe('times', () => {
  it.each<Case>([
    [EVENING, 'h:mm', '18:00'],
    [EVENING, 'h:mm AM/PM', '6:00 PM'],
    [EVENING, 'hh:mm:ss', '18:00:00'],
    [LATER, 'h:m:s', '18:5:7'],
    [LATER, 'hh:mm:ss', '18:05:07'],
    [LATER, 'h:mm', '18:05'],
    [LATER, 'h:mm:ss AM/PM', '6:05:07 PM'],
    [LATER, 'h "hours" m "minutes"', '18 hours 5 minutes'],
    [LATER, 'm/d/yyyy h:mm', '1/30/2024 18:05'],
    [LATER, 'mm:ss', '05:07'],
    [LATER, 'm:ss', '5:07'],
    [0.5, 'h AM/PM', '12 PM'],
    [0, 'h:mm AM/PM', '12:00 AM'],
    [at(0, 30), 'h:mm AM/PM', '12:30 AM'],
    [at(12, 30), 'h:mm AM/PM', '12:30 PM'],
    [at(23, 59), 'hh:mm AM/PM', '11:59 PM'],
    [at(9), 'hh:mm AM/PM', '09:00 AM'],
    [0.25, 'h:mm a/p', '6:00 a'],
    [0.75, 'h:mm A/P', '6:00 P'],
    [0.75, 'h:mm am/pm', '6:00 PM'],
    [0.25, 'h:mm AM/PM', '6:00 AM'],
    [0.75, 'h:mm', '18:00'],
    [at(13, 45, 30), 'h:mm:ss', '13:45:30'],
    [at(0, 0, 30.5), 'h:mm:ss', '0:00:31'],
    [at(0, 0, 30.4), 'h:mm:ss', '0:00:30'],
    [at(12, 34, 59.9995), 'h:mm:ss.000', '12:35:00.000'],
    [at(12, 34, 59.9994), 'h:mm:ss.000', '12:34:59.999'],
    [at(12, 34, 59.96), 'h:mm:ss.0', '12:35:00.0'],
    [at(12, 34, 59.94), 'h:mm:ss.0', '12:34:59.9'],
    [at(12, 34, 59.6), 'h:mm:ss', '12:35:00'],
    [at(12, 34, 56.789), 'h:mm:ss.00', '12:34:56.79'],
    [at(12, 34, 56.789), 'ss.000', '56.789'],
    [at(0, 1, 0.5), 'mm:ss.0', '01:00.5'],
    [0.999999, 'h:mm:ss', '0:00:00'],
    [0.999999, 'h:mm:ss.000', '23:59:59.914'],
    [NEW_YEAR + 0.9999999999, 'm/d/yyyy h:mm:ss', '1/2/2024 0:00:00'],
    [NEW_YEAR + 0.999999, 'm/d/yyyy', '1/1/2024'],
    [NEW_YEAR + 0.999999, 'dddd h:mm:ss', 'Tuesday 0:00:00'],
    [at(18, 5), 'hh:mm:ss.000 AM/PM', '06:05:00.000 PM'],
    [0.00069444, 'mmss.0', '0100.0'],
    [0.5, 'h:mm:ss.0000', '12:00:00.0000'],
  ])('%s with %s → %j', (value, code, expected) => expect(text(value, code)).toBe(expected))
})

describe('elapsed time', () => {
  it.each<Case>([
    [1.5, '[h]:mm', '36:00'],
    [1.5, '[hh]:mm', '36:00'],
    [1 / 24, '[h]', '1'],
    [1 / 24, '[hh]', '01'],
    [2.75, '[h]:mm:ss', '66:00:00'],
    [0.5, '[mm]:ss', '720:00'],
    [0.5, '[ss]', '43200'],
    [0.000694444, '[ss].0', '60.0'],
    [-0.5, '[h]:mm', '#######'],
    [10, '[h]', '240'],
    [0.1, '[h]:mm:ss', '2:24:00'],
    [5 / 1440, '[m]:ss', '5:00'],
    [at(25, 30), '[h]:mm', '25:30'],
    [EVENING, '[h]:mm:ss', '1087722:00:00'],
    [at(1, 59, 59.6), '[h]:mm:ss', '2:00:00'],
    [3 + at(1, 2, 3), '[h]:mm:ss', '73:02:03'],
    [3 + at(1, 2, 3), '[m]', '4382'],
    [3 + at(1, 2, 3), 'd "days" h:mm', '3 days 1:02'],
    [0, '[h]:mm:ss', '0:00:00'],
    [-0.5, 'h:mm;-[h]:mm', '-12:00'],
  ])('%s with %s → %j', (value, code, expected) => expect(text(value, code)).toBe(expected))
})

describe('the 1900 leap-year bug and range limits', () => {
  it.each<Case>([
    [1, 'm/d/yyyy', '1/1/1900'],
    [1, 'dddd', 'Sunday'],
    [59, 'm/d/yyyy', '2/28/1900'],
    [60, 'm/d/yyyy', '2/29/1900'],
    [60, 'dddd', 'Wednesday'],
    [61, 'm/d/yyyy', '3/1/1900'],
    [61, 'dddd', 'Thursday'],
    [0, 'm/d/yyyy', '1/0/1900'],
    [0, 'yyyy-mm-dd', '1900-01-00'],
    [0, 'dddd', 'Saturday'],
    [0.5, 'm/d/yyyy h:mm', '1/0/1900 12:00'],
    [366, 'm/d/yyyy', '12/31/1900'],
    [367, 'm/d/yyyy', '1/1/1901'],
    [2958465, 'm/d/yyyy', '12/31/9999'],
    [2958465.5, 'm/d/yyyy h:mm', '12/31/9999 12:00'],
    [2958466, 'm/d/yyyy', '#######'],
    [2958465.99999, 'm/d/yyyy', '12/31/9999'],
    [2958465 + 0.99999999, 'm/d/yyyy h:mm:ss', '#######'],
    [3_000_000, 'h:mm', '#######'],
    [-1, 'm/d/yyyy', '#######'],
    [-0.0001, 'h:mm', '#######'],
    [-1, 'h:mm;-h:mm', '-0:00'],
    [1e20, 'yyyy', '#######'],
  ])('%s with %s → %j', (value, code, expected) => expect(text(value, code)).toBe(expected))

  it('marks out-of-range dates as overflow', () => {
    expect(formatValue(-1, 'm/d/yyyy')).toEqual({ text: '#######', overflow: true })
  })
})

describe('the 1904 date system', () => {
  it.each<Case>([
    [0, 'm/d/yyyy', '1/1/1904'],
    [1, 'm/d/yyyy', '1/2/1904'],
    [0, 'dddd', 'Friday'],
    [59, 'm/d/yyyy', '2/29/1904'],
    [43830, 'm/d/yyyy', '1/1/2024'],
    [43830, 'dddd', 'Monday'],
    [43830.75, 'm/d/yyyy h:mm AM/PM', '1/1/2024 6:00 PM'],
    [2957003, 'm/d/yyyy', '12/31/9999'],
    [2957004, 'm/d/yyyy', '#######'],
    [-1, 'm/d/yyyy', '#######'],
    [1.5, '[h]:mm', '36:00'],
  ])('%s with %s → %j', (value, code, expected) => expect(text(value, code, true)).toBe(expected))
})

describe('built-in date and time formats', () => {
  it.each<[number, string]>([
    [14, '1/30/2024'],
    [15, '30-Jan-24'],
    [16, '30-Jan'],
    [17, 'Jan-24'],
    [18, '6:00 PM'],
    [19, '6:00:00 PM'],
    [20, '18:00'],
    [21, '18:00:00'],
    [22, '1/30/2024 18:00'],
    [45, '00:00'],
    [46, '1087722:00:00'],
    [47, '0000.0'],
  ])('id %s → %j', (id, expected) => expect(text(EVENING, builtinFormatCode(id)!)).toBe(expected))

  it.each<[number, string]>([
    [45, '05:07'],
    [47, '0507.0'],
    [21, '18:05:07'],
  ])('id %s shows a time with seconds as %j', (id, expected) => expect(text(LATER, builtinFormatCode(id)!)).toBe(expected))
})
