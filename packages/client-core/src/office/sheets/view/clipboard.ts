import { MAX_COLS, MAX_ROWS } from '../address.js'
import { formatSheetPrefix, mapReferences } from '../formula/translate.js'
import { MAX_EXPANDED_CELLS } from '../limits.js'
import type { CellRange } from '../address.js'
import type { ConditionalFormat, DataValidation, StyleProps } from '../model/schema.js'
import type { CellSnapshot } from './commands.js'
import type { CellValue } from '../values.js'

/**
 * Copy and paste between sheets here, Excel, and Google Sheets. Copies put tab-separated text
 * (what every spreadsheet reads) and an HTML table (formatting) on the clipboard; the HTML also
 * carries this app's own cell snapshots so pasting here keeps formulas and exact formats.
 */

export const CLIPBOARD_MARKER = 'data-pulpo-sheet'

export interface ClipboardCell {
  text: string
  /** Formula text (with `=`) when pasting back here or into another spreadsheet as a formula. */
  formula?: string
  style?: Partial<StyleProps>
  /** CSS colors, resolved, for the HTML. */
  css?: { color?: string; background?: string }
  rowSpan?: number
  colSpan?: number
  covered?: boolean
}

export interface ClipboardPayload {
  rows: ClipboardCell[][]
  /** Snapshots for lossless pastes within this app, plus where they came from. */
  internal?: ClipboardSnapshot
}

/** All coordinates and formulas are captured at copy time, never recovered from a live sheet. */
export interface ClipboardSnapshot {
  stylesXml?: string
  source: CellRange
  sheet: string
  cells: CellSnapshot[][]
  sourceRows: number[]
  sourceCols: number[]
  values: CellValue[][]
  merges: CellRange[]
  validations: ClipboardRule<DataValidation>[]
  conditionalFormats: ClipboardRule<ConditionalFormat>[]
  /** A session token authorizes a cut; HTML alone must never delete source cells. */
  cut?: string
}

export interface ClipboardRule<T> {
  ranges: CellRange[]
  origin: { row: number; col: number }
  value: Omit<T, 'ranges'>
}

