export function formatChatExpiryRemaining(expiresAt: number, now = Date.now()): string {
  const remainingMs = expiresAt - now
  if (remainingMs <= 0) return 'now'

  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60
  return [
    days ? `${days}d` : '',
    hours ? `${hours}h` : '',
    minutes ? `${minutes}m` : '',
  ].filter(Boolean).join(' ')
}
