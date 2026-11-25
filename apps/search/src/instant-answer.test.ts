import { describe, expect, it } from 'vitest'
import { compatibleUnits, evaluateCalculation, evaluateUnitConversion, instantAnswer } from './instant-answer'

describe('local instant answers', () => {
  it.each([
    ['18.5% of 249', '46.065'],
    ['(45 * 2) / (5 + 10)', '6'],
    ['2^3^2', '512'],
    ['-2^2', '-4'],
    ['-2^2 + 1', '-3'],
    ['4 × (3 + 2)', '20'],
    ['20 celsius to fahrenheit', '68 °F'],
    ['37 mph to km/h', '59.545728 km/h'],
    ['2.54 cm in inches', '1 in'],
    ['roman numeral for 49', 'XLIX'],
    ['XLIX in decimal', '49'],
    ['0xff to decimal', '255'],
    ['42 in binary', '0b101010'],
    ['45 days after November 24 2026', 'January 8, 2027'],
    ['1 day before 2024-03-01', 'February 29, 2024'],
    ['sqrt(81) + 2^3', '17'],
    ['cos(60)', '0.5'],
    ['sin(pi / 2)', '1'],
    ['5!', '120'],
    ['calculate 100', '100'],
  ])('handles %s', (query, value) => {
    expect(instantAnswer(query)?.result).toBe(value)
  })

  it.each(['2026-11-24', '11/24/2026', '1.2.3', '1 / 0', '2 * (3', '(1 + 2)3', '2 kg to cm', '2 USD to EUR', 'C++ calculator'])(
    'leaves %s as a web search', query => expect(instantAnswer(query)).toBeUndefined(),
  )
})

describe('editable calculator expressions', () => {
  it('can open a basic or scientific calculator without an expression', () => {
    expect(instantAnswer('calculator')).toMatchObject({ label: 'Calculator', expression: 'calculator' })
    expect(instantAnswer('scientific calculator')).toMatchObject({ label: 'Calculator', expression: 'scientific calculator' })
    expect(instantAnswer('calculator download')).toBeUndefined()
  })

  it.each([
    ['3e2 + .5 - 1.', 299.5],
    ['sqrt(abs(-25))', 5],
    ['7 + 25%', 7.25],
    ['ln(e) + log(100)', 3],
    ['sin(180) + cos(90)', 0],
    ['-3! + 2^-2', -5.75],
  ])('evaluates %s', (query, result) => {
    expect(evaluateCalculation(query)).toBeCloseTo(result, 12)
  })

  it('supports explicit angle units', () => {
    expect(evaluateCalculation('sin(pi / 2)', 'radians')).toBe(1)
    expect(evaluateCalculation('cos(pi)', 'radians')).toBe(-1)
    expect(evaluateCalculation('cos(pi)', 'degrees')).toBeCloseTo(0.9985, 4)
  })

  it.each(['tan(90)', 'sqrt(-1)^0', '1/(1/0)', '171!', '2.5!', '3!!', 'log(0)', '2 +', 'sin(1, 2)', 'constructor(0)', '(() => 1)()', '1'.repeat(101)])(
    'rejects invalid math: %s', query => expect(evaluateCalculation(query)).toBeUndefined(),
  )
})

describe('editable unit conversions', () => {
  it('shares canonical unit values when the query uses natural-language aliases', () => {
    expect(instantAnswer('What is 5 miles in kilometers?')).toMatchObject({
      label: 'Unit conversion', expression: '5 mi', result: '8.04672 km',
      conversion: { amount: '5', from: 'mi', to: 'km' },
    })
    expect(instantAnswer('convert 37 mi/h to kmh')?.result).toBe('59.545728 km/h')
    expect(instantAnswer('How to convert 37 mph to km/h')).toBeUndefined()
  })

  it('offers each compatible unit once and preserves affine conversion in either direction', () => {
    expect(compatibleUnits('fahrenheit')).toEqual([
      { id: 'c', label: '°C' }, { id: 'f', label: '°F' }, { id: 'k', label: 'K' },
    ])
    expect(evaluateUnitConversion({ amount: '32', from: 'f', to: 'c' })?.result).toBe('0 °C')
    expect(evaluateUnitConversion({ amount: '-40', from: 'c', to: 'f' })?.result).toBe('-40 °F')
    expect(evaluateUnitConversion({ amount: '5', from: 'km', to: 'km' })?.result).toBe('5 km')
  })

  it('requires a finite decimal and compatible dimensions', () => {
    expect(evaluateUnitConversion({ amount: '5', from: 'km', to: 'kg' })).toBeUndefined()
    for (const amount of ['', '1e3', '5 apples', '1,000', '0x10', '1'.repeat(100)]) {
      expect(evaluateUnitConversion({ amount, from: 'km', to: 'mi' })).toBeUndefined()
    }
  })
})

