import { describe, expect, it } from 'vitest'
import { Errors } from '../formula/types.js'
import { builtinFormatCode, formatGeneral, formatValue, isDateFormat, numberFormatKind, numberToText, roundNumber } from './index.js'

/** [value, code, text]: expected outputs are what Excel shows. */
type Case = [number, string, string]

const text = (value: number | string, code: string) => formatValue(value, code).text

describe('digit placeholders and rounding', () => {
  it.each<Case>([
    [0, '0', '0'],
    [1, '0', '1'],
    [1.5, '0', '2'],
    [2.5, '0', '3'],
    [-2.5, '0', '-3'],
    [0.5, '0', '1'],
    [0.49, '0', '0'],
    [-0.4, '0', '-0'],
    [1234.5678, '0.00', '1234.57'],
    [1.005, '0.00', '1.01'],
    [1.0049, '0.00', '1.00'],
    [0.125, '0.00', '0.13'],
    [2.675, '0.00', '2.68'],
    [1.45, '0.0', '1.5'],
    [8.345, '0.00', '8.35'],
    [1e15, '0', '1000000000000000'],
    [Number('123456789012345678'), '0', '123456789012346000'],
    [0.1 + 0.2, '0.00000000000000000', '0.30000000000000000'],
    [1 / 3, '0.000000000000000000', '0.333333333333333000'],
    [-1234.5, '0.0', '-1234.5'],
    [5, '00000', '00005'],
    [123456, '000', '123456'],
    [0.5, '#', '1'],
    [0.4, '#', ''],
    [0, '#', ''],
    [0, '#.##', '.'],
    [0.5, '#.##', '.5'],
    [1.5, '#.##', '1.5'],
    [1, '#.##', '1.'],
    [1, '0.##', '1.'],
    [1.25, '0.0#', '1.25'],
    [1.2, '0.0#', '1.2'],
    [1, '0.0#', '1.0'],
    [1.5, '?.??', '1.5 '],
    [12.5, '??.??', '12.5 '],
    [1.5, '??.??', ' 1.5 '],
    [0.5, '?.??', ' .5 '],
    [1.25, '0.0?', '1.25'],
    [0, '0.00', '0.00'],
    [-0, '0.00', '0.00'],
    [12.5, '.00', '12.50'],
    [0.5, '.00', '.50'],
    [0.123, '.0', '.1'],
    [0.999, '0.00', '1.00'],
    [9.999, '0.00', '10.00'],
    [-0.001, '0.00', '-0.00'],
    [123.456, '0000.0000', '0123.4560'],
    [1e-10, '0.00', '0.00'],
    [1e300, '0.0E+0', '1.0E+300'],
    [5, '0.', '5.'],
    [0.000123, '0.000000', '0.000123'],
    [99.5, '#', '100'],
  ])('%s with %s → %j', (value, code, expected) => expect(text(value, code)).toBe(expected))
})

describe('thousands separators and scaling', () => {
  it.each<Case>([
    [1234567.891, '#,##0', '1,234,568'],
    // A comma before any placeholder is just a comma.
    [1234567, ',#', ',1234567'],
    [-1234567, ',0', '-,1234567'],
    [1234567.891, '#,##0.00', '1,234,567.89'],
    [-1234567, '#,##0', '-1,234,567'],
    [999, '#,##0', '999'],
    [1000, '#,##0', '1,000'],
    [0, '#,##0', '0'],
    [0, '#,###', ''],
    [5, '0,000', '0,005'],
    [1234, '#,#', '1,234'],
    [123456789, '#,##0', '123,456,789'],
    [1e15, '#,##0', '1,000,000,000,000,000'],
    [0.5, '#,##0.00', '0.50'],
    [12345.678, '#,##0.0', '12,345.7'],
    [1234, '0,0', '1,234'],
    [999.999, '#,##0.00', '1,000.00'],
    [1234567, '#,##0,', '1,235'],
    [1234567, '0,', '1235'],
    [1234567, '0,,', '1'],
    [1234567, '0.0,,', '1.2'],
    [1234567, '0.00,,"M"', '1.23M'],
    [1500, '0.0,"K"', '1.5K'],
    [1500, '0.0,K', '1.5K'],
    [123, '0,', '0'],
    [499, '0,', '0'],
    [500, '0,', '1'],
    [1234567890, '#,##0,,', '1,235'],
    [1234567890, '0,,,', '1'],
    [1e12, '0,,,," T"', '1 T'],
    [-1500, '0.0,', '-1.5'],
    [1234567, '#,##0.0,,', '1.2'],
    [1234567, '#,##0,," M"', '1 M'],
    [12345678, '#,##0,', '12,346'],
  ])('%s with %s → %j', (value, code, expected) => expect(text(value, code)).toBe(expected))
})

