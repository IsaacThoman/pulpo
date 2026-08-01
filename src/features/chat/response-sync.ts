import type { ResponseSnapshot, SyncResult } from '@pulpo/contracts'

export function isTerminalSnapshot(snapshot: ResponseSnapshot): boolean {
  return snapshot.status !== 'queued' && snapshot.status !== 'in_progress'
}

export function syncInvalidationScopes(result: SyncResult): SyncResult['invalidate'] {
  const scopes = new Set(result.invalidate)
  if (result.snapshots.some(isTerminalSnapshot)) scopes.add('chats')
  return [...scopes]
}
