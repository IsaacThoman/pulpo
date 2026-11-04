import { parseXml } from '../../ooxml/package.js'
import type { SheetColor } from '../model/schema.js'
import { attr, child, children } from '../codec/xml.js'

/**
 * Cell colors to CSS: RGB, theme colors with Excel's tint, and the legacy indexed palette.
 */

/** Theme color slots in the order cell colors index them (lt1/dk1 and lt2/dk2 swapped vs the XML). */
const THEME_SLOTS = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']

/** The Office theme's colors (2013–2022), by slot, for workbooks without a theme. */
export const OFFICE_THEME_COLORS: Record<string, string> = {
  dk1: '000000',
  lt1: 'FFFFFF',
  dk2: '44546A',
  lt2: 'E7E6E6',
  accent1: '4472C4',
  accent2: 'ED7D31',
  accent3: 'A5A5A5',
  accent4: 'FFC000',
  accent5: '5B9BD5',
  accent6: '70AD47',
  hlink: '0563C1',
  folHlink: '954F72',
}

/** The 64-entry legacy palette (BIFF8 defaults); 64 is the system foreground, 65 background. */
export const INDEXED_COLORS = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
]

export interface ThemeColors {
  /** Hex RGB by slot name (dk1, lt1, …). */
  slots: Record<string, string>
  /** Major (headings) and minor (body) Latin fonts. */
  majorFont: string
  minorFont: string
}

export const DEFAULT_THEME_COLORS: ThemeColors = { slots: OFFICE_THEME_COLORS, majorFont: 'Calibri Light', minorFont: 'Calibri' }

/** Reads the color scheme and fonts of a theme part; falls back to the Office theme. */
export function readThemeColors(xml: string | undefined): ThemeColors {
  if (!xml) return DEFAULT_THEME_COLORS
  try {
    const document = parseXml(xml)
    const slots: Record<string, string> = { ...OFFICE_THEME_COLORS }
    const scheme = document.getElementsByTagNameNS('*', 'clrScheme').item(0) ?? undefined
    for (const slot of children(scheme)) {
      const color = children(slot)[0]
      const value = attr(color, 'lastClr') ?? attr(color, 'val')
      if (value && /^[0-9A-Fa-f]{6}$/.test(value)) slots[slot.localName ?? ''] = value.toUpperCase()
    }
    const font = (name: string) => attr(child(document.getElementsByTagNameNS('*', name).item(0) ?? undefined, 'latin'), 'typeface')
    return { slots, majorFont: font('majorFont') ?? 'Calibri Light', minorFont: font('minorFont') ?? 'Calibri' }
  } catch {
    return DEFAULT_THEME_COLORS
  }
}

/** Excel's tint: lighten (tint > 0) or darken (tint < 0) the HLS luminance. */
export function applyTint(hex: string, tint: number): string {
  if (!tint) return hex
  const [h, l, s] = rgbToHls(hex)
  const luminance = tint < 0 ? l * (1 + tint) : l * (1 - tint) + (1 - (1 - tint))
  return hlsToRgb(h, Math.min(1, Math.max(0, luminance)), s)
}

function rgbToHls(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, l, 0]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h /= 6
  return [h, l, s]
}

function hlsToRgb(h: number, l: number, s: number): string {
  const channel = (t: number) => {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  const values = s === 0 ? [l, l, l] : [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)]
  return values.map((value) => Math.round(value * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
}

export type ColorRole = 'font' | 'fill' | 'border'

/** A cell color as CSS, or undefined for "automatic" (the caller's default for the role). */
export function cssColor(color: SheetColor | null | undefined, theme: ThemeColors, indexed?: string[]): string | undefined {
  if (!color || color.auto) return undefined
  let hex: string | undefined
  let alpha = 1
  if (color.rgb) {
    const rgb = color.rgb.replace(/^#/, '')
    hex = rgb.length === 8 ? rgb.slice(2) : rgb
    // Excel ignores the alpha byte of cell colors (openpyxl writes 00 for opaque colors).
    alpha = 1
  } else if (color.theme !== undefined) {
    hex = theme.slots[THEME_SLOTS[color.theme] ?? ''] ?? undefined
  } else if (color.indexed !== undefined) {
    if (color.indexed >= 64) return undefined
    const custom = indexed?.[color.indexed]
    hex = custom ? custom.slice(-6) : INDEXED_COLORS[color.indexed]
  }
  if (!hex || !/^[0-9A-Fa-f]{6}$/.test(hex)) return undefined
  if (color.tint) hex = applyTint(hex.toUpperCase(), color.tint)
  return alpha === 1 ? `#${hex.toUpperCase()}` : `rgba(${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},${alpha})`
}
