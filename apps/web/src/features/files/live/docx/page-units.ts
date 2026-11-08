import type { PageMargins } from '@pulpo/client-core/office/docx/view'
import { ui } from '@/i18n/ui'

/** Lengths the page setup and paragraph dialogs show: inches where Word and Docs use them, centimeters elsewhere. */
export type LengthUnit = 'in' | 'cm'

export const POINTS_PER_UNIT: Record<LengthUnit | 'pt', number> = { in: 72, cm: 72 / 2.54, pt: 1 }

/** Regions whose Word and Docs default to inches (the United States, Liberia, and Myanmar). */
const INCH_REGIONS = new Set(['US', 'LR', 'MM'])

/**
 * The unit a language tag measures pages in: "en-US" and a bare "en" use inches, "es-ES" and
 * "en-GB" centimeters, as Office's regional defaults do.
 */
export function measurementUnit(language: string | undefined = typeof navigator === 'undefined' ? undefined : navigator.language): LengthUnit {
  if (!language) return 'in'
  try {
    const locale = new Intl.Locale(language)
    if (locale.region) return INCH_REGIONS.has(locale.region) ? 'in' : 'cm'
    return locale.language === 'en' ? 'in' : 'cm'
  } catch {
    return 'in'
  }
}

/** Points as a number in `unit`, to two decimals (72 pt is 1 in, or 2.54 cm). */
export function pointsTo(points: number, unit: LengthUnit): number {
  return Math.round((points / POINTS_PER_UNIT[unit]) * 100) / 100
}

export function pointsFrom(value: number, unit: LengthUnit | 'pt'): number {
  return Math.round(value * POINTS_PER_UNIT[unit] * 100) / 100
}

/** A typed number ("1.5" or "1,5"), or null when it is not one. */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim().replace(',', '.')
  if (!trimmed || !/^-?(\d+\.?\d*|\.\d+)$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

const UNIT_SUFFIX = /^(.*?)\s*(in|inch|inches|"|cm|mm|pt)$/i

/**
 * A typed length in points, as Word reads its fields: a number in the dialog's unit, or with its
 * own unit ("2.5 cm" in an inch dialog, `1"`, "36 pt", "15 mm"). Null when it is not a length.
 */
export function parseLength(text: string, unit: LengthUnit): number | null {
  const match = UNIT_SUFFIX.exec(text.trim())
  const typed = match ? match[2]!.toLowerCase() : null
  const value = parseNumber(match ? match[1]! : text)
  if (value === null) return null
  if (typed === 'mm') return Math.round((value / 10) * POINTS_PER_UNIT.cm * 100) / 100
  const scale: LengthUnit | 'pt' = typed === 'cm' ? 'cm' : typed === 'pt' ? 'pt' : typed ? 'in' : unit
  return pointsFrom(value, scale)
}

/** A number as the dialogs' fields show it: no trailing zeros, in the locale's decimal style. */
export function formatNumber(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(value)
}

export interface PaperSize {
  id: string
  /** Portrait width and height in points; orientation picks the long side. */
  width: number
  height: number
}

/** Word's and Docs' paper sizes, in points (portrait). */
export const PAPER_SIZES: readonly PaperSize[] = [
  { id: 'letter', width: 612, height: 792 },
  { id: 'legal', width: 612, height: 1008 },
  { id: 'a4', width: 595.3, height: 841.9 },
  { id: 'a5', width: 419.55, height: 595.3 },
  { id: 'executive', width: 522, height: 756 },
  { id: 'tabloid', width: 792, height: 1224 },
]

/** The paper size a page is (either way round), or undefined for a custom size. Word rounds to twips. */
export function paperSizeOf(width: number, height: number): PaperSize | undefined {
  const [short, long] = width <= height ? [width, height] : [height, width]
  return PAPER_SIZES.find((size) => Math.abs(size.width - short) < 1 && Math.abs(size.height - long) < 1)
}

export type MarginSide = 'top' | 'bottom' | 'left' | 'right'
export type MarginPresetId = 'normal' | 'narrow' | 'moderate' | 'wide'

/** Word's margin presets, in points. */
export const MARGIN_PRESETS: Record<MarginPresetId, Record<MarginSide, number>> = {
  normal: { top: 72, bottom: 72, left: 72, right: 72 },
  narrow: { top: 36, bottom: 36, left: 36, right: 36 },
  moderate: { top: 72, bottom: 72, left: 54, right: 54 },
  wide: { top: 72, bottom: 72, left: 144, right: 144 },
}

/** The preset some margins match, or undefined for custom margins. */
export function marginPresetOf(margins: Pick<PageMargins, MarginSide>): MarginPresetId | undefined {
  return (Object.keys(MARGIN_PRESETS) as MarginPresetId[]).find((id) => {
    const preset = MARGIN_PRESETS[id]
    return (['top', 'bottom', 'left', 'right'] as const).every((side) => Math.abs(preset[side] - margins[side]) < 0.5)
  })
}

/** A paper size's name as Word and Docs show it, translated. */
export function paperName(id: string): string {
  switch (id) {
    case 'letter': return ui("Letter")
    case 'legal': return ui("Legal")
    case 'executive': return ui("Executive")
    case 'tabloid': return ui("Tabloid")
    default: return id.toUpperCase()
  }
}

/** The margins the fields ask for, in points; the first side that is not a length of 0 or more otherwise. */
export function parseMargins(values: Record<MarginSide, string>, unit: LengthUnit): { margins: Record<MarginSide, number> } | { side: MarginSide } {
  const margins = {} as Record<MarginSide, number>
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    const value = parseLength(values[side], unit)
    if (value === null || value < 0) return { side }
    margins[side] = value
  }
  return { margins }
}
