import type { ChatShareSummary } from '@pulpo/contracts'

export function sharingMenuLabel(shared: boolean | undefined): 'Share' | 'Manage sharing' {
  return shared ? 'Manage sharing' : 'Share'
}

export function publicShareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/share/${encodeURIComponent(token)}`
}

export function addCreatedShare(current: ChatShareSummary[], created: ChatShareSummary): ChatShareSummary[] {
  return [created, ...current.filter((share) => share.id !== created.id)]
}

export function removeRevokedShare(current: ChatShareSummary[], revokedId: string): ChatShareSummary[] {
  return current.filter((share) => share.id !== revokedId)
}
