import type { UsageLimitPercentages, UsageLimits } from '@pulpo/contracts'

/** One plan usage limit as the settings screen shows it. Percentages only: no amounts of money. */
export interface UsageLimitRow {
  key: string
  label: string
  remainingPercentage: number
  availableBarPercentage: number
  pendingBarPercentage: number
  /** When the limit resets, or how its window works. */
  reset: string
  hint?: string
}

export function planName(plan: UsageLimits['plan']): string {
  if (plan === 'eight') return 'Pulpo Eight'
  if (plan === 'fat') return 'Pulpo Fat'
  return 'Pulpo Baby'
}

export function remainingLabel(limit: Pick<UsageLimitPercentages, 'remainingPercentage'>): string {
  return `${limit.remainingPercentage}% left`
}

function resetLabel(resetsAt: string | null, withDate: boolean, locale?: string): string {
  if (!resetsAt) return 'Starts on first use'
  const time = new Date(resetsAt).toLocaleString(locale, withDate
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { hour: 'numeric', minute: '2-digit' })
  return `Resets ${time}`
}

function bar(limit: UsageLimitPercentages) {
  return {
    remainingPercentage: limit.remainingPercentage,
    availableBarPercentage: limit.availableBarPercentage,
    pendingBarPercentage: limit.pendingBarPercentage,
  }
}

/** Mirrors the web's subscription usage bars, minus pool sharing, which the app does not offer. */
export function usageLimitRows(limits: UsageLimits, locale?: string): UsageLimitRow[] {
  const rows: UsageLimitRow[] = []
  if (limits.weekly) rows.push({ key: 'weekly', label: 'Weekly usage', ...bar(limits.weekly), reset: resetLabel(limits.weekly.resetsAt, true, locale) })
  if (limits.fiveHour) rows.push({ key: 'five-hour', label: '5-hour usage', ...bar(limits.fiveHour), reset: resetLabel(limits.fiveHour.resetsAt, false, locale) })
  for (const limit of limits.custom) {
    const hints = [
      limit.models.length ? `Applies to ${limit.models.join(', ')}` : null,
      limit.coversExtras ? null : 'Model usage only, not tools or workspace time',
    ].filter((hint): hint is string => hint !== null)
    rows.push({
      key: `custom-${limit.id}`,
      label: limit.name,
      ...bar(limit),
      reset: limit.period === 'five_hour' ? 'Rolling 5-hour window' : resetLabel(limit.resetsAt, limit.period === 'weekly', locale),
      ...(hints.length ? { hint: hints.join(' · ') } : {}),
    })
  }
  return rows
}
