/**
 * Excel date serials. In the 1900 system serial 1 is 1900-01-01 and serial 60 is 1900-02-29, a
 * day that never existed (Lotus 1-2-3 thought 1900 was a leap year and Excel kept it), so serials
 * from 61 on are one day ahead of a plain day count. The 1904 system (old Mac workbooks) counts
 * from 1904-01-01 = 0 with no such day. The fractional part is the time of day.
 */

const MS_PER_DAY = 86_400_000
/** 1899-12-30, so that serial 61 lands on 1900-03-01. */
const EPOCH_1900 = Date.UTC(1899, 11, 30)
const EPOCH_1904 = Date.UTC(1904, 0, 1)

/** Largest serial Excel shows as a date: 9999-12-31. */
export const MAX_DATE_SERIAL_1900 = 2_958_465
export const MAX_DATE_SERIAL_1904 = 2_957_003

export interface DateParts {
  year: number
  /** 1–12. */
  month: number
  /** 1–31, or 0 for serial 0 in the 1900 system (`1900-01-00`). */
  day: number
  hours: number
  minutes: number
  seconds: number
  /** Milliseconds, rounded to whole milliseconds. */
  milliseconds: number
  /** 0 = Sunday. */
  weekday: number
}

/** Whole days of a date in the 1900 or 1904 system, without the time. */
export function dateToSerial(year: number, month: number, day: number, date1904 = false): number {
  // Date.UTC normalizes overflowing months and days the way Excel's DATE does (DATE(2024,14,1)).
  const ms = Date.UTC(year, month - 1, day)
  if (date1904) return Math.round((ms - EPOCH_1904) / MS_PER_DAY)
  const serial = Math.round((ms - EPOCH_1900) / MS_PER_DAY)
  // Before 1900-03-01 the 1900 system counts one day less than a real calendar.
  return serial <= 60 ? serial - 1 : serial
}

export function timeToFraction(hours: number, minutes: number, seconds: number): number {
  return (hours * 3600 + minutes * 60 + seconds) / 86_400
}

/**
 * The calendar date and time of a serial. Returns undefined for negative serials and serials past
 * 9999-12-31, which Excel cannot show as dates.
 */
export function serialToParts(serial: number, date1904 = false): DateParts | undefined {
  if (!Number.isFinite(serial) || serial < 0) return undefined
  if (serial >= (date1904 ? MAX_DATE_SERIAL_1904 : MAX_DATE_SERIAL_1900) + 1) return undefined
  let days = Math.floor(serial)
  // Excel rounds times to the millisecond before splitting them, so 0.99999999 is still 23:59:59.999.
  let ms = Math.round((serial - days) * MS_PER_DAY)
  if (ms >= MS_PER_DAY) {
    days += 1
    ms -= MS_PER_DAY
  }
  const time = splitTime(ms)
  if (!date1904) {
    if (days === 0) return { year: 1900, month: 1, day: 0, ...time, weekday: 6 }
    if (days === 60) return { year: 1900, month: 2, day: 29, ...time, weekday: 3 }
    if (days < 60) days += 1
  }
  const date = new Date((date1904 ? EPOCH_1904 : EPOCH_1900) + days * MS_PER_DAY)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    ...time,
    // Excel's WEEKDAY carries the fake leap day too, so days before it are off by one: serial 1 is a Sunday.
    weekday: date1904 ? date.getUTCDay() : excelWeekday1900(Math.floor(serial)),
  }
}

function splitTime(ms: number): Pick<DateParts, 'hours' | 'minutes' | 'seconds' | 'milliseconds'> {
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  return { hours, minutes, seconds, milliseconds: ms % 1000 }
}

/** Excel's weekday in the 1900 system: serial 1 (1900-01-01) is a Sunday (0) in Excel. */
function excelWeekday1900(days: number): number {
  return ((days - 1) % 7 + 7) % 7
}

/** Converts a JavaScript time (ms since the Unix epoch, UTC) to a serial, keeping the time of day. */
export function epochMsToSerial(ms: number, date1904 = false): number {
  const days = (ms - (date1904 ? EPOCH_1904 : EPOCH_1900)) / MS_PER_DAY
  return date1904 || days >= 61 ? days : days - 1
}

/** Converts a serial back to ms since the Unix epoch (UTC). The 1900 fake leap day maps to 1900-03-01. */
export function serialToEpochMs(serial: number, date1904 = false): number {
  if (date1904) return EPOCH_1904 + serial * MS_PER_DAY
  return EPOCH_1900 + (serial < 61 ? serial + 1 : serial) * MS_PER_DAY
}
