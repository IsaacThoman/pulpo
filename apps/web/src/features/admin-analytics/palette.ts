/**
 * Chart colors for admin analytics. The categorical order is validated for
 * colour-vision deficiency on adjacent pairs in light and dark mode (values in
 * index.css as --viz-*); never cycle it, fold extra series into "Other".
 */
export const VIZ_CATEGORICAL = [
  'var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)',
  'var(--viz-5)', 'var(--viz-6)', 'var(--viz-7)', 'var(--viz-8)',
] as const

export const VIZ_OTHER = 'var(--viz-other)'

/** Reserved for request outcomes; always paired with a text label. */
export const VIZ_STATUS = {
  completed: 'var(--viz-good)',
  failed: 'var(--viz-critical)',
  incomplete: 'var(--viz-serious)',
  cancelled: 'var(--viz-other)',
  inFlight: 'var(--viz-1)',
} as const

export const OTHER_SERIES_KEY = 'other'

/**
 * Stable colors per entity: keys are assigned slots in sorted order so the same
 * set of series always gets the same colors, regardless of rank or metric.
 * Keys past the palette size, and the "other" key, share the neutral color.
 */
export function seriesColors(keys: readonly string[]): Map<string, string> {
  const colors = new Map<string, string>()
  const ordered = [...new Set(keys)].filter((key) => key !== OTHER_SERIES_KEY).sort()
  ordered.forEach((key, index) => colors.set(key, VIZ_CATEGORICAL[index] ?? VIZ_OTHER))
  colors.set(OTHER_SERIES_KEY, VIZ_OTHER)
  return colors
}