describe('local time and dates', () => {
  const winter = new Date('2026-11-24T16:05:34.250Z')
  const summer = new Date('2026-07-01T16:05:34.250Z')

  it('shows the destination date after crossing midnight and refreshes at the next minute', () => {
    expect(instantAnswer('time in Tokyo', winter)).toEqual({
      label: 'Local time',
      expression: 'Tokyo · Wednesday, November 25 · GMT+9',
      result: '1:05 AM',
      refreshAt: Date.parse('2026-11-24T16:06:00.000Z'),
    })
  })

  it.each([
    ['current time in NYC?', '11:05 AM'],
    ['time in America/New_York', '11:05 AM'],
    ['time in Kathmandu', '9:50 PM'],
    ['London time now', '4:05 PM'],
    ['what time is it in UTC?', '4:05 PM'],
  ])('recognizes %s', (query, result) => {
    expect(instantAnswer(query, winter)?.result).toBe(result)
  })

  it('uses the IANA zones for DST and fractional hour differences', () => {
    expect(instantAnswer('time in New York', summer)?.result).toBe('12:05 PM')
    expect(instantAnswer('time difference between Kathmandu and Tokyo', winter)?.result).toBe('3 hours 15 minutes behind')
    expect(instantAnswer('time difference between London and UTC', winter)?.result).toBe('Same local time')
    expect(instantAnswer('time difference between London and UTC', summer)?.result).toBe('1 hour ahead')
  })

  it('converts wall times across midnight using each location’s DST rules', () => {
    const converted = instantAnswer('3pm New York to Tokyo', winter)
    expect(converted?.expression).toMatch(/New York.*Nov 24.*3:00 PM EST/)
    expect(converted?.result).toMatch(/Tokyo.*Nov 25.*5:00 AM GMT\+9/)
    expect(instantAnswer('3pm in New York to Tokyo', summer)?.result).toMatch(/4:00 AM/)
    expect(instantAnswer('15:00 New York to Tokyo', winter)?.result).toBe(converted?.result)
    expect(instantAnswer('2:30 am New York to Tokyo on 2026-03-08', winter)?.result).toMatch(/skipped/)
    expect(instantAnswer('1:30 am New York to Tokyo on 2026-11-01', winter)?.result).toMatch(/occurs twice/)
  })

  it.each([
    ['day of week 2026-11-24', 'Tuesday'],
    ['what day of the week is 2024-02-29?', 'Thursday'],
    ['days between 2024-02-28 and 2024-03-01', '2 days'],
    ['days between 2026-11-24 and 2027-01-01', '38 days'],
    ['days between 2026-11-25 and 2026-11-24', '1 day'],
    ['days between 2026-11-24 and 2026-11-24', '0 days'],
  ])('does calendar arithmetic for %s', (query, result) => {
    const answer = instantAnswer(query)
    expect(answer).toMatchObject({ label: 'Calendar', result })
    expect(answer?.refreshAt).toBeUndefined()
  })

  it.each([
    'time in Tokyo hotels',
    'time in Asia/Unknown',
    'time in PST',
    'time difference between France and Mars',
    'day of week 2026-02-29',
    'day of week 0000-01-01',
    'days between 2026-11-31 and 2027-01-01',
  ])('leaves ambiguous or invalid input to regular search: %s', (query) => {
    expect(instantAnswer(query, winter)).toBeUndefined()
  })
})
