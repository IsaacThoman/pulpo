import type { MobileQueuedMessage } from '../../types'

export const submittingQueueIds = new Set<string>()

export function shouldQueueMessage(active: boolean, queueLength: number): boolean {
  return active || queueLength > 0
}

export function reconcileQueuedMessages(
  incoming: MobileQueuedMessage[], existing: MobileQueuedMessage[], pendingIds: ReadonlySet<string>,
): MobileQueuedMessage[] {
  const ids = new Set(incoming.map((item) => item.id))
  return [...incoming, ...existing.filter((item) => !ids.has(item.id) && item.pendingSubmissionId
    && (item.localFailure || pendingIds.has(item.pendingSubmissionId) || submittingQueueIds.has(item.pendingSubmissionId)))]
}

export function reorderQueue(queue: MobileQueuedMessage[], id: string, targetId: string, edge: 'before' | 'after'): MobileQueuedMessage[] {
  const moving = queue.find((item) => item.id === id)
  if (!moving || moving.status === 'dispatching' || id === targetId || !queue.some((item) => item.id === targetId)) return queue
  const rest = queue.filter((item) => item.id !== id)
  rest.splice(rest.findIndex((item) => item.id === targetId) + (edge === 'after' ? 1 : 0), 0, moving)
  return rest.map((item, position) => ({ ...item, position }))
}

