import type { QueuedMessageStatus, ResponseStatus } from '@pulpo/contracts'

export function nextQueuePosition(currentMaximum: number | null | undefined): number {
  return (currentMaximum ?? -1) + 1
}

export function reorderQueueIds(
  ids: string[],
  fromId: string,
  targetId: string,
  edge: 'before' | 'after',
): string[] {
  if (fromId === targetId) return ids
  const from = ids.indexOf(fromId)
  if (from < 0 || !ids.includes(targetId)) return ids
  const reordered = [...ids]
  reordered.splice(from, 1)
  const target = reordered.indexOf(targetId)
  reordered.splice(edge === 'before' ? target : target + 1, 0, fromId)
  return reordered
}

export function canPromoteQueueHead(status: QueuedMessageStatus, recoverDispatching = false): boolean {
  return status === 'pending' || (recoverDispatching && status === 'dispatching')
}

export function isTerminalResponseStatus(status: ResponseStatus): boolean {
  return status !== 'queued' && status !== 'in_progress'
}
