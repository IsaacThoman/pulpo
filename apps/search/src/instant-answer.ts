interface AnswerText {
  expression: string
  result: string
  refreshAt?: number
}

export interface UnitConversionInput {
  amount: string
  from: string
  to: string
}

interface UnitConversionAnswer extends AnswerText {
  label: 'Unit conversion'
  conversion: UnitConversionInput
}

export type InstantAnswer = UnitConversionAnswer | (AnswerText & {
  label: 'Calculator' | 'Local time' | 'Time difference' | 'Time conversion' | 'Calendar' | 'Number conversion'
})

const decimal = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`
const signedDecimal = `[+-]?${decimal}`
const unitName = String.raw`[a-z°./]+(?:\s+[a-z°./]+){0,2}`
const unitPattern = new RegExp(String.raw`^(?:(?:convert|what is)\s+)?(${signedDecimal})\s*(${unitName})\s+(?:to|in)\s+(${unitName})\??$`, 'i')
const unitAmountPattern = new RegExp('^' + signedDecimal + '$')
const instantAnswerMaxLength = 100
const percentPattern = new RegExp(String.raw`^([+-]?${decimal})\s*%\s+of\s+([+-]?${decimal})$`, 'i')
const format = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 12 })
const minute = 60_000
const calendarDay = 24 * 60 * minute
const timeAt = /^(?:(?:what(?:'s| is) the )?(?:current |local )?time in |what time is it in )(.+?)\??$/i
const timeAtSuffix = /^(.+?) (?:local )?time(?: now)?\??$/i
const timeDifference = /^time difference between (.+?) and (.+?)\??$/i
const datePattern = '\\d{4}-\\d{2}-\\d{2}'
const dayOfWeek = new RegExp('^(?:day of (?:the )?week(?: for| on)?|what (?:day(?: of the week)?|weekday) is) (' + datePattern + ')\\??$', 'i')
const daysBetween = new RegExp('^(?:how many )?days between (' + datePattern + ') and (' + datePattern + ')\\??$', 'i')
const dateLabel = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' })
const weekdayLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' })

interface TimeZone {
  name: string
  id: string
}

const places: readonly [name: string, timeZone: string, ...aliases: string[]][] = [
  ['UTC', 'UTC', 'gmt'],
  ['New York', 'America/New_York', 'nyc', 'new york city', 'boston', 'washington dc'],
  ['Chicago', 'America/Chicago', 'austin', 'dallas', 'houston'],
  ['Denver', 'America/Denver'],
  ['Phoenix', 'America/Phoenix'],
  ['Los Angeles', 'America/Los_Angeles', 'la', 'san francisco', 'seattle', 'las vegas'],
  ['Honolulu', 'Pacific/Honolulu'],
  ['Toronto', 'America/Toronto', 'montreal'],
  ['Vancouver', 'America/Vancouver'],
  ['Mexico City', 'America/Mexico_City'],
  ['São Paulo', 'America/Sao_Paulo', 'sao paulo', 'rio de janeiro'],
  ['Buenos Aires', 'America/Argentina/Buenos_Aires'],
  ['London', 'Europe/London', 'uk'],
  ['Dublin', 'Europe/Dublin'],
  ['Paris', 'Europe/Paris'],
  ['Berlin', 'Europe/Berlin'],
  ['Rome', 'Europe/Rome'],
  ['Madrid', 'Europe/Madrid'],
  ['Amsterdam', 'Europe/Amsterdam'],
  ['Athens', 'Europe/Athens'],
  ['Istanbul', 'Europe/Istanbul'],
  ['Cairo', 'Africa/Cairo'],
  ['Johannesburg', 'Africa/Johannesburg', 'cape town'],
  ['Dubai', 'Asia/Dubai', 'abu dhabi'],
  ['Mumbai', 'Asia/Kolkata', 'delhi', 'new delhi', 'india', 'bangalore', 'bengaluru'],
  ['Kathmandu', 'Asia/Kathmandu'],
  ['Bangkok', 'Asia/Bangkok'],
  ['Singapore', 'Asia/Singapore'],
  ['Hong Kong', 'Asia/Hong_Kong'],
  ['Shanghai', 'Asia/Shanghai', 'beijing', 'china'],
  ['Seoul', 'Asia/Seoul'],
  ['Tokyo', 'Asia/Tokyo', 'japan', 'osaka'],
  ['Sydney', 'Australia/Sydney', 'melbourne'],
  ['Brisbane', 'Australia/Brisbane'],
  ['Perth', 'Australia/Perth'],
  ['Auckland', 'Pacific/Auckland', 'wellington'],
]

const timeZones = new Map<string, TimeZone>()
for (const [name, id, ...aliases] of places) {
  timeZones.set(name.toLowerCase(), { name, id })
  for (const alias of aliases) {
    // Show the requested place, even where several cities share one IANA zone.
    const label = ['gmt', 'nyc', 'la', 'uk', 'sao paulo'].includes(alias)
      ? name
      : alias.replace(/\b[a-z]/g, letter => letter.toUpperCase()).replace(/ Dc$/, ' DC')
    timeZones.set(alias, { name: label, id })
  }
}

function lookupTimeZone(location: string): TimeZone | undefined {
  const place = location.trim().replace(/\s+/g, ' ')
  const known = timeZones.get(place.toLowerCase())
  if (known) return known
  if (!/^[a-z_]+(?:\/[a-z0-9_+-]+)+$/i.test(place)) return
  try {
    const id = new Intl.DateTimeFormat('en-US', { timeZone: place }).resolvedOptions().timeZone
    const name = id.startsWith('Etc/') ? id : id.split('/').at(-1)!.replaceAll('_', ' ')
    return { name, id }
  } catch {
    return
  }
}

function nextMinute(now: Date) {
  return (Math.floor(now.getTime() / minute) + 1) * minute
}

function offsetAt(zone: TimeZone, now: Date) {
  const label = new Intl.DateTimeFormat('en-US', { timeZone: zone.id, timeZoneName: 'longOffset' })
    .formatToParts(now).find(part => part.type === 'timeZoneName')?.value
  if (label === 'GMT') return 0
  const offset = /^GMT([+-])(\d{2}):(\d{2})$/.exec(label ?? '')
  return offset ? (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3])) : undefined
}

function convertTime(expression: string, now: Date): InstantAnswer | undefined {
  const match = /^(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm))?\s+(?:in\s+)?(.+?)\s+to\s+(.+?)(?:\s+on\s+(\d{4}-\d{2}-\d{2}))?\??$/i.exec(expression)
  if (!match) return
  const [, hourText, minuteText, period, source, destination, dateText] = match
  const from = lookupTimeZone(source)
  const to = lookupTimeZone(destination)
  const clockHour = Number(hourText)
  const minutes = Number(minuteText ?? '0')
  if (!from || !to || minutes > 59) return
  if (period ? clockHour < 1 || clockHour > 12 : !minuteText || clockHour > 23) return
  const hours = period ? clockHour % 12 + (period.toLowerCase() === 'pm' ? 12 : 0) : clockHour
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: from.id, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const { year, month, day } = Object.fromEntries(parts.map(part => [part.type, part.value]))
  const date = calendarDate(dateText ?? [year, month, day].join('-'))
  if (!date) return
  const wallTime = date.getTime() + (hours * 60 + minutes) * minute
  const offsets = new Set([-calendarDay, 0, calendarDay]
    .map(delta => offsetAt(from, new Date(wallTime + delta))).filter(offset => offset !== undefined))
  if (!offsets.size) return
  const instants = [...offsets].flatMap(offset => {
    const instant = new Date(wallTime - offset * minute)
    return offsetAt(from, instant) === offset ? [instant] : []
  })
  const describe = (zone: TimeZone, instant: Date) => new Intl.DateTimeFormat('en-US', {
    timeZone: zone.id, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(instant)
  if (instants.length !== 1) return {
    label: 'Time conversion',
    expression: from.name + ' · ' + dateLabel.format(date),
    result: instants.length ? 'This time occurs twice when clocks change' : 'This local time is skipped when clocks change',
  }
  return {
    label: 'Time conversion',
    expression: from.name + ' · ' + describe(from, instants[0]),
    result: to.name + ' · ' + describe(to, instants[0]),
    ...(dateText ? {} : { refreshAt: nextMinute(now) }),
  }
}

function timeAnswer(expression: string, now: Date): InstantAnswer | undefined {
  if (!Number.isFinite(now.getTime())) return
  const converted = convertTime(expression, now)
  if (converted) return converted
  const comparison = timeDifference.exec(expression)
  if (comparison) {
    const from = lookupTimeZone(comparison[1])
    const to = lookupTimeZone(comparison[2])
    if (!from || !to) return
    const fromOffset = offsetAt(from, now)
    const toOffset = offsetAt(to, now)
    if (fromOffset === undefined || toOffset === undefined) return
    const difference = fromOffset - toOffset
    const hours = Math.floor(Math.abs(difference) / 60)
    const minutes = Math.abs(difference) % 60
    const duration = [hours && hours + (hours === 1 ? ' hour' : ' hours'), minutes && minutes + (minutes === 1 ? ' minute' : ' minutes')].filter(Boolean).join(' ')
    return {
      label: 'Time difference',
      expression: from.name + ' compared with ' + to.name,
      result: difference ? duration + (difference > 0 ? ' ahead' : ' behind') : 'Same local time',
      refreshAt: nextMinute(now),
    }
  }
  const match = timeAt.exec(expression) ?? timeAtSuffix.exec(expression)
  const zone = match && lookupTimeZone(match[1])
  if (!zone) return
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone.id, hour: 'numeric', minute: '2-digit', hour12: true, weekday: 'long', month: 'long', day: 'numeric', timeZoneName: 'short',
  }).formatToParts(now)
  const { hour, minute: minuteOfHour, dayPeriod, weekday, month, day, timeZoneName } =
    Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return {
    label: 'Local time',
    expression: zone.name + ' · ' + weekday + ', ' + month + ' ' + day + ' · ' + timeZoneName,
    result: hour + ':' + minuteOfHour + ' ' + dayPeriod,
    refreshAt: nextMinute(now),
  }
}

function calendarDate(value: string) {
  if (value.startsWith('0000-')) return
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : undefined
}

function calendarAnswer(expression: string): InstantAnswer | undefined {
  const offset = /^(\d{1,6}) days? (after|before) (.+?)\??$/i.exec(expression)
  if (offset) {
    const [, amount, direction, dateText] = offset
    const named = /^([a-z]+) (\d{1,2}),? (\d{4})$/i.exec(dateText)
    const names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
    const name = named?.[1].toLowerCase()
    const month = names.findIndex(item => item === name || item.slice(0, 3) === name) + 1
    const date = calendarDate(named && month ? named[3] + '-' + String(month).padStart(2, '0') + '-' + named[2].padStart(2, '0') : dateText)
    if (!date) return
    const result = new Date(date.getTime() + Number(amount) * calendarDay * (direction.toLowerCase() === 'before' ? -1 : 1))
    if (result.getUTCFullYear() < 1 || result.getUTCFullYear() > 9999) return
    return { label: 'Calendar', expression, result: dateLabel.format(result) }
  }
  const weekday = dayOfWeek.exec(expression)
  if (weekday) {
    const date = calendarDate(weekday[1])
    if (date) return { label: 'Calendar', expression: dateLabel.format(date), result: weekdayLabel.format(date) }
  }
  const range = daysBetween.exec(expression)
  if (range) {
    const start = calendarDate(range[1])
    const end = calendarDate(range[2])
    if (!start || !end) return
    const days = Math.abs(end.getTime() - start.getTime()) / calendarDay
    return {
      label: 'Calendar',
      expression: dateLabel.format(start) + ' to ' + dateLabel.format(end),
      result: format.format(days) + (days === 1 ? ' day' : ' days'),
    }
  }
}

interface Unit {
  dimension: string
  id: string
  factor: number
  offset: number
  label: string
}

const units = new Map<string, Unit>()
function unit(dimension: string, factor: number, label: string, aliases: [string, ...string[]], offset = 0) {
  const definition = { dimension, id: aliases[0], factor, offset, label }
  for (const alias of aliases) units.set(alias, definition)
}

unit('length', .001, 'mm', ['mm', 'millimeter', 'millimeters'])
unit('length', .01, 'cm', ['cm', 'centimeter', 'centimeters'])
unit('length', 1, 'm', ['m', 'meter', 'meters', 'metre', 'metres'])
unit('length', 1000, 'km', ['km', 'kilometer', 'kilometers', 'kilometre', 'kilometres'])
unit('length', .0254, 'in', ['in', 'inch', 'inches'])
unit('length', .3048, 'ft', ['ft', 'foot', 'feet'])
unit('length', .9144, 'yd', ['yd', 'yard', 'yards'])
unit('length', 1609.344, 'mi', ['mi', 'mile', 'miles'])
unit('mass', .001, 'g', ['g', 'gram', 'grams'])
unit('mass', 1, 'kg', ['kg', 'kilogram', 'kilograms'])
unit('mass', .45359237, 'lb', ['lb', 'lbs', 'pound', 'pounds'])
unit('mass', .028349523125, 'oz', ['oz', 'ounce', 'ounces'])
unit('volume', .001, 'mL', ['ml', 'milliliter', 'milliliters'])
unit('volume', 1, 'L', ['l', 'liter', 'liters', 'litre', 'litres'])
unit('volume', 3.785411784, 'US gal', [
  'gal', 'gallon', 'gallons', 'us gal', 'us gallon', 'us gallons', 'us liquid gallon', 'us liquid gallons',
  'u.s. gal', 'u.s. gallon', 'u.s. gallons', 'u.s. liquid gallon', 'u.s. liquid gallons',
])
unit('temperature', 1, '°C', ['c', '°c', 'celsius'])
unit('temperature', 5 / 9, '°F', ['f', '°f', 'fahrenheit'], -160 / 9)
unit('temperature', 1, 'K', ['k', 'kelvin'], -273.15)
unit('duration', .001, 'ms', ['ms', 'millisecond', 'milliseconds'])
unit('duration', 1, 's', ['s', 'sec', 'second', 'seconds'])
unit('duration', 60, 'min', ['min', 'minute', 'minutes'])
unit('duration', 3600, 'h', ['h', 'hr', 'hour', 'hours'])
unit('duration', 86400, 'days', ['day', 'days'])
unit('speed', 1, 'm/s', ['m/s', 'mps'])
unit('speed', 1000 / 3600, 'km/h', ['km/h', 'kmh', 'kph'])
unit('speed', 1609.344 / 3600, 'mph', ['mph', 'mi/h'])
unit('speed', 1852 / 3600, 'kn', ['kn', 'kt', 'kts', 'knot', 'knots'])

const canonicalUnits = [...new Set(units.values())]

export function compatibleUnits(unitId: string) {
  const dimension = units.get(unitId.toLowerCase())?.dimension
  return canonicalUnits.filter(unit => unit.dimension === dimension).map(({ id, label }) => ({ id, label }))
}

export function evaluateUnitConversion(input: UnitConversionInput): UnitConversionAnswer | undefined {
  const amount = input.amount.trim()
  const from = units.get(input.from.toLowerCase())
  const to = units.get(input.to.toLowerCase())
  if (!from || !to || from.dimension !== to.dimension || !unitAmountPattern.test(amount)) return
  if (amount.length + from.id.length + to.id.length + 5 > instantAnswerMaxLength) return
  const value = Number(amount)
  const result = from === to ? value : (value * from.factor + from.offset - to.offset) / to.factor
  if (!Number.isFinite(result)) return
  return {
    label: 'Unit conversion',
    expression: format.format(value) + ' ' + from.label,
    result: format.format(result) + ' ' + to.label,
    conversion: { amount, from: from.id, to: to.id },
  }
}

const operators: Record<string, [number, (left: number, right: number) => number]> = {
  '+': [1, (left, right) => left + right],
  '-': [1, (left, right) => left - right],
  '*': [2, (left, right) => left * right],
  '/': [2, (left, right) => left / right],
  '^': [3, (left, right) => left ** right],
}

export const calculatorMaxLength = 100
export type CalculatorAngle = 'degrees' | 'radians'

const scientificNumber = '(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?'
const numberToken = new RegExp('^' + scientificNumber + '$')

const calculatorFunctions = {
  sqrt: Math.sqrt,
  log: Math.log10,
  ln: Math.log,
  abs: Math.abs,
  exp: Math.exp,
  sin: (value: number, angle: CalculatorAngle) => trig('sin', value, angle),
  cos: (value: number, angle: CalculatorAngle) => trig('cos', value, angle),
  tan: (value: number, angle: CalculatorAngle) => trig('tan', value, angle),
}

function trig(operator: 'sin' | 'cos' | 'tan', value: number, angle: CalculatorAngle) {
  const turns = value / (angle === 'degrees' ? 90 : Math.PI / 2)
  if (Number.isSafeInteger(turns)) {
    const quadrant = ((turns % 4) + 4) % 4
    if (operator === 'tan') return quadrant % 2 ? NaN : 0
    return (operator === 'sin' ? [0, 1, 0, -1] : [1, 0, -1, 0])[quadrant]
  }
  return Math[operator](angle === 'degrees' ? value * (Math.PI / 180) : value)
}

function factorial(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 170) return NaN
  let result = 1
  for (let factor = 2; factor <= value; factor++) result *= factor
  return result
}

export function formatCalculation(value: number) {
  return format.format(Object.is(value, -0) ? 0 : value)
}

export function initialCalculatorAngle(expression: string): CalculatorAngle {
  return /(?:π|\bpi\b)/i.test(expression) ? 'radians' : 'degrees'
}

export function evaluateCalculation(input: string, angle: CalculatorAngle = 'degrees'): number | undefined {
  if (input.length > calculatorMaxLength) return
  const expression = input.trim().toLowerCase().replaceAll('×', '*').replaceAll('÷', '/').replaceAll('−', '-')
  const percent = percentPattern.exec(expression)
  if (percent) {
    const value = Number(percent[1]) / 100 * Number(percent[2])
    return Number.isFinite(value) ? value : undefined
  }
  const pattern = new RegExp(scientificNumber + '|[a-z]+|[π!%()+*/^-]|\\s+', 'gy')
  const tokens: string[] = []
  let position = 0
  while (position < expression.length) {
    const match = pattern.exec(expression)
    if (!match) return
    if (match[0].trim()) tokens.push(match[0])
    position = pattern.lastIndex
  }
  let next = 0
  function parse(minimum: number): number {
    const token = tokens[next++]
    let left: number
    if (token === '+' || token === '-') {
      left = (token === '-' ? -1 : 1) * parse(3)
    } else if (token === '(') {
      left = parse(1)
      if (tokens[next++] !== ')') return NaN
    } else if (token === 'pi' || token === 'π') {
      left = Math.PI
    } else if (token === 'e') {
      left = Math.E
    } else if (token && Object.hasOwn(calculatorFunctions, token)) {
      if (tokens[next++] !== '(') return NaN
      const argument = parse(1)
      if (tokens[next++] !== ')' || !Number.isFinite(argument)) return NaN
      left = calculatorFunctions[token as keyof typeof calculatorFunctions](argument, angle)
    } else {
      left = token && numberToken.test(token) ? Number(token) : NaN
    }
    while (next < tokens.length) {
      if (!Number.isFinite(left)) return NaN
      const operator = tokens[next]
      if (operator === '!' || operator === '%') {
        next++
        left = operator === '!' ? factorial(left) : left / 100
        if (tokens[next] === '!' || tokens[next] === '%') return NaN
        continue
      }
      const definition = Object.hasOwn(operators, operator) ? operators[operator] : undefined
      if (!definition || definition[0] < minimum) break
      next++
      const [precedence, apply] = definition
      const right = parse(operator === '^' ? precedence : precedence + 1)
      if (!Number.isFinite(right)) return NaN
      left = apply(left, right)
    }
    return left
  }
  const value = parse(1)
  return next === tokens.length && Number.isFinite(value) ? value : undefined
}

function calculationAnswer(query: string): InstantAnswer | undefined {
  if (/^(?:scientific )?calculator$/i.test(query)) return { label: 'Calculator', expression: query, result: '0' }
  const explicit = /^calculate\s+/i
  const expression = query.replace(explicit, '')
  // Preserve ordinary numeric, date, and version lookups unless the query requests a calculation.
  if (!explicit.test(query) && (/^\d+(?:-\d+){2,}$/.test(query) || /^\d+\/\d+\/\d+$/.test(query)
    || !/(?:[\d.)π]|\b(?:pi|e)\b)\s*[+*/^%!×÷−-]|\b(?:sqrt|log|ln|abs|exp|sin|cos|tan)\s*\(/i.test(query))) return
  const value = evaluateCalculation(expression, initialCalculatorAngle(expression))
  if (value !== undefined) return { label: 'Calculator', expression, result: formatCalculation(value) }
}

const romanValues = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'],
  [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
] as const

function asRoman(value: number) {
  if (value < 1 || value > 3999) return ''
  let text = ''
  for (const [amount, symbol] of romanValues) {
    text += symbol.repeat(Math.floor(value / amount))
    value %= amount
  }
  return text
}

function numericConversion(expression: string): InstantAnswer | undefined {
  const roman = /^(?:what is )?roman numerals? (?:for|of) (\d{1,4})\??$/i.exec(expression)
    ?? /^(\d{1,4}) (?:in|to) roman numerals?\??$/i.exec(expression)
  const fromRoman = /^(?:what is )?([ivxlcdm]+) (?:to|in) (?:decimal|arabic numerals?)\??$/i.exec(expression)
  let result = roman ? asRoman(Number(roman[1])) : ''
  if (fromRoman) {
    const text = fromRoman[1].toUpperCase()
    let value = 0
    let rest = text
    for (const [amount, symbol] of romanValues) {
      while (rest.startsWith(symbol)) {
        value += amount
        rest = rest.slice(symbol.length)
      }
    }
    if (!rest && asRoman(value) === text) result = format.format(value)
  }
  const base = /^(0x[\da-f]+|0b[01]+|0o[0-7]+|\d+) (?:in|to) (decimal|binary|hex(?:adecimal)?|octal)$/i.exec(expression)
  if (base) {
    const value = BigInt(base[1].toLowerCase())
    const target = base[2].toLowerCase()
    if (target === 'decimal') result = value.toString(10)
    if (target === 'binary') result = '0b' + value.toString(2)
    if (target.startsWith('hex')) result = '0x' + value.toString(16)
    if (target === 'octal') result = '0o' + value.toString(8)
  }
  if (result) return { label: 'Number conversion', expression, result }
}

export function instantAnswer(query: string, now = new Date()): InstantAnswer | undefined {
  const expression = query.trim()
  if (!expression || expression.length > instantAnswerMaxLength) return
  const direct = timeAnswer(expression, now) ?? calendarAnswer(expression) ?? numericConversion(expression)
  if (direct) return direct
  const conversion = unitPattern.exec(expression)
  if (conversion) {
    return evaluateUnitConversion({ amount: conversion[1], from: conversion[2].replace(/\s+/g, ' '), to: conversion[3].replace(/\s+/g, ' ') })
  }
  return calculationAnswer(expression)
}
