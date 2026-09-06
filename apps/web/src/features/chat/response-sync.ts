import type { ResponseEvent, ResponseSnapshot, StateInvalidationScope, SyncResult } from '@pulpo/contracts'

const DELTA_EVENT_TYPES = new Set([
  'response.output_text.delta',
  'response.reasoning_summary_text.delta',
])

export function isTerminalSnapshot(snapshot: ResponseSnapshot): boolean {
  return snapshot.status !== 'queued' && snapshot.status !== 'in_progress'
}

export function syncInvalidationScopes(result: SyncResult): SyncResult['invalidate'] {
  const scopes = new Set(result.invalidate)
  if (result.snapshots.some(isTerminalSnapshot)) scopes.add('chats')
  return [...scopes]
}

export function stateInvalidationQueryKeys(scope: StateInvalidationScope, userId: string): string[][] {
  if (scope === 'friends') {
    return [['friends', userId], ['friends-pending-count', userId], ['friends-usage', userId]]
  }
  if (scope === 'pool') {
    return [['pool', userId], ['pool-pending-count', userId], ['pool-usage', userId]]
  }
  return [[scope, userId]]
}

export function groupResponseEvents(events: ResponseEvent[]): ResponseEvent[][] {
  const grouped = new Map<string, ResponseEvent[]>()
  for (const event of events) {
    const batch = grouped.get(event.responseId)
    if (batch) batch.push(event)
    else grouped.set(event.responseId, [event])
  }
  return [...grouped.values()]
}

export function takeContiguousResponseEvents(
  events: ResponseEvent[],
  afterSequence: number,
): { ready: ResponseEvent[]; pending: ResponseEvent[] } {
  const sorted = [...events]
    .filter((event) => event.sequence > afterSequence)
    .sort((left, right) => left.sequence - right.sequence)
  const ready: ResponseEvent[] = []
  const pending: ResponseEvent[] = []
  let expected = afterSequence + 1
  for (const event of sorted) {
    if (event.sequence < expected) continue
    if (event.sequence === expected) {
      ready.push(event)
      expected += 1
    } else {
      pending.push(event)
    }
  }
  return { ready, pending }
}

function deltaTargetKey(event: ResponseEvent): string {
  const payload = event.payload as Record<string, unknown>
  return JSON.stringify([
    payload.item_id ?? payload.itemId,
    payload.output_index ?? payload.outputIndex,
    payload.content_index ?? payload.contentIndex,
    payload.agent_turn,
  ])
}

/**
 * Collapse adjacent text deltas before projecting them into durable local state.
 * The last sequence is retained so replay cursors still advance atomically.
 */
export function coalesceResponseEvents(events: ResponseEvent[]): ResponseEvent[] {
  const compacted: ResponseEvent[] = []
  for (const event of events) {
    const previous = compacted.at(-1)
    const delta = (event.payload as { delta?: unknown }).delta
    const previousDelta = (previous?.payload as { delta?: unknown } | undefined)?.delta
    if (
      previous
      && previous.responseId === event.responseId
      && previous.type === event.type
      && deltaTargetKey(previous) === deltaTargetKey(event)
      && DELTA_EVENT_TYPES.has(event.type)
      && typeof previousDelta === 'string'
      && typeof delta === 'string'
    ) {
      compacted[compacted.length - 1] = {
        ...event,
        payload: { ...(event.payload as Record<string, unknown>), delta: previousDelta + delta },
      }
    } else {
      compacted.push(event)
    }
  }
  return compacted
}

/** Refresh optimistic state after successful replay or a permanent rejection. */
export function outboxInvalidationQueryKeys(paths: readonly string[], userId: string, activeChatId?: string): string[][] {
  const keys = new Map<string, string[]>()
  const add = (key: string[]) => keys.set(JSON.stringify(key), key)
  for (const path of paths) {
    if (path.startsWith('/api/settings')) { add(['settings', userId]); continue }
    if (path.startsWith('/api/folders')) add(['folders', userId])
    if (/^\/api\/(chats|folders|messages|responses)(\/|$)/.test(path)) {
      add(['chats', userId])
      add(['deleted-chats', userId])
      const chatId = /^\/api\/chats\/([^/?]+)/.exec(path)?.[1]
      if (chatId && chatId !== 'order') add(['chat', userId, chatId])
      if (activeChatId) add(['chat', userId, activeChatId])
    }
  }
  return [...keys.values()]
}
