import { applyExcelTint, DEFAULT_THEME, parseTheme, resolveSpreadsheetColor, type Theme } from '../../ooxml/theme.js'
import type { SheetColor } from '../model/schema.js'

/**
 * Cell colors to CSS, through the shared theme module (`ooxml/theme.ts`): RGB, theme colors with
 * Excel's tint, and the indexed palette. "Automatic" colors (auto, the system indexes 64/65)
 * come back undefined so the renderer can use its own text color, which follows dark mode.
 */

export interface ThemeColors {
  theme: Theme
  /** Major (headings) and minor (body) Latin fonts. */
  majorFont: string
  minorFont: string
}

export const DEFAULT_THEME_COLORS: ThemeColors = { theme: DEFAULT_THEME, majorFont: DEFAULT_THEME.majorFont.latin, minorFont: DEFAULT_THEME.minorFont.latin }

/** Reads a workbook's theme part; falls back to the Office theme. */
export function readThemeColors(xml: string | undefined): ThemeColors {
  if (!xml) return DEFAULT_THEME_COLORS
  try {
    const theme = parseTheme(xml)
    return { theme, majorFont: theme.majorFont.latin, minorFont: theme.minorFont.latin }
  } catch {
    return DEFAULT_THEME_COLORS
  }
}

/** Excel's tint: lighten (tint > 0) or darken (tint < 0) a hex color. */
export function applyTint(hex: string, tint: number): string {
  return applyExcelTint(hex, tint)
}

/** A cell color as CSS `#RRGGBB`, or undefined for "automatic" (the caller's default). */
export function cssColor(color: SheetColor | null | undefined, theme: ThemeColors, indexed?: string[]): string | undefined {
  if (!color || color.auto) return undefined
  if (color.indexed !== undefined && color.indexed >= 64) return undefined
  return resolveSpreadsheetColor(color, theme.theme, indexed ? { indexedPalette: indexed } : {})
}
