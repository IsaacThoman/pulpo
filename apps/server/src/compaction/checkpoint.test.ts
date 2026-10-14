import { describe, expect, it } from 'vitest'
import type { CompactionItem } from '@pulpo/contracts'
import {
  USER_MESSAGES_STRATEGY,
  checkpointRetainedUserTexts,
  findLatestCheckpoint,
  isUserMessagesCheckpoint,
  type HistoryResponseRow,
} from './checkpoint.js'

function checkpoint(values: Partial<CompactionItem> = {}): CompactionItem {
  return {
    id: 'resp:compaction:pre_response',
    type: 'pulpo_compaction',
    phase: 'pre_response',
    status: 'completed',
    model_id: 'model',
    estimated_tokens: 10,
    threshold_tokens: 5,
    retained_turns: [],
    retained_context: [],
    retained_context_turns: [],
    summary: 'summary',
    started_at: '2026-01-01T00:00:00.000Z',
    ...values,
  }
}

function row(id: string, output: unknown[], values: Partial<HistoryResponseRow> = {}): HistoryResponseRow {
  return { id, status: 'completed', agentMode: false, output, ...values }
}

describe('findLatestCheckpoint', () => {
  it('returns the newest completed pre_response checkpoint with its index', () => {
    const older = checkpoint({ summary: 'older' })
    const newer = checkpoint({ summary: 'newer' })
    const lineage = [row('a', [older]), row('b', []), row('c', [{ type: 'message' }, newer]), row('d', [])]
    expect(findLatestCheckpoint(lineage)).toEqual({ index: 2, item: newer })
  })

  it('ignores agent-mode and unfinished responses', () => {
    const usable = checkpoint({ summary: 'usable' })
    const lineage = [
      row('a', [usable]),
      row('b', [checkpoint({ summary: 'agent' })], { agentMode: true }),
      row('c', [checkpoint({ summary: 'failed' })], { status: 'failed' }),
      row('d', [checkpoint({ summary: 'running' })], { status: 'in_progress' }),
    ]
    expect(findLatestCheckpoint(lineage)).toEqual({ index: 0, item: usable })
  })

  it('ignores in-progress, failed and mid-run items', () => {
    const lineage = [row('a', [
      checkpoint({ status: 'in_progress' }),
      checkpoint({ status: 'failed', error: 'boom' }),
      checkpoint({ phase: 'agent_mid_run' }),
      { ...checkpoint(), summary: undefined },
    ])]
    expect(findLatestCheckpoint(lineage)).toBeUndefined()
  })

  it('handles lineages without checkpoints or with malformed output', () => {
    expect(findLatestCheckpoint([])).toBeUndefined()
    expect(findLatestCheckpoint([row('a', []), { id: 'b', status: 'completed', agentMode: false, output: null }])).toBeUndefined()
  })
})

describe('user_messages checkpoints', () => {
  it('distinguishes new items from legacy recent-turn items', () => {
    expect(isUserMessagesCheckpoint(checkpoint({ strategy: USER_MESSAGES_STRATEGY }))).toBe(true)
    expect(isUserMessagesCheckpoint(checkpoint())).toBe(false)
  })

  it('returns the retained user texts in order', () => {
    const item = checkpoint({
      strategy: USER_MESSAGES_STRATEGY,
      retained_turns: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'ignored' },
        { role: 'user', content: 'second' },
      ],
    })
    expect(checkpointRetainedUserTexts(item)).toEqual(['first', 'second'])
  })

  it('tolerates items stored without retained turns', () => {
    expect(checkpointRetainedUserTexts({ ...checkpoint(), retained_turns: undefined } as unknown as CompactionItem)).toEqual([])
  })
})
