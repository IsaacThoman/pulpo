type TimedActivityStep =
  | { kind: 'reasoning'; durationMs?: number }
  | { kind: 'tool'; tool: { durationMs?: number } }
  | { kind: 'workspace'; workspace: { durationMs?: number } }
  | { kind: 'compaction'; compaction: { duration_ms?: number } }
  | { kind: 'recall' }

export function activityDurationMs(steps: TimedActivityStep[]): number | undefined {
  const durations = steps.flatMap((step) => {
    if (step.kind === 'recall') return []
    const durationMs = step.kind === 'reasoning'
      ? step.durationMs
      : step.kind === 'tool'
        ? step.tool.durationMs
        : step.kind === 'workspace'
          ? step.workspace.durationMs
          : step.compaction.duration_ms
    return durationMs !== undefined && durationMs >= 0 ? [durationMs] : []
  })
  return durations.length > 0
    ? durations.reduce((total, durationMs) => total + durationMs, 0)
    : undefined
}
