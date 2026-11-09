export function timeAgo(timestamp: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp)) return 'just now'
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'}`

/** `timeAgo` spelled out for screen readers, which read "5m" as "5 meters". */
export function spokenTimeAgo(timestamp: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp)) return 'just now'
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${plural(hours, 'hour')} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${plural(days, 'day')} ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${plural(months, 'month')} ago`
  return `${plural(Math.floor(months / 12), 'year')} ago`
}

/** A remaining time such as "3 days", "5 hours" or "12 minutes", for spoken labels. */
export function spokenRemaining(milliseconds: number): string {
  if (milliseconds <= 0) return 'now'
  const days = Math.floor(milliseconds / 86_400_000)
  if (days > 0) return plural(days, 'day')
  const hours = Math.floor(milliseconds / 3_600_000)
  if (hours > 0) return plural(hours, 'hour')
  return plural(Math.max(1, Math.ceil(milliseconds / 60_000)), 'minute')
}