describe('percent', () => {
  it.each<Case>([
    [0.256, '0%', '26%'],
    [0.256, '0.0%', '25.6%'],
    [1, '0%', '100%'],
    [-0.05, '0%', '-5%'],
    [0.0005, '0.0%', '0.1%'],
    [0.123, '0%%', '1230%%'],
    [12.345, '#,##0%', '1,235%'],
    [0.5, '%0', '%50'],
    [0.07, '0%', '7%'],
    [0.29, '0.00%', '29.00%'],
    [1.15, '0%', '115%'],
    [0, '0%', '0%'],
    [0.005, '0%', '1%'],
    [0.1 + 0.2, '0.000000000000%', '30.000000000000%'],
    [-0.256, '0.0%;(0.0%)', '(25.6%)'],
  ])('%s with %s → %j', (value, code, expected) => expect(text(value, code)).toBe(expected))
})

describe('scientific', () => {
  it.each<Case>([
    [12345, '0.00E+00', '1.23E+04'],
    [0.00012345, '0.00E+00', '1.23E-04'],
    [0, '0.00E+00', '0.00E+00'],
    [1, '0.00E+00', '1.00E+00'],
    [-12345, '0.00E+00', '-1.23E+04'],
    [12345, '0.00E-00', '1.23E04'],
    [0.00012345, '0.00E-00', '1.23E-04'],
    [12345, '0E+0', '1E+4'],
    [9.999, '0.00E+00', '1.00E+01'],
    [1e100, '0.00E+00', '1.00E+100'],
    [1.5e-300, '0.0E+00', '1.5E-300'],
    [12345, '##0.0E+0', '12.3E+3'],
    [1234567, '##0.0E+0', '1.2E+6'],
    [123, '##0.0E+0', '123.0E+0'],
    [0.001, '##0.0E+0', '1.0E-3'],
    [0.0001, '##0.0E+0', '100.0E-6'],
    [999960, '##0.0E+0', '1.0E+6'],
    [12345, '000.0E+00', '012.3E+03'],
    [12345, '0.00E+000', '1.23E+004'],
    [12345, '#.##E+00', '1.23E+04'],
    [1.5, '0.00E+00 "x"', '1.50E+00 x'],
    [1234.5, '0.0e+00', '1.2E+03'],
    [6.02214076e23, '0.000E+00', '6.022E+23'],
    [0.1 + 0.2, '0.00000000000000E+00', '3.00000000000000E-01'],
  ])('%s with %s → %j', (value, code, expected) => expect(text(value, code)).toBe(expected))
})

describe('fractions', () => {
  it.each<Case>([
    [1.5, '# ?/?', '1 1/2'],
    [0.5, '# ?/?', ' 1/2'],
    [0, '# ?/?', '0    '],
    [2, '# ?/?', '2    '],
    [-1.5, '# ?/?', '-1 1/2'],
    [-0.5, '# ?/?', '- 1/2'],
    [1.25, '# ?/?', '1 1/4'],
    [0.3, '# ?/?', ' 2/7'],
    [0.333, '# ?/?', ' 1/3'],
    [3.14159265358979, '# ??/??', '3 14/99'],
    [3.14159265358979, '# ???/???', '3  16/113'],
    [1.5, '# ??/??', '1  1/2 '],
    [0.75, '# ??/??', '  3/4 '],
    [0.99, '# ?/?', '1    '],
    [1.999, '# ?/?', '2    '],
    [1.5, '?/?', '3/2'],
    [0, '?/?', '0/1'],
    [2.75, '?/?', '11/4'],
    [5, '?/?', '5/1'],
    [0.5, '?/8', '4/8'],
    [0.3, '# ?/8', ' 2/8'],
    [1.3, '# ?/8', '1 2/8'],
    [0.5, '# ??/16', '  8/16'],
    [0.33, '0/100', '33/100'],
    [1.5, '# ??/100', '1 50/100'],
    [1.01, '# ??/100', '1  1/100'],
    [0.0001, '# ?/?', '0    '],
    [0.125, '# ???/???', '   1/8  '],
    [1.5, '0 ?/?', '1 1/2'],
    [0.5, '0 ?/?', '0 1/2'],
    [1.5, '# ?/? "in"', '1 1/2 in'],
    [2, '# ?/? "in"', '2     in'],
    [0.5, '# ?/2', ' 1/2'],
    [12.6, '# ?/4', '12 2/4'],
    [0.875, '# ?/?', ' 7/8'],
    [0.1, '# ??/??', '  1/10'],
    [1 / 3, '# ?/3', ' 1/3'],
    [7.5, '#,##0 ?/?', '7 1/2'],
    // Excel's results from POI's NumberFormatTests.xlsx: literals around the slash, improper
    // fractions, and how a zero whole number or fraction shows.
    [23.75, '|#\\:#=/=?|', '|23:3=/=4|'],
    [0.75, '|#\\:#/#|', '|3/4|'],
    [1, '|#\\:#/#|', '|1|'],
    [0, '|#\\:#=/=?|', '|0      |'],
    [0.75, '|?\\:?=/=?|', '|  3=/=4|'],
    [0.75, '|0\\:0=/=0|', '|0:3=/=4|'],
    [0, '|0\\:0=/=0|', '|0:0=/=1|'],
    [0, '|#\\:0=/=#|', '|0=/=1|'],
    [0, '|?\\:0=/=#|', '|0:0=/=1|'],
    [3.75, '|#_#/#|', '|15 /4|'],
    [23.75, '|#-#-#\\:#/#|', '|-2-3:3/4|'],
    [0, '|#\\:? ?=/=#|', '|:0      |'],
    [23.75, '|#\\:? ?0#/000', '|2:3  03/004'],
  ])('%s with %s → %j', (value, code, expected) => expect(text(value, code)).toBe(expected))
})

