import type { ServerResponse } from '../../src/types'

/** Frozen withBranchMetadata from 08b2b232, for same-runtime comparisons only. */
export function baselineBranchMetadata(responses: ServerResponse[]): ServerResponse[] {
  const userBranchKey = (response: ServerResponse) => response.userMessageId ?? `legacy:${JSON.stringify(response.input)}`
  const sorted = [...responses].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  return sorted.map((active) => {
    const siblings = sorted.filter((response) => response.parentResponseId === active.parentResponseId)
    const groups = new Map<string, ServerResponse[]>()
    for (const sibling of siblings) {
      const key = userBranchKey(sibling)
      groups.set(key, [...(groups.get(key) ?? []), sibling])
    }
    const activeKey = userBranchKey(active)
    const userIds = [...groups.entries()].map(([key, group]) => key === activeKey ? active.id : group.at(-1)!.id)
    const assistantIds = groups.get(activeKey)?.map((response) => response.id) ?? [active.id]
    return { ...active, branches: {
      user: { ids: userIds, index: userIds.indexOf(active.id) },
      assistant: { ids: assistantIds, index: assistantIds.indexOf(active.id) },
    } }
  })
}

export function branchFixture(count: number, shape: 'linear' | 'mixed' | 'regenerations'): ServerResponse[] {
  return Array.from({ length: count }, (_, index) => {
    const id = `r-${String(index).padStart(6, '0')}`
    const parent = shape === 'linear' ? index ? `r-${String(index - 1).padStart(6, '0')}` : null
      : shape === 'mixed' ? `parent-${Math.floor(index / 8)}` : null
    const createdAt = new Date(Date.UTC(2026, 9, 16) + index * 1000).toISOString()
    return {
      id, parentResponseId: parent, previousResponseId: parent,
      userMessageId: shape === 'regenerations' ? 'one-prompt' : shape === 'mixed' && index % 3 === 0 ? null : `prompt-${Math.floor(index / 2)}`,
      modelId: 'synthetic', status: 'completed', input: [{ role: 'user', content: `Question ${Math.floor(index / 2)} 🐙` }],
      output: [], presetSelections: {}, agentMode: false, usage: null, error: null,
      createdAt, completedAt: createdAt,
      snapshot: { responseId: id, status: 'completed', sequence: 1, output: [], usage: null, error: null, updatedAt: createdAt },
      branches: { user: { ids: [id], index: 0 }, assistant: { ids: [id], index: 0 } },
    }
  })
}

export const branchCases = [
  { shape: 'linear', count: 100 },
  { shape: 'linear', count: 1000 },
  { shape: 'linear', count: 5000 },
  { shape: 'linear', count: 10000 },
  { shape: 'mixed', count: 1000 },
  { shape: 'mixed', count: 5000 },
  { shape: 'regenerations', count: 300 },
] as const

export function sampleSummary(samplesMs: number[]) {
  const sorted = [...samplesMs].sort((a, b) => a - b)
  return { medianMs: sorted[Math.floor(sorted.length / 2)]!, p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!, samplesMs }
}
