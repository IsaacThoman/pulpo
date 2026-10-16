import { describe, expect, it } from 'vitest'
import type { ServerResponse } from '../../../types'
import { withBranchMetadata } from './optimisticResponses'

function response(id: string, parentResponseId: string | null, userMessageId: string | null = `${id}:user`): ServerResponse {
  const createdAt = '2026-10-16T00:00:00.000Z'
  return {
    id, parentResponseId, previousResponseId: parentResponseId, userMessageId,
    modelId: 'synthetic', status: 'completed', input: [], output: [],
    presetSelections: {}, agentMode: false, usage: null, error: null,
    createdAt, completedAt: createdAt,
    snapshot: { responseId: id, status: 'completed', sequence: 1, output: [], usage: null, error: null, updatedAt: createdAt },
    branches: { user: { ids: [id], index: 0 }, assistant: { ids: [id], index: 0 } },
  }
}

// Preserve the previous algorithm as a differential oracle for mixed legacy
// prompts, regenerations and edited branches. Timing is covered by the driver.
function scanningMetadata(responses: ServerResponse[]): ServerResponse[] {
  const key = (row: ServerResponse) => row.userMessageId ?? `legacy:${JSON.stringify(row.input)}`
  const sorted = [...responses].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  return sorted.map((active) => {
    const groups = new Map<string, ServerResponse[]>()
    for (const sibling of sorted.filter((row) => row.parentResponseId === active.parentResponseId)) {
      const group = groups.get(key(sibling)) ?? []
      group.push(sibling)
      groups.set(key(sibling), group)
    }
    const userIds = [...groups].map(([groupKey, group]) => groupKey === key(active) ? active.id : group.at(-1)!.id)
    const assistantIds = groups.get(key(active))!.map((row) => row.id)
    return { ...active, branches: {
      user: { ids: userIds, index: userIds.indexOf(active.id) },
      assistant: { ids: assistantIds, index: assistantIds.indexOf(active.id) },
    } }
  })
}

describe('optimistic branch metadata', () => {
  it('keeps chronological sibling groups and the active older answer in its user control', () => {
    const rows = [response('a', null, 'prompt'), response('b', null, 'edit'), response('c', null, 'prompt')]
    const result = withBranchMetadata([rows[2]!, rows[1]!, rows[0]!])
    expect(result.map((row) => row.id)).toEqual(['a', 'b', 'c'])
    expect(result.map((row) => row.branches)).toEqual([
      { user: { ids: ['a', 'b'], index: 0 }, assistant: { ids: ['a', 'c'], index: 0 } },
      { user: { ids: ['c', 'b'], index: 1 }, assistant: { ids: ['b'], index: 0 } },
      { user: { ids: ['c', 'b'], index: 0 }, assistant: { ids: ['a', 'c'], index: 1 } },
    ])
    expect(result[0]!.branches.user.ids).not.toBe(result[2]!.branches.user.ids)
  })

  it('matches the prior metadata for mixed parent, legacy input, and prompt-variant graphs', () => {
    for (let seed = 0; seed < 24; seed++) {
      const rows = Array.from({ length: 70 }, (_, index) => {
        const parent = (index * 7 + seed) % 13
        const row = response(`${index}`.padStart(3, '0'), parent ? `parent-${parent}` : null,
          index % 3 ? `prompt-${index % 4}` : null)
        row.input = [{ role: 'user', content: `Legacy question ${index % 5} 🐙` }]
        row.createdAt = new Date(Date.UTC(2026, 9, 16) + ((index * 31 + seed) % 19) * 1000).toISOString()
        return row
      }).reverse()
      const before = structuredClone(rows)
      for (const row of rows) Object.freeze(row)
      Object.freeze(rows)
      expect(withBranchMetadata(rows)).toEqual(scanningMetadata(rows))
      expect(rows).toEqual(before)
    }
    expect(withBranchMetadata([])).toEqual([])
  })

  it('reads parent metadata a bounded number of times for a long linear chat', () => {
    let reads = 0
    const rows = Array.from({ length: 4000 }, (_, index) => {
      const parent = index ? `r-${index - 1}` : null
      const row = response(`r-${index}`, parent)
      Object.defineProperty(row, 'parentResponseId', { enumerable: true, get() { reads++; return parent } })
      return row
    })
    const result = withBranchMetadata(rows)
    expect(result).toHaveLength(rows.length)
    expect(reads).toBeLessThan(rows.length * 6)
    for (const row of result) {
      expect(row.branches).toEqual({
        user: { ids: [row.id], index: 0 }, assistant: { ids: [row.id], index: 0 },
      })
    }
  })

  it('shares the ordered assistant version list across a large regeneration group', () => {
    const rows = Array.from({ length: 1000 }, (_, index) => response(`r-${index}`.padStart(8, '0'), null, 'one-prompt'))
    const result = withBranchMetadata(rows)
    const ids = result.map((row) => row.id)
    for (const [index, row] of result.entries()) {
      expect(row.branches.assistant.ids).toBe(result[0]!.branches.assistant.ids)
      expect(row.branches.assistant.ids).toEqual(ids)
      expect(row.branches.assistant.index).toBe(index)
      expect(row.branches.user).toEqual({ ids: [row.id], index: 0 })
    }
  })
})