describe('literal text', () => {
  it.each<Case>([
    [5, '"Total: "0', 'Total: 5'],
    [5, '0 "units"', '5 units'],
    [5, '\\$0', '$5'],
    [5, '$0', '$5'],
    [-5, '$0', '-$5'],
    [-5, '"$"#,##0.00', '-$5.00'],
    [5, '0_)', '5 '],
    [5, '_(0_)', ' 5 '],
    [5, '(0)', '(5)'],
    [5, '0\\m', '5m'],
    [5, '+0', '+5'],
    [-5, '+0;-0', '-5'],
    [5, "0 ~ ^ & ' { } < > = !", "5 ~ ^ & ' { } < > = !"],
    [5, '0:0', '0:5'],
    [123, '0-0', '12-3'],
    [5551234, '000-0000', '555-1234'],
    [123456789, '000-00-0000', '123-45-6789'],
    [5551234567, '(000) 000-0000', '(555) 123-4567'],
    [12, '000-0000', '000-0012'],
    [1234567890, '000-0000', '123456-7890'],
    [5, '"a;b"0', 'a;b5'],
    [5, '0 "[x]"', '5 [x]'],
    [5, '"zero"', 'zero'],
    [-5, '"zero"', '-zero'],
    [5, '0 "%"', '5 %'],
    [0.05, '0\\%', '0%'],
    [5, '0 \\"x\\"', '5 "x"'],
    [5, '"E+"0', 'E+5'],
    [5, '0 "kg"', '5 kg'],
    [1234.5, '"€"#,##0.00', '€1,234.50'],
    [12, '0" ft "0" in"', '1 ft 2 in'],
  ])('%s with %s → %j', (value, code, expected) => expect(text(value, code)).toBe(expected))

  it('reports *x repeat fills instead of expanding them', () => {
    expect(formatValue(5, '0*-')).toEqual({ text: '5', fill: { char: '-', position: 1 } })
    expect(formatValue(5, '*-0')).toEqual({ text: '5', fill: { char: '-', position: 0 } })
    expect(formatValue(-5, '"$"* 0')).toEqual({ text: '-$5', fill: { char: ' ', position: 2 } })
    expect(formatValue(5, '**0')).toEqual({ text: '5', fill: { char: '*', position: 0 } })
    expect(formatValue(5, '*-0*x')).toEqual({ text: '5', fill: { char: '-', position: 0 } })
    expect(formatValue('ab', '@*.')).toEqual({ text: 'ab', fill: { char: '.', position: 2 } })
  })
})

