import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Scalar } from '../formula/types.js'

/** Test helpers: fixture loading and the cell data the openpyxl fixtures reference. */

export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8')
}

const SHEET1: Scalar[][] = [
  ['Month', 'Apples', 'Pears', 'Plums'],
  ['Jan', 40, 30, -5],
  ['Feb', 55, 25, 10],
  ['Mar', 70, 45, 22],
  ['Apr', 60, 50, 18],
  ['May', 85, 48, 30],
  ['Jun', 95, 62, 26],
]

const DATA: Scalar[][] = [['x', 'y1', 'y2', 'size']]
for (let i = 1; i <= 20; i++) DATA.push([i * 0.5, Math.sin(i / 3) * 10 + 12, i * 1.1, (i % 5) + 1])

const SHEETS: Record<string, Scalar[][]> = { Sheet1: SHEET1, Data: DATA }

function columnIndex(letters: string): number {
  let index = 0
  for (const ch of letters.toUpperCase()) index = index * 26 + ch.charCodeAt(0) - 64
  return index - 1
}

/** Resolves `'Sheet1'!$B$2:$B$7`-style references against the openpyxl fixture data. */
export function fixtureResolver(formula: string): Scalar[][] | undefined {
  const match = /^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(formula)
  if (!match) return undefined
  const sheet = SHEETS[match[1]!]
  if (!sheet) return undefined
  const left = columnIndex(match[2]!)
  const top = Number(match[3]) - 1
  const right = match[4] ? columnIndex(match[4]) : left
  const bottom = match[5] ? Number(match[5]) - 1 : top
  const rows: Scalar[][] = []
  for (let r = top; r <= bottom; r++) {
    const row: Scalar[] = []
    for (let c = left; c <= right; c++) row.push(sheet[r]?.[c] ?? null)
    rows.push(row)
  }
  return rows
}

/** A tiny stand-in for the sheet number formatter, for the formats the fixtures use. */
export function testFormatNumber(value: number, code: string): string {
  if (code === 'General') return String(Number(value.toPrecision(10)))
  const percent = /^0(\.0+)?%$/.exec(code)
  if (percent) return `${(value * 100).toFixed(percent[1] ? percent[1].length - 1 : 0)}%`
  const money = /^"\$"#,##0$/.test(code) || code === '"$"#,##0'
  if (money) return `${value < 0 ? '-' : ''}$${Math.round(Math.abs(value)).toLocaleString('en-US')}`
  if (code === '#,##0') return Math.round(value).toLocaleString('en-US')
  const fixed = /^0\.(0+)$/.exec(code)
  if (fixed) return value.toFixed(fixed[1]!.length)
  return String(value)
}

export const C = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'

/** A minimal chart part around a plot area body. */
export function chartXml(plotArea: string, chart = '', space = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?><c:chartSpace ${C}>${space}<c:chart>${chart}<c:plotArea><c:layout/>${plotArea}</c:plotArea></c:chart></c:chartSpace>`
}

export function numRef(formula: string, values: (number | null)[], formatCode = 'General'): string {
  const points = values.map((value, i) => (value === null ? '' : `<c:pt idx="${i}"><c:v>${value}</c:v></c:pt>`)).join('')
  return `<c:numRef><c:f>${formula}</c:f><c:numCache><c:formatCode>${formatCode}</c:formatCode><c:ptCount val="${values.length}"/>${points}</c:numCache></c:numRef>`
}

export function strRef(formula: string, values: string[]): string {
  const points = values.map((value, i) => `<c:pt idx="${i}"><c:v>${value}</c:v></c:pt>`).join('')
  return `<c:strRef><c:f>${formula}</c:f><c:strCache><c:ptCount val="${values.length}"/>${points}</c:strCache></c:strRef>`
}

export const AXES = `<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1"/><c:crossBetween val="between"/></c:valAx>`