/** Quotes a TSV field when it holds tabs, newlines, or quotes (as Excel does). */
function tsvField(text: string): string {
  return /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toTsv(rows: ClipboardCell[][]): string {
  return rows.map((row) => row.map((cell) => tsvField(cell.text)).join('\t')).join('\n')
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (char) => ESCAPES[char]!)

function cellCss(cell: ClipboardCell): string {
  const style = cell.style ?? {}
  const parts: string[] = []
  if (style.bold) parts.push('font-weight:bold')
  if (style.italic) parts.push('font-style:italic')
  if (style.underline || style.strike) parts.push(`text-decoration:${[style.underline ? 'underline' : '', style.strike ? 'line-through' : ''].filter(Boolean).join(' ')}`)
  if (style.fontName) parts.push(`font-family:${JSON.stringify(style.fontName)}`)
  if (style.fontSize) parts.push(`font-size:${style.fontSize}pt`)
  if (cell.css?.color) parts.push(`color:${cell.css.color}`)
  if (cell.css?.background) parts.push(`background-color:${cell.css.background}`)
  if (style.hAlign && style.hAlign !== 'general') parts.push(`text-align:${style.hAlign === 'centerContinuous' ? 'center' : style.hAlign}`)
  if (style.wrap) parts.push('white-space:normal')
  if (style.numFmt && style.numFmt !== 'General') parts.push(`mso-number-format:${JSON.stringify(style.numFmt).replace(/\\\\/g, '\\')}`)
  return parts.join(';')
}

/** An HTML table Excel, Google Sheets, and word processors understand. */
export function toHtml(payload: ClipboardPayload): string {
  const internal = payload.internal ? ` ${CLIPBOARD_MARKER}="${escapeHtml(encodeBase64(JSON.stringify(payload.internal)))}"` : ''
  const body = payload.rows
    .map((row, r) => `<tr>${row.map((cell, c) => cell.covered ? '' : htmlCell(cell, payload.internal?.values[r]?.[c], payload.internal?.sourceRows[r] ?? r, payload.internal?.sourceCols[c] ?? c)).join('')}</tr>`)
    .join('')
  return `<meta charset="utf-8"><table${internal} style="border-collapse:collapse">${body}</table>`
}

function htmlCell(cell: ClipboardCell, value: CellValue | undefined, row: number, col: number): string {
  return `<td${cell.rowSpan ? ` rowspan="${cell.rowSpan}"` : ''}${cell.colSpan ? ` colspan="${cell.colSpan}"` : ''}${typeof value === 'string' ? ' x:str' : ''}${cell.formula ? ` x:fmla="${escapeHtml(excelFormula(cell.formula, row, col))}"` : ''} style="${escapeHtml(cellCss(cell))}">${escapeHtml(cell.text).replace(/\n/g, '<br>')}</td>`
}

/** Excel's HTML formula attribute uses R1C1 offsets relative to each visible source cell. */
function excelFormula(formula: string, row: number, col: number): string {
  const part = (axis: string, n: number, absolute: boolean, at: number) => absolute ? `${axis}${n + 1}` : `${axis}${n === at ? '' : `[${n - at}]`}`
  return mapReferences(formula, (ref) => {
    const one = (r: number, c: number, ra: boolean, ca: boolean) => (ref.kind === 'cols' ? '' : part('R', r, ra, row)) + (ref.kind === 'rows' ? '' : part('C', c, ca, col))
    const first = one(ref.row, ref.col, ref.rowAbs, ref.colAbs)
    const last = ref.kind === 'cell' ? '' : `:${one(ref.row2, ref.col2, ref.row2Abs, ref.col2Abs)}`
    return (ref.sheet ? formatSheetPrefix(ref.sheet) : '') + first + last
  })
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeBase64(text: string): string {
  const binary = atob(text)
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}

/** Parses tab-separated text, honoring quoted fields with tabs and newlines inside. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let index = 0
  const normalized = text.replace(/\r\n?/g, '\n')
  while (index < normalized.length) {
    const char = normalized[index]!
    if (char === '"' && field === '') {
      let end = index + 1
      let value = ''
      let closed = false
      while (end < normalized.length) {
        if (normalized[end] === '"') {
          if (normalized[end + 1] === '"') {
            value += '"'
            end += 2
            continue
          }
          closed = true
          end++
          break
        }
        value += normalized[end]
        end++
      }
      // Only a quote that closes right before a separator starts a quoted field.
      if (closed && (end >= normalized.length || normalized[end] === '\t' || normalized[end] === '\n')) {
        field = value
        index = end
        continue
      }
    }
    if (char === '\t') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += char
    index++
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export interface PastedCell {
  text: string
  style?: Partial<StyleProps>
  /** CSS colors from the source, for the caller to map to cell colors. */
  color?: string
  background?: string
  formula?: string
  stringValue?: boolean
}

/**
 * Reads an HTML clipboard table (Excel, Google Sheets, web pages). Returns our own snapshots
 * when the table came from this app. Requires a DOM (DOMParser).
 */
export function parseHtml(html: string): { cells: PastedCell[][]; merges: CellRange[]; internal?: ClipboardPayload['internal'] } | undefined {
  if (typeof DOMParser === 'undefined') return undefined
  const document = new DOMParser().parseFromString(html, 'text/html')
  const table = document.querySelector('table')
  if (!table) return undefined
  const marker = table.getAttribute(CLIPBOARD_MARKER)
  let internal: ClipboardPayload['internal']
  if (marker && marker.length <= 64 * 1024 * 1024) {
    try {
      const candidate: unknown = JSON.parse(decodeBase64(marker))
      if (validSnapshot(candidate)) internal = candidate
    } catch {
      internal = undefined
    }
  }
  // Excel puts class-based styles in a <style> block.
  const classStyles = new Map<string, string>()
  for (const style of Array.from(document.querySelectorAll('style'))) {
    for (const match of (style.textContent ?? '').matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) classStyles.set(match[1]!, match[2]!)
  }
  const cells: PastedCell[][] = []
  const occupied: { top: number; bottom: number; left: number; right: number }[] = []
  let width = 1
  let height = 1
  const span = (value: string | null, max: number) => {
    const number = Number(value)
    return Number.isInteger(number) && number > 0 ? Math.min(number, max) : 1
  }
  for (const [rowIndex, tr] of Array.from(table.querySelectorAll('tr')).entries()) {
    if (rowIndex >= MAX_ROWS || (rowIndex + 1) * width > MAX_EXPANDED_CELLS) break
    height = Math.max(height, rowIndex + 1)
    const row: PastedCell[] = (cells[rowIndex] ??= [])
    let col = 0
    for (const td of Array.from(tr.children).filter((element) => element.tagName === 'TD' || element.tagName === 'TH')) {
      for (;;) {
        const covering = occupied.find((rect) => rowIndex >= rect.top && rowIndex <= rect.bottom && col >= rect.left && col <= rect.right)
        if (!covering) break
        col = covering.right + 1
      }
      if (col >= MAX_COLS || (col + 1) * height > MAX_EXPANDED_CELLS) break
      const css = [...(td.getAttribute('class') ?? '').split(/\s+/).map((name) => classStyles.get(name) ?? ''), td.getAttribute('style') ?? ''].join(';')
      const cell: PastedCell = { text: cellText(td) }
      const formula = td.getAttribute('x:fmla')
      if (formula?.startsWith('=')) cell.formula = formula
      if (td.hasAttribute('x:str')) cell.stringValue = true
      const style = styleFromCss(css, td)
      if (Object.keys(style.style).length) cell.style = style.style
      if (style.color) cell.color = style.color
      if (style.background) cell.background = style.background
      row[col] = cell
      const colSpan = span(td.getAttribute('colspan'), Math.min(MAX_COLS - col, Math.floor(MAX_EXPANDED_CELLS / height) - col))
      width = Math.max(width, col + colSpan)
      const rowSpan = span(td.getAttribute('rowspan'), Math.min(MAX_ROWS - rowIndex, Math.floor(MAX_EXPANDED_CELLS / width) - rowIndex))
      height = Math.max(height, rowIndex + rowSpan)
      if (rowSpan > 1 || colSpan > 1) occupied.push({ top: rowIndex, bottom: rowIndex + rowSpan - 1, left: col, right: col + colSpan - 1 })
      col += colSpan
    }
  }
  for (let r = 0; r < height; r++) {
    const row = (cells[r] ??= [])
    for (let c = 0; c < width; c++) row[c] ??= { text: '' }
  }
  return { cells, merges: occupied, ...(internal ? { internal } : {}) }
}

function cellText(element: Element): string {
  // <br> inside a cell is a line break; other whitespace collapses like HTML.
  const clone = element.cloneNode(true) as Element
  for (const br of Array.from(clone.querySelectorAll('br'))) br.replaceWith('\n')
  return (clone.textContent ?? '').replace(/[ \t\r]+/g, ' ').replace(/ ?\n ?/g, '\n').trim()
}

function styleFromCss(css: string, element: Element): { style: Partial<StyleProps>; color?: string; background?: string } {
  const style: Partial<StyleProps> = {}
  const declarations = new Map<string, string>()
  for (const declaration of css.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon > 0) declarations.set(declaration.slice(0, colon).trim().toLowerCase(), declaration.slice(colon + 1).trim())
  }
  const weight = declarations.get('font-weight')
  if (weight === 'bold' || Number(weight) >= 600 || element.querySelector('b, strong')) style.bold = true
  if (declarations.get('font-style') === 'italic' || element.querySelector('i, em')) style.italic = true
  const decoration = declarations.get('text-decoration') ?? declarations.get('text-decoration-line') ?? ''
  if (decoration.includes('underline') || element.querySelector('u')) style.underline = 'single'
  if (decoration.includes('line-through') || element.querySelector('s, strike')) style.strike = true
  const align = declarations.get('text-align')
  if (align === 'left' || align === 'center' || align === 'right' || align === 'justify') style.hAlign = align
  const size = /^([\d.]+)(pt|px)$/.exec(declarations.get('font-size') ?? '')
  if (size) style.fontSize = size[2] === 'px' ? Math.round(Number(size[1]) * 0.75 * 2) / 2 : Number(size[1])
  const family = declarations.get('font-family')
  if (family) style.fontName = family.split(',')[0]!.replace(/["']/g, '').trim()
  const format = declarations.get('mso-number-format')
  if (format) style.numFmt = format.replace(/^["']|["']$/g, '').replace(/\\(.)/g, '$1')
  if (declarations.get('white-space') === 'normal' || declarations.get('overflow-wrap') === 'break-word') style.wrap = true
  const result: { style: Partial<StyleProps>; color?: string; background?: string } = { style }
  const color = declarations.get('color')
  const background = declarations.get('background-color') ?? declarations.get('background')
  if (color) result.color = color
  if (background && background !== 'transparent') result.background = background
  return result
}

/** Converts a CSS color (`#abc`, `#aabbcc`, `rgb(…)`) to RRGGBB, or undefined. */
export function cssToRgb(color: string | undefined): string | undefined {
  if (!color) return undefined
  const text = color.trim().toLowerCase()
  let match = /^#([0-9a-f]{3})$/.exec(text)
  if (match) return match[1]!.split('').map((char) => char + char).join('').toUpperCase()
  match = /^#([0-9a-f]{6})$/.exec(text)
  if (match) return match[1]!.toUpperCase()
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(text)
  if (rgb) {
    if (rgb[4] !== undefined && Number(rgb[4]) === 0) return undefined
    return [rgb[1], rgb[2], rgb[3]].map((part) => Math.min(255, Number(part)).toString(16).padStart(2, '0')).join('').toUpperCase()
  }
  const named: Record<string, string> = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', orange: 'FFA500', purple: '800080' }
  return named[text]
}

function validSnapshot(value: unknown): value is ClipboardSnapshot {
  if (!value || typeof value !== 'object') return false
  const s = value as ClipboardSnapshot
  const position = (n: unknown, max: number) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < max
  const range = (r: CellRange) => r && position(r.top, MAX_ROWS) && position(r.bottom, MAX_ROWS) && position(r.left, MAX_COLS) && position(r.right, MAX_COLS) && r.top <= r.bottom && r.left <= r.right
  if (typeof s.sheet !== 'string' || !range(s.source) || !Array.isArray(s.cells) || !s.cells.length) return false
  const width = s.cells[0]?.length
  if (!width || s.cells.length * width > MAX_EXPANDED_CELLS || !Array.isArray(s.sourceRows) || !Array.isArray(s.sourceCols) || !Array.isArray(s.values)) return false
  if (s.sourceRows.length !== s.cells.length || s.sourceCols.length !== width || s.values.length !== s.cells.length) return false
  if (!s.sourceRows.every((r, i) => position(r, MAX_ROWS) && r >= s.source.top && r <= s.source.bottom && (!i || r > s.sourceRows[i - 1]!))) return false
  if (!s.sourceCols.every((c, i) => position(c, MAX_COLS) && c >= s.source.left && c <= s.source.right && (!i || c > s.sourceCols[i - 1]!))) return false
  const scalar = validValue
  if (!s.cells.every((row, r) => Array.isArray(row) && row.length === width && row.every(validCell) && Array.isArray(s.values[r]) && s.values[r]!.length === width && s.values[r]!.every(scalar))) return false
  const inside = (r: CellRange) => range(r) && r.bottom < s.cells.length && r.right < width
  if (!Array.isArray(s.merges) || !s.merges.every(inside)) return false
  if (s.stylesXml !== undefined && typeof s.stylesXml !== 'string') return false
  for (const rules of [s.validations, s.conditionalFormats]) {
    if (!Array.isArray(rules) || !rules.every((r) => r && Array.isArray(r.ranges) && r.ranges.every(inside) && r.origin && position(r.origin.row, MAX_ROWS) && position(r.origin.col, MAX_COLS) && r.value && typeof r.value === 'object')) return false
  }
  const strings = (value: unknown) => value === undefined || (Array.isArray(value) && value.every((v) => typeof v === 'string'))
  for (const { value } of s.validations) {
    if (typeof value.type !== 'string' || !validStrings(value, ['formula1', 'formula2', 'error', 'errorTitle', 'prompt', 'promptTitle', 'operator', 'errorStyle']) || !strings(value.formula1 === undefined ? undefined : [value.formula1]) || !strings(value.formula2 === undefined ? undefined : [value.formula2])) return false
  }
  for (const { value } of s.conditionalFormats) {
    if (!Array.isArray(value.rules) || !value.rules.every((rule) => rule && typeof rule.type === 'string' && Number.isFinite(rule.priority) && validStrings(rule, ['text', 'operator', 'timePeriod', 'xml']) && strings(rule.formulas) && ['colorScale', 'dataBar', 'iconSet'].every((key) => {
      const scale = rule[key as 'colorScale']
      if (scale && key === 'colorScale' && (!Array.isArray(scale.colors) || !scale.colors.every(validColor))) return false
      if (scale && key === 'dataBar' && !validColor((scale as unknown as { color: unknown }).color)) return false
      if (scale && key === 'iconSet' && typeof (scale as unknown as { set: unknown }).set !== 'string') return false
      return scale === undefined || (scale && Array.isArray(scale.values) && scale.values.every((v) => v && typeof v.type === 'string' && (v.value === undefined || typeof v.value === 'string')))
    }))) return false
  }
  return s.cut === undefined || typeof s.cut === 'string'
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v)
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const string = (v: unknown) => typeof v === 'string'
const boolean = (v: unknown) => typeof v === 'boolean'
const stringMap = (v: unknown) => object(v) && Object.values(v).every(string)
const validStrings = (v: object, keys: string[]) => keys.every((key) => optional((v as Record<string, unknown>)[key], string))
const positive = (v: unknown, max: number) => Number.isInteger(v) && (v as number) > 0 && (v as number) <= max
const index = (v: unknown) => Number.isInteger(v) && (v as number) >= 0
function validValue(v: unknown): boolean {
  return v === null || string(v) || finite(v) || boolean(v) || (object(v) && string(v.e))
}
function validColor(v: unknown): boolean {
  return v === null || (object(v) && optional(v.rgb, string) && optional(v.auto, boolean) && ['theme', 'indexed', 'tint'].every((key) => optional(v[key], finite)))
}
function validBorder(v: unknown): boolean {
  return v === null || (object(v) && string(v.style) && optional(v.color, validColor))
}
function validStyle(v: unknown): boolean {
  if (!object(v)) return false
  const strings = ['fontName', 'numFmt', 'hAlign', 'vAlign', 'vertAlign', 'styleName']
  const numbers = ['fontSize', 'rotation', 'indent']
  const booleans = ['bold', 'italic', 'strike', 'wrap', 'shrink', 'locked', 'hidden', 'quotePrefix']
  if (!validStrings(v, strings) || !numbers.every((k) => optional(v[k], finite)) || !booleans.every((k) => optional(v[k], boolean))) return false
  if (!optional(v.underline, (u) => u === null || string(u))) return false
  if (!['fontColor', 'fill'].every((k) => optional(v[k], validColor))) return false
  if (!['borderTop', 'borderBottom', 'borderLeft', 'borderRight', 'diagonalUp', 'diagonalDown'].every((k) => optional(v[k], validBorder))) return false
  if (!optional(v.pattern, (p) => object(p) && string(p.type) && optional(p.fg, validColor) && optional(p.bg, validColor))) return false
  return optional(v.gradient, (g) => object(g) && string(g.type) && finite(g.degree) && Array.isArray(g.stops) && g.stops.every((s) => object(s) && finite(s.position) && validColor(s.color)))
}
function validRuns(v: unknown): boolean {
  return Array.isArray(v) && v.every((r) => object(r) && string(r.text) && optional(r.font, validStyle) && optional(r.rPr, string))
}
function validData(v: unknown): boolean {
  if (!object(v) || !optional(v.v, (s) => s === null || string(s) || finite(s) || boolean(s))) return false
  if (!validStrings(v, ['f', 'raw', 'phonetic']) || !optional(v.t, (t) => t === 's' || t === 'e')) return false
  if (!optional(v.runs, validRuns) || !optional(v.dynamic, boolean) || !optional(v.oversizedArray, boolean)) return false
  if (!optional(v.array, (a) => object(a) && positive(a.rows, MAX_ROWS) && positive(a.cols, MAX_COLS) && (a.rows as number) * (a.cols as number) <= MAX_EXPANDED_CELLS)) return false
  if (!optional(v.spillCache, (a) => Array.isArray(a) && a.length > 0 && Array.isArray(a[0]) && a[0].length > 0 && a.length * a[0].length <= MAX_EXPANDED_CELLS && a.every((row) => Array.isArray(row) && row.length === a[0].length && row.every(validValue)))) return false
  return optional(v.keep, (k) => object(k) && validStrings(k, ['fText', 'extra', 'v', 'fa', 'fc']) && optional(k.c, stringMap) && optional(k.f, stringMap))
}
function validCell(v: unknown): boolean {
  if (!object(v) || !validStyle(v.overrides) || !optional(v.xf, index) || !optional(v.data, validData)) return false
  if (!optional(v.formula, string) || (v.formula !== undefined && !object(v.data)) || (object(v.data) && v.data.f !== undefined && v.formula === undefined)) return false
  if (!optional(v.note, (n) => object(n) && string(n.text) && validStrings(n, ['author', 'shape']) && optional(n.runs, validRuns) && optional(n.keep, stringMap) && optional(n.visible, boolean))) return false
  return optional(v.link, (l) => object(l) && validStrings(l, ['target', 'location', 'tooltip', 'display']) && optional(l.range, stringMap))
}