describe('accounting formats', () => {
  const acct = builtinFormatCode(44)!
  const acct0 = builtinFormatCode(41)!
  it.each<[number | string, string, string, number]>([
    [1234.5, acct, ' $1,234.50 ', 2],
    [-1234.5, acct, ' $(1,234.50)', 2],
    [0, acct, ' $-   ', 2],
    ['abc', acct, ' abc ', -1],
    [1234.5, acct0, ' 1,235 ', 1],
    [-1234.5, acct0, ' (1,235)', 1],
    [0, acct0, ' - ', 1],
    [0.004, acct, ' $0.00 ', 2],
  ])('%s with %s → %j', (value, code, expected, fillAt) => {
    const result = formatValue(value, code)
    expect(result.text).toBe(expected)
    if (fillAt >= 0) expect(result.fill).toEqual({ char: ' ', position: fillAt })
    else expect(result.fill).toBeUndefined()
  })
})

describe('sections', () => {
  it.each<[number | string, string, string]>([
    [5, '0;(0)', '5'],
    [-5, '0;(0)', '(5)'],
    [0, '0;(0)', '0'],
    [0, '0;(0);"zero"', 'zero'],
    [-0.0001, '0;(0);"zero"', '(0)'],
    [0.0001, '0;(0);"zero"', '0'],
    [-5, '0;-0;"zero"', '-5'],
    [-5, '0;0', '5'],
    [-5, '0;;', ''],
    [0, '0;0;', ''],
    [5, ';;;', ''],
    [-5, ';;;', ''],
    ['x', ';;;', ''],
    ['x', ';;', 'x'],
    ['x', '0;0;0', 'x'],
    ['x', '0;0;0;"text"', 'text'],
    ['x', '0;0;0;"<"@">"', '<x>'],
    ['x', '@', 'x'],
    ['x', '@@', 'xx'],
    [5, '@', '5'],
    [0.1 + 0.2, '@', '0.3'],
    [5, '"x"@', '5'],
    ['x', '"x"@', 'xx'],
    [-5, '0.00;@', '-5.00'],
    ['a', '0.00;@', 'a'],
    [5, '0;-0;0;@', '5'],
    [-5, '0;-0;0;@', '-5'],
    [0, '0;-0;"-";@', '-'],
    [5, 'General;-General', '5'],
    [-5, 'General;-General', '-5'],
    [-5, 'General;(General)', '(5)'],
    [1234.5, '"$"General', '$1234.5'],
    [-1234.5, '"$"General', '-$1234.5'],
    [5, 'general', '5'],
    [5, '', '5'],
    [-5, '#,##0;[Red]-#,##0', '-5'],
    [-1234.5, '#,##0.00_);(#,##0.00)', '(1,234.50)'],
    [1234.5, '#,##0.00_);(#,##0.00)', '1,234.50 '],
    [0, '#,##0.00;-#,##0.00;"–"', '–'],
    ['', '0;0;0;"[" @ "]"', '[  ]'],
  ])('%j with %s → %j', (value, code, expected) => expect(text(value, code)).toBe(expected))
})

describe('conditions', () => {
  it.each<[number, string, string]>([
    [50, '[<=100]0;[>100]0.0', '50'],
    [150, '[<=100]0;[>100]0.0', '150.0'],
    [-5, '[<0]"neg";[>0]"pos";"zero"', 'neg'],
    [5, '[<0]"neg";[>0]"pos";"zero"', 'pos'],
    [0, '[<0]"neg";[>0]"pos";"zero"', 'zero'],
    [5551234, '[<=9999999]###-####;(###) ###-####', '555-1234'],
    [5551234567, '[<=9999999]###-####;(###) ###-####', '(555) 123-4567'],
    [150, '[>100]"big";0', 'big'],
    [5, '[>100]"big";0', '5'],
    [-5, '[>100]"big";0', '5'],
    [5, '[>100]0;[<-100]0', '5'],
    [-200, '[>100]0;[<-100]0', '200'],
    [-200, '[>100]0;[<-100]0;"mid"', '200'],
    [5, '[>100]0;[<-100]0;"mid"', 'mid'],
    [-200, '[<-100]0;0', '-200'],
    [-5, '[<0]0;0', '5'],
    [-5, '[<=0]0;0', '5'],
    [-50, '[<-100]0;0', '50'],
    [1000, '[>=1000]#,##0,"K";0', '1K'],
    [999, '[>=1000]#,##0,"K";0', '999'],
    [1500000, '[>=1000000]0.0,,"M";[>=1000]0.0,"K";0', '1.5M'],
    [1500, '[>=1000000]0.0,,"M";[>=1000]0.0,"K";0', '1.5K'],
    [15, '[>=1000000]0.0,,"M";[>=1000]0.0,"K";0', '15'],
    [-1500, '[>=1000000]0.0,,"M";[>=1000]0.0,"K";0', '-1500'],
    [5, '[=5]"five";0', 'five'],
    [6, '[=5]"five";0', '6'],
    [5, '[<>5]"other";"five"', 'five'],
    [5, '[>=5]0.0', '5.0'],
    [4, '[>=5]0.0', '4'],
    [-4.5, '[>=5]0.0', '-4.5'],
    [0.5, '[<1]0.00;0', '0.50'],
    [5, '[ >= 5 ]0', '5'],
    [2, '[>1.5]"y";"n"', 'y'],
    [0.001, '[<1e-2]"tiny";0', 'tiny'],
  ])('%s with %s → %j', (value, code, expected) => expect(text(value, code)).toBe(expected))

  it('shows values no condition matches as General', () => {
    expect(formatValue(5, '[Red][>100]0;[Blue][<-100]0')).toEqual({ text: '5' })
  })
})

