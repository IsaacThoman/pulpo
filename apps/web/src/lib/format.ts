import { activeLocale, ui } from '@/i18n/ui'

function decimal(value: number, minimumFractionDigits: number, maximumFractionDigits = minimumFractionDigits): string {
  return new Intl.NumberFormat(activeLocale(), { minimumFractionDigits, maximumFractionDigits }).format(value)
}

function currencyUsd(value: number, fractionDigits: number): string {
  return new Intl.NumberFormat(activeLocale(), {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${decimal(n / 1_000_000, 2)}M`
  if (n >= 10_000) return `${decimal(n / 1_000, 1)}K`
  if (n >= 1_000) return `${decimal(n / 1_000, 2)}K`
  return n.toLocaleString(activeLocale())
}

/** Compact labels for chart axes, with a consistent single decimal place. */
export function formatChartNumber(n: number): string {
  const absolute = Math.abs(n)
  if (absolute >= 1_000_000_000) return `${decimal(n / 1_000_000_000, 1)}b`
  if (absolute >= 1_000_000) return `${decimal(n / 1_000_000, 1)}m`
  if (absolute >= 1_000) return `${decimal(n / 1_000, 1)}k`
  return String(Math.round(n))
}

export function formatCost(usd: number): string {
  if (usd === 0) return currencyUsd(usd, 2)
  return currencyUsd(usd, usd < 0.01 ? 4 : 2)
}

/** Always 4 decimals ("$0.2245") — matches OpenWebUI-Monitor usage displays. */
export function formatUsd(usd: number): string {
  return currencyUsd(usd, 4)
}

/** Account balances are human-facing currency and always use cents. */
export function formatBalance(usd: number): string {
  return currencyUsd(usd, 2)
}

export function formatTokens(inTok: number, outTok: number): string {
  return ui('{{input}} in / {{output}} out', { input: formatNumber(inTok), output: formatNumber(outTok) })
}

export function timeAgo(ts: number): string {
  if (!Number.isFinite(ts)) return ''
  const s = Math.floor((Date.now() - ts) / 1000)
  const relative = new Intl.RelativeTimeFormat(activeLocale(), { numeric: 'auto', style: 'narrow' })
  if (s < 60) return relative.format(0, 'second')
  const m = Math.floor(s / 60)
  if (m < 60) return relative.format(-m, 'minute')
  const h = Math.floor(m / 60)
  if (h < 24) return relative.format(-h, 'hour')
  const d = Math.floor(h / 24)
  if (d < 30) return relative.format(-d, 'day')
  const mo = Math.floor(d / 30)
  if (mo < 12) return relative.format(-mo, 'month')
  return relative.format(-Math.floor(mo / 12), 'year')
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(activeLocale(), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString(activeLocale(), {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** "7/31/2026, 12:25 AM" — dense timestamp for usage record tables. */
export function formatUsageTime(ts: number): string {
  return new Date(ts).toLocaleString(activeLocale(), {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${decimal(ms / 1000, 1)}s`
}

/** Whole seconds for activity labels ("1 second", "12 seconds"). */
export function formatSecondsLabel(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000))
  return seconds === 1 ? ui('1 second') : ui('{{count}} seconds', { count: seconds })
}

export type ChatTimeGroup = 'Pinned' | 'Today' | 'Yesterday' | 'Previous 7 Days' | 'Previous 30 Days' | 'Older'

export function chatTimeGroup(ts: number): Exclude<ChatTimeGroup, 'Pinned'> {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const dayMs = 86_400_000
  if (ts >= startOfToday) return 'Today'
  if (ts >= startOfToday - dayMs) return 'Yesterday'
  if (ts >= startOfToday - 7 * dayMs) return 'Previous 7 Days'
  if (ts >= startOfToday - 30 * dayMs) return 'Previous 30 Days'
  return 'Older'
}

export function maskKey(prefix: string): string {
  return `${prefix}${'•'.repeat(12)}`
}
