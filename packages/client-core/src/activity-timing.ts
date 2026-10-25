/** The final activity before the first reply owns the total initial wait. */
export function initialActivityTiming(timeline: Array<
  | { kind: 'text'; text: string }
  | { kind: 'activity'; steps: Array<{ kind: string }> }
>): { index: number; worked: boolean } {
  let index = -1
  let worked = false
  for (const [position, segment] of timeline.entries()) {
    if (segment.kind === 'text' && segment.text.trim()) break
    if (segment.kind !== 'activity') continue
    index = position
    worked ||= segment.steps.some((step) => step.kind === 'tool' || step.kind === 'workspace')
  }
  return { index, worked }
}

type CollapsibleSegment<Step> =
  | { kind: 'text'; text: string }
  | { kind: 'activity'; steps: Step[]; active: boolean }

/** A reply the model sent before it finished working, kept inside the folded work. */
export type IntermediateReplyStep = { kind: 'message'; text: string }

/**
 * Fold everything before the final reply into one activity once a response is done, so
 * interim replies ("one sec, checking…") sit with the work they introduced. Returns the
 * same array when there is nothing to fold.
 */
export function collapseIntermediateReplies<Step extends { kind: string }>(
  timeline: Array<CollapsibleSegment<Step>>,
): Array<CollapsibleSegment<Step | IntermediateReplyStep>> {
  let lastActivity = -1
  let firstText = -1
  for (const [index, segment] of timeline.entries()) {
    if (segment.kind === 'activity') lastActivity = index
    else if (firstText < 0 && segment.text.trim()) firstText = index
  }
  const finalReply = timeline.slice(lastActivity + 1)
  if (firstText < 0 || firstText > lastActivity || !finalReply.some((segment) => segment.kind === 'text' && segment.text.trim())) {
    return timeline
  }
  const steps = timeline.slice(0, lastActivity + 1).flatMap((segment): Array<Step | IntermediateReplyStep> => {
    if (segment.kind === 'activity') return segment.steps
    return segment.text.trim() ? [{ kind: 'message', text: segment.text }] : []
  })
  return [{ kind: 'activity', steps, active: false }, ...finalReply]
}

function stepTiming(step: { kind: string }): { startedAt?: string; durationMs?: number } {
  const value = step as Record<string, unknown>
  const item = (value.tool ?? value.workspace ?? value.compaction ?? value) as Record<string, unknown>
  const durationMs = item.durationMs ?? item.duration_ms
  return {
    startedAt: typeof item.startedAt === 'string' ? item.startedAt : undefined,
    durationMs: typeof durationMs === 'number' && durationMs >= 0 ? durationMs : undefined,
  }
}

/**
 * Time from request receipt until folded work ended. The initial wait covers everything
 * before the first interim reply; later timestamped work extends it to that work's end,
 * and untimestamped work adds its own duration.
 */
export function collapsedWorkDurationMs(
  steps: Array<{ kind: string }>,
  { requestReceivedAt, initialDurationMs }: { requestReceivedAt?: string | null; initialDurationMs?: number },
): number | undefined {
  const requestStart = Date.parse(requestReceivedAt ?? '')
  let elapsed = initialDurationMs
  let afterFirstReply = false
  for (const step of steps) {
    if (step.kind === 'message') {
      afterFirstReply = true
      continue
    }
    if (!afterFirstReply && initialDurationMs !== undefined) continue
    const { startedAt, durationMs } = stepTiming(step)
    if (durationMs === undefined) continue
    const start = Date.parse(startedAt ?? '')
    elapsed = Number.isFinite(requestStart) && Number.isFinite(start)
      ? Math.max(elapsed ?? 0, start + durationMs - requestStart)
      : (elapsed ?? 0) + durationMs
  }
  return elapsed
}