describe('colors', () => {
  it.each<[number | string, string, string, string | undefined]>([
    [5, '[Red]0', '5', '#FF0000'],
    [-5, '0;[Red]-0', '-5', '#FF0000'],
    [-5, '0;[Red]0', '5', '#FF0000'],
    [5, '0;[Red]0', '5', undefined],
    [5, '[Blue]0', '5', '#0000FF'],
    [5, '[GREEN]0', '5', '#00FF00'],
    [5, '[black]0', '5', '#000000'],
    [5, '[White]0', '5', '#FFFFFF'],
    [5, '[Cyan]0', '5', '#00FFFF'],
    [5, '[Magenta]0', '5', '#FF00FF'],
    [5, '[Yellow]0', '5', '#FFFF00'],
    [5, '[Color10]0', '5', '#008000'],
    [5, '[Color 3]0', '5', '#FF0000'],
    [5, '[color56]0', '5', '#333333'],
    [5, '[Color1]0', '5', '#000000'],
    [5, '[Color57]0', '5', undefined],
    [5, '[Color0]0', '5', undefined],
    [-5, '[Blue]0;[Red]0', '5', '#FF0000'],
    [0, '[Blue]0;[Red]0;[Green]0', '0', '#00FF00'],
    ['x', '[Blue]0;[Red]0;[Green]0;[Magenta]@', 'x', '#FF00FF'],
    ['x', '[Red]0', 'x', '#FF0000'],
    ['x', '[Red]0;[Blue]0', 'x', undefined],
    [150, '[Red][<=100]0;[Blue][>100]0', '150', '#0000FF'],
    [50, '[<=100][Red]0;[Blue][>100]0', '50', '#FF0000'],
    [5, '[Red][Blue]0', '5', '#FF0000'],
    [45292, '[Red]m/d/yyyy', '1/1/2024', '#FF0000'],
    [-1, '[Red]m/d/yyyy', '#######', '#FF0000'],
  ])('%j with %s → %j in %s', (value, code, expected, color) => {
    const result = formatValue(value, code)
    expect(result.text).toBe(expected)
    expect(result.color).toBe(color)
  })
})

describe('currency and locale tags', () => {
  it.each<Case>([
    [1234, '[$€-407]#,##0.00', '€1,234.00'],
    [1234, '#,##0.00 [$€-407]', '1,234.00 €'],
    [1234, '[$$-409]#,##0', '$1,234'],
    [1234, '[$USD] #,##0', 'USD 1,234'],
    [1234, '[$-409]#,##0', '1,234'],
    [1234, '[$£-809]#,##0.00', '£1,234.00'],
    [1234, '[$¥-411]#,##0', '¥1,234'],
    [1234, '[$CHF-807] #,##0.00', 'CHF 1,234.00'],
    [-1234, '[$€-407]#,##0.00;-[$€-407]#,##0.00', '-€1,234.00'],
    [45321, '[$-409]m/d/yyyy', '1/30/2024'],
    [45321, '[$-F800]dddd, mmmm dd, yyyy', 'Tuesday, January 30, 2024'],
    [0.75, '[$-F400]h:mm:ss AM/PM', '6:00:00 PM'],
    [45321, '[$-x-sysdate]dddd, mmmm d, yyyy', 'Tuesday, January 30, 2024'],
    [1234, '[DBNum1]0', '1234'],
    [1234, '[NatNum1]0', '1234'],
    [1234, '[$-1010409]0', '1234'],
    [45321, '[$-th-TH]d/m/yyyy', '30/1/2024'],
    [45321, '[~buddhist]d/m/yyyy', '30/1/2024'],
    [1234, '[$₹-4009] #,##0', '₹ 1,234'],
  ])('%s with %s → %j', (value, code, expected) => expect(text(value, code)).toBe(expected))
})

