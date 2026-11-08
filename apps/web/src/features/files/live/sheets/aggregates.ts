import type { SheetSummary } from '@pulpo/client-core/office/sheets/view'
import { ui } from '@/i18n/ui'

/** The status bar's figures for a selection, as Google Sheets and Excel offer them. */
export const AGGREGATES = ['sum', 'average', 'min', 'max', 'count', 'countNumbers'] as const
export type Aggregate = (typeof AGGREGATES)[number]

/** Each viewer's choice, kept per browser. */
export const AGGREGATE_STORAGE_KEY = 'pulpo:sheets:status-aggregate'

export function readAggregate(): Aggregate {
  try {
    const stored = localStorage.getItem(AGGREGATE_STORAGE_KEY)
    return (AGGREGATES as readonly string[]).includes(stored ?? '') ? stored as Aggregate : 'sum'
  } catch {
    // Storage can be unavailable (private windows, blocked site data).
    return 'sum'
  }
}

export function writeAggregate(value: Aggregate): void {
  try {
    localStorage.setItem(AGGREGATE_STORAGE_KEY, value)
  } catch {
    // The choice still applies until the page closes.
  }
}

/** A figure as the status bar shows it: grouped, without float noise (0.1 + 0.2 shows 0.3). */
export const formatNumber = (value: number) => Number(value.toPrecision(10)).toLocaleString(undefined, { maximumFractionDigits: 10 })

/** An aggregate's value for the selection; undefined when it has no numbers to give one. */
export function aggregateValue(summary: SheetSummary, aggregate: Aggregate): number | undefined {
  switch (aggregate) {
    case 'sum': return summary.numbers > 0 ? summary.sum : undefined
    case 'average': return summary.average
    case 'min': return summary.min
    case 'max': return summary.max
    case 'count': return summary.count
    case 'countNumbers': return summary.numbers
  }
}

/** "Sum: 1,234", in the user's language. */
export function aggregateText(aggregate: Aggregate, value: number | undefined): string {
  const shown = value === undefined ? '—' : aggregate === 'count' || aggregate === 'countNumbers' ? value.toLocaleString() : formatNumber(value)
  switch (aggregate) {
    case 'sum': return ui("Sum: {{value}}", { value: shown })
    case 'average': return ui("Average: {{value}}", { value: shown })
    case 'min': return ui("Min: {{value}}", { value: shown })
    case 'max': return ui("Max: {{value}}", { value: shown })
    case 'count': return ui("Count: {{value}}", { value: shown })
    case 'countNumbers': return ui("Count numbers: {{value}}", { value: shown })
  }
}

/** What the chooser shows: the chosen figure, or the count when the selection has none (Sum of text). */
export function shownAggregate(summary: SheetSummary, chosen: Aggregate): Aggregate {
  return aggregateValue(summary, chosen) === undefined ? 'count' : chosen
}
