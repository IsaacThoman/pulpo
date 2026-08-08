import type { QueuedMessageStatus, ResponseStatus } from '@pulpo/contracts'

export function nextQueuePosition(currentMaximum: number | null | undefined): number {
  return (currentMaximum ?? -1) + 1
}

export function canPromoteQueueHead(status: QueuedMessageStatus, recoverDispatching = false): boolean {
  return status === 'pending' || (recoverDispatching && status === 'dispatching')
}

export function isTerminalResponseStatus(status: ResponseStatus): boolean {
  return status !== 'queued' && status !== 'in_progress'
}