describe('General', () => {
  it.each<[number, string]>([
    [0, '0'],
    [1, '1'],
    [-1, '-1'],
    [123, '123'],
    [1234567890, '1234567890'],
    [12345678901, '12345678901'],
    [123456789012, '1.23457E+11'],
    [-12345678901, '-1.2346E+10'],
    [-1234567890, '-1234567890'],
    [0.1, '0.1'],
    [0.1 + 0.2, '0.3'],
    [1 / 3, '0.333333333'],
    [2 / 3, '0.666666667'],
    [-1 / 3, '-0.33333333'],
    [123.456, '123.456'],
    [1234567.891, '1234567.891'],
    [12345678.912, '12345678.91'],
    [123456789.123, '123456789.1'],
    [1234567890.12, '1234567890'],
    [0.0001, '0.0001'],
    [0.00012345678912, '0.000123457'],
    [0.00001, '1E-05'],
    [0.0000001, '1E-07'],
    [1.23456789e-7, '1.23457E-07'],
    [1e11, '1E+11'],
    [99999999999, '99999999999'],
    [99999999999.5, '1E+11'],
    [1e100, '1E+100'],
    [1.23456789e100, '1.2346E+100'],
    [1e-100, '1E-100'],
    [-1e-7, '-1E-07'],
    [12345.6789, '12345.6789'],
    [3.14159265358979, '3.141592654'],
    [1e15, '1E+15'],
    [123456789012345, '1.23457E+14'],
    [0.5, '0.5'],
    [1.1, '1.1'],
    [1.23456789012345, '1.23456789'],
    [9.99999999999, '10'],
    [-0.5, '-0.5'],
    [1.7976931348623157e308, '1.7977E+308'],
    [5e-324, '4.9407E-324'],
  ])('%s → %j', (value, expected) => {
    expect(text(value, 'General')).toBe(expected)
    expect(formatGeneral(value)).toBe(expected)
  })

  it.each<[number, number, string]>([
    [123456.789, 6, '123457'],
    [1 / 3, 5, '0.333'],
    [123456789, 5, '1E+08'],
    [0.0001, 5, '1E-04'],
    [1234.5, 20, '1234.5'],
    [1 / 3, 20, '0.333333333333333'],
    [123456789012, 20, '123456789012'],
    [-12.5, 4, '-13'],
    [5, 1, '5'],
  ])('%s at width %s → %j', (value, width, expected) => expect(formatValue(value, 'General', { generalWidth: width }).text).toBe(expected))

  it('shows non-finite numbers as #NUM!', () => {
    expect(text(Number.NaN, 'General')).toBe('#NUM!')
    expect(text(Number.POSITIVE_INFINITY, '0.00')).toBe('#NUM!')
  })
})

describe('numberToText (15 digits, outside cells)', () => {
  it.each<[number, string]>([
    [1 / 3, '0.333333333333333'],
    [0.1 + 0.2, '0.3'],
    [123456789012, '123456789012'],
    [1e15, '1E+15'],
    [999999999999999, '999999999999999'],
    [1.5e20, '1.5E+20'],
    [0.0001, '0.0001'],
    [0.00001, '1E-05'],
    [1.23456789012345e-10, '1.23456789012345E-10'],
    [-2.5, '-2.5'],
    [0, '0'],
    [-0, '0'],
    [1e-300, '1E-300'],
    [Number('12345678901234567890'), '1.23456789012346E+19'],
    [45321.75, '45321.75'],
    [100, '100'],
  ])('%s → %j', (value, expected) => expect(numberToText(value)).toBe(expected))
})

describe('roundNumber', () => {
  it.each<[number, number, number]>([
    [2.5, 0, 3],
    [-2.5, 0, -3],
    [1.005, 2, 1.01],
    [1234.567, -2, 1200],
    [1250, -2, 1300],
    [0.1 + 0.2, 15, 0.3],
    [-0.001, 2, 0],
    [5, 2, 5],
  ])('%s to %s → %s', (value, decimals, expected) => expect(roundNumber(value, decimals)).toBe(expected))
})

