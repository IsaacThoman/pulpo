export type UsageRequestSequence =
  | { kind: 'turn'; number: number }
  | { kind: 'compaction' }
  | { kind: 'attempt'; number: number }

export function usageRequestSequence(row: {
  purpose: string
  retryAttempt: number
  turnNumber: number | null
}): UsageRequestSequence {
  if (row.turnNumber != null) return { kind: 'turn', number: row.turnNumber }
  if (row.purpose === 'compaction') return { kind: 'compaction' }
  return { kind: 'attempt', number: row.retryAttempt }
}
