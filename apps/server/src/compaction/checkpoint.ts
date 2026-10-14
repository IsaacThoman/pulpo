import type { CompactionItem } from '@pulpo/contracts'

export const USER_MESSAGES_STRATEGY = 'user_messages'

export type HistoryResponseRow = { id: string; status: string; agentMode: boolean; output: unknown }

function isCompletedCheckpoint(raw: unknown): raw is CompactionItem {
  const item = raw as Partial<CompactionItem> | null
  return item?.type === 'pulpo_compaction'
    && item.phase === 'pre_response'
    && item.status === 'completed'
    && typeof item.summary === 'string'
}

/** Newest completed non-agent response carrying a completed pre_response checkpoint. */
export function findLatestCheckpoint(lineage: readonly HistoryResponseRow[]): { index: number; item: CompactionItem } | undefined {
  for (let index = lineage.length - 1; index >= 0; index -= 1) {
    const row = lineage[index]!
    // Agent checkpoints hold pi tool-protocol state, and failed responses never reached the model.
    if (row.status !== 'completed' || row.agentMode || !Array.isArray(row.output)) continue
    const item = row.output.findLast(isCompletedCheckpoint)
    if (item) return { index, item }
  }
  return undefined
}

export function isUserMessagesCheckpoint(item: CompactionItem): boolean {
  return item.strategy === USER_MESSAGES_STRATEGY
}

export function checkpointRetainedUserTexts(item: CompactionItem): string[] {
  const retained: unknown = item.retained_turns
  if (!Array.isArray(retained)) return []
  return retained.flatMap((entry) => {
    const turn = entry as Partial<CompactionItem['retained_turns'][number]> | null
    return turn?.role === 'user' && typeof turn.content === 'string' ? [turn.content] : []
  })
}