describe('non-number values', () => {
  it('shows booleans, errors, blanks, and text', () => {
    expect(formatValue(true, '0.00')).toEqual({ text: 'TRUE' })
    expect(formatValue(false, '[Red]0;0;0;"x"')).toEqual({ text: 'FALSE' })
    expect(formatValue(Errors.NA, '0.00')).toEqual({ text: '#N/A' })
    expect(formatValue(Errors.DIV0, 'General')).toEqual({ text: '#DIV/0!' })
    expect(formatValue(null, '0.00')).toEqual({ text: '' })
    expect(formatValue('hello', '0.00')).toEqual({ text: 'hello' })
    expect(formatValue('', '0.00')).toEqual({ text: '' })
    expect(formatValue('hello', 'm/d/yyyy')).toEqual({ text: 'hello' })
    expect(formatValue('5', '0.00')).toEqual({ text: '5' })
  })
})

describe('built-in format ids', () => {
  it.each<[number, string | undefined]>([
    [0, 'General'],
    [1, '0'],
    [2, '0.00'],
    [3, '#,##0'],
    [4, '#,##0.00'],
    [5, '"$"#,##0_);("$"#,##0)'],
    [6, '"$"#,##0_);[Red]("$"#,##0)'],
    [7, '"$"#,##0.00_);("$"#,##0.00)'],
    [8, '"$"#,##0.00_);[Red]("$"#,##0.00)'],
    [9, '0%'],
    [10, '0.00%'],
    [11, '0.00E+00'],
    [12, '# ?/?'],
    [13, '# ??/??'],
    [14, 'm/d/yyyy'],
    [15, 'd-mmm-yy'],
    [16, 'd-mmm'],
    [17, 'mmm-yy'],
    [18, 'h:mm AM/PM'],
    [19, 'h:mm:ss AM/PM'],
    [20, 'h:mm'],
    [21, 'h:mm:ss'],
    [22, 'm/d/yyyy h:mm'],
    [37, '#,##0 ;(#,##0)'],
    [38, '#,##0 ;[Red](#,##0)'],
    [39, '#,##0.00;(#,##0.00)'],
    [40, '#,##0.00;[Red](#,##0.00)'],
    [41, '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)'],
    [42, '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)'],
    [43, '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)'],
    [44, '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)'],
    [45, 'mm:ss'],
    [46, '[h]:mm:ss'],
    [47, 'mmss.0'],
    [48, '##0.0E+0'],
    [49, '@'],
    [27, 'm/d/yyyy'],
    [32, 'h:mm'],
    [59, '0'],
    [62, '#,##0.00'],
    [67, '0%'],
    [78, 'm/d/yyyy h:mm'],
    [81, 'mmss.0'],
    [82, undefined],
    [100, undefined],
    [164, undefined],
    [-1, undefined],
  ])('%s → %j', (id, code) => expect(builtinFormatCode(id)).toBe(code))

  it.each<[number, number | string, string]>([
    [1, 1234.567, '1235'],
    [2, 1234.567, '1234.57'],
    [3, 1234.567, '1,235'],
    [4, 1234.567, '1,234.57'],
    [5, -1234.567, '($1,235)'],
    [7, 1234.567, '$1,234.57 '],
    [8, -1234.567, '($1,234.57)'],
    [9, 0.1234, '12%'],
    [10, 0.1234, '12.34%'],
    [11, 1234.567, '1.23E+03'],
    [12, 1.25, '1 1/4'],
    [13, 1.3, '1  3/10'],
    [37, 1234, '1,234 '],
    [38, -1234, '(1,234)'],
    [48, 1234.567, '1.2E+3'],
    [49, 1234.567, '1234.567'],
  ])('id %s shows %s as %j', (id, value, expected) => expect(text(value, builtinFormatCode(id)!)).toBe(expected))

  it('colors the red negative built-ins', () => {
    expect(formatValue(-5, builtinFormatCode(6)!).color).toBe('#FF0000')
    expect(formatValue(-5, builtinFormatCode(40)!).color).toBe('#FF0000')
  })
})

describe('isDateFormat', () => {
  it.each<[string, boolean]>([
    ['m/d/yyyy', true],
    ['d-mmm-yy', true],
    ['h:mm', true],
    ['[h]:mm:ss', true],
    ['[mm]:ss', true],
    ['[ss]', true],
    ['yyyy', true],
    ['mmm', true],
    ['[$-409]m/d/yyyy', true],
    ['[Red]m/d/yyyy', true],
    ['h AM/PM', true],
    ['mm:ss.0', true],
    ['dddd', true],
    ['e', true],
    ['"Date: "m/d', true],
    ['m/d/yyyy;@', true],
    ['General', false],
    ['0.00', false],
    ['"date"0', false],
    ['\\d0', false],
    ['[Red]0.00', false],
    ['#,##0;[Red]-#,##0', false],
    ['@', false],
    ['"yyyy"', false],
    ['0.00E+00', false],
    ['[$USD]0', false],
    ['_(* #,##0_)', false],
    ['', false],
    ['"unterminated', false],
    ['0 "h"', false],
    ['[Blue]General', false],
    ['# ?/?', false],
    ['[>100]0;0', false],
  ])('%j → %s', (code, expected) => expect(isDateFormat(code)).toBe(expected))
})

