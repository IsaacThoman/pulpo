export function formatChatExpiryRemaining(expiresAt: number, now = Date.now()): string {
  const remainingMs = expiresAt - now
  if (remainingMs <= 0) return 'now'

  const days = Math.floor(remainingMs / (24 * 60 * 60_000))
  if (days > 0) return `${days}d`

  const hours = Math.floor(remainingMs / (60 * 60_000))
  if (hours > 0) return `${hours}h`

  return `${Math.max(1, Math.ceil(remainingMs / 60_000))}m`
}

export function resolveChatExpiryMenuAction(
  expiresAt: number | null,
  automaticChatExpiration: 'disabled' | '24h' | '7d',
): { kind: 'disable' } | { kind: 'enable'; label: string } | null {
  if (expiresAt !== null) return { kind: 'disable' }
  if (automaticChatExpiration === 'disabled') return null
  return { kind: 'enable', label: `Expire in ${automaticChatExpiration}` }
}

export type ChatExpirationPeriod = '24h' | '7d'

export type ChatLandingBadge =
  | { kind: 'temporary' }
  | { kind: 'expiration'; period: ChatExpirationPeriod }
  | null

export function retainChatLandingExpirationPeriod(
  badge: ChatLandingBadge,
  previousPeriod: ChatExpirationPeriod | null,
): ChatExpirationPeriod | null {
  return badge?.kind === 'expiration' ? badge.period : previousPeriod
}

export function resolveChatLandingBadge(
  temporary: boolean,
  expirationEnabled: boolean,
  automaticChatExpiration: 'disabled' | '24h' | '7d',
): ChatLandingBadge {
  if (temporary) return { kind: 'temporary' }
  if (!expirationEnabled || automaticChatExpiration === 'disabled') return null
  return { kind: 'expiration', period: automaticChatExpiration }
}
