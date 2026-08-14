export function friendRequestAge(isoDate: string, now = Date.now()): string {
  const timestamp = Date.parse(isoDate)
  if (!Number.isFinite(timestamp)) return ''

  const elapsedDays = Math.max(0, Math.floor((now - timestamp) / 86_400_000))
  if (elapsedDays === 0) return 'today'
  if (elapsedDays === 1) return 'yesterday'
  if (elapsedDays < 7) return `${elapsedDays} days ago`

  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp)
}