describe('numberFormatKind', () => {
  it.each<[string, string]>([
    ['General', 'general'],
    ['', 'general'],
    ['0', 'number'],
    ['#,##0.00', 'number'],
    ['#,##0.00;[Red]-#,##0.00', 'number'],
    ['0%', 'percent'],
    ['0.00%', 'percent'],
    ['"$"#,##0.00', 'currency'],
    ['$#,##0', 'currency'],
    ['[$€-407]#,##0.00', 'currency'],
    ['#,##0.00 [$USD]', 'currency'],
    ['£#,##0', 'currency'],
    [builtinFormatCode(7)!, 'currency'],
    [builtinFormatCode(41)!, 'accounting'],
    [builtinFormatCode(44)!, 'accounting'],
    ['m/d/yyyy', 'date'],
    ['mmm-yy', 'date'],
    ['dddd', 'date'],
    ['h:mm', 'time'],
    ['[h]:mm:ss', 'time'],
    ['h:mm AM/PM', 'time'],
    ['mm:ss.0', 'time'],
    ['m/d/yyyy h:mm', 'datetime'],
    ['yyyy-mm-dd hh:mm:ss', 'datetime'],
    ['0.00E+00', 'scientific'],
    ['##0.0E+0', 'scientific'],
    ['# ?/?', 'fraction'],
    ['?/8', 'fraction'],
    ['@', 'text'],
    ['"x"@', 'text'],
    ['"label"', 'general'],
    ['[Red]General', 'general'],
    ['"unterminated', 'general'],
  ])('%j → %s', (code, expected) => expect(numberFormatKind(code)).toBe(expected))
})

describe('malformed and hostile codes', () => {
  it.each(['"abc', '[Red', '0\\', '0_', '0*', '0;0;0;0;0', 'a;b;c;d;e', '0'.repeat(5000), '[Red]"x'])('%j falls back to General', (code) => {
    expect(formatValue(1234.5, code)).toEqual({ text: '1234.5', formatError: true })
    expect(formatValue('x', code).text).toBe('x')
  })

  it('bounds huge codes', () => {
    const start = performance.now()
    for (const code of ['0'.repeat(2000), '0.' + '0'.repeat(2000), '#,'.repeat(1000), '[h]'.repeat(500), 'E+'.repeat(1000), '?/'.repeat(1000), '0;'.repeat(100000), '"'.repeat(1001), '['.repeat(2000), 'mmmm'.repeat(500)]) {
      for (const value of [0, -1, 1.5, 1e308, -1e-308, 45321.75]) {
        const result = formatValue(value, code)
        expect(typeof result.text).toBe('string')
        expect(result.text.length).toBeLessThan(10_000)
      }
    }
    expect(performance.now() - start).toBeLessThan(2000)
  })

  it('never throws on random codes and finishes quickly', () => {
    let seed = 12345
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const alphabet = '0#?.,%E+-/@;[]"\\_*$ dmyhsAMP:<>=123GeneralbgRdlu'
    const values = [0, -0, 1, -1, 0.5, -1234.5678, 1e15, 1e-15, 45321.75, 2958466, Number.NaN, 'text', true]
    const start = performance.now()
    for (let n = 0; n < 3000; n++) {
      let code = ''
      const length = Math.floor(random() * 40)
      for (let i = 0; i < length; i++) code += alphabet[Math.floor(random() * alphabet.length)]
      for (const value of values) {
        const result = formatValue(value, code)
        expect(typeof result.text).toBe('string')
      }
      isDateFormat(code)
      numberFormatKind(code)
    }
    expect(performance.now() - start).toBeLessThan(5000)
  })
})

describe('performance', () => {
  it('formats 200k numbers with cached codes well under a second', () => {
    const codes = ['#,##0.00', '0%', 'm/d/yyyy', 'General', '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)']
    for (const code of codes) formatValue(1, code)
    const start = performance.now()
    let length = 0
    for (let i = 0; i < 200_000; i++) length += formatValue(i * 1.37 - 5000, codes[i % codes.length]!).text.length
    const elapsed = performance.now() - start
    expect(length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(1000)
  })
})
