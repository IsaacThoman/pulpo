import { MAX_COLS, MAX_ROWS } from '../address.js'
import { MAX_EXPANDED_CELLS } from '../limits.js'
import type { CellRange } from '../address.js'
import type { StyleProps } from '../model/schema.js'
import type { CellSnapshot } from './commands.js'

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
}

export interface ClipboardPayload {
  rows: ClipboardCell[][]
  /** Snapshots for lossless pastes within this app, plus where they came from. */
  internal?: { source: CellRange; sheet: string; cells: CellSnapshot[][]; cut?: boolean }
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
    .map((row) => `<tr>${row.map((cell) => `<td${cell.formula ? ` x:fmla="${escapeHtml(cell.formula)}"` : ''} style="${escapeHtml(cellCss(cell))}">${escapeHtml(cell.text).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`)
    .join('')
  return `<meta charset="utf-8"><table${internal} style="border-collapse:collapse">${body}</table>`
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
}

/**
 * Reads an HTML clipboard table (Excel, Google Sheets, web pages). Returns our own snapshots
 * when the table came from this app. Requires a DOM (DOMParser).
 */
export function parseHtml(html: string): { cells: PastedCell[][]; internal?: ClipboardPayload['internal'] } | undefined {
  if (typeof DOMParser === 'undefined') return undefined
  const document = new DOMParser().parseFromString(html, 'text/html')
  const table = document.querySelector('table')
  if (!table) return undefined
  const marker = table.getAttribute(CLIPBOARD_MARKER)
  let internal: ClipboardPayload['internal']
  if (marker) {
    try {
      internal = JSON.parse(decodeBase64(marker)) as ClipboardPayload['internal']
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
  for (const row of cells) for (let index = 0; index < row.length; index++) row[index] ??= { text: '' }
  return { cells, ...(internal ? { internal } : {}) }
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
