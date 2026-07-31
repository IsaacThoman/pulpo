export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`
  return n.toLocaleString()
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

/** Always 4 decimals ("$0.2245") — matches OpenWebUI-Monitor usage displays. */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(4)}`
}

export function formatTokens(inTok: number, outTok: number): string {
  return `${formatNumber(inTok)} in / ${formatNumber(outTok)} out`
}

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** "7/31/2026, 12:25 AM" — dense timestamp for usage record tables. */
export function formatUsageTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
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
