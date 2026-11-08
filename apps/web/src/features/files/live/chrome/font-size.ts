/** Google Docs' size list. */
export const FONT_SIZE_PRESETS: readonly number[] = [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96]

export const MIN_FONT_SIZE = 1
export const MAX_FONT_SIZE = 400

/** A size as the box shows it: 11, 10.5, never 10.500001. */
export function formatFontSize(size: number): string {
  return String(Number(size.toFixed(2)))
}

/** A typed size, or null when it is not a number within bounds. Accepts "10,5" as well as "10.5". */
export function parseFontSize(text: string, min = MIN_FONT_SIZE, max = MAX_FONT_SIZE): number | null {
  const value = Number(text.trim().replace(',', '.'))
  if (!text.trim() || !Number.isFinite(value) || value < min || value > max) return null
  return Math.round(value * 100) / 100
}
