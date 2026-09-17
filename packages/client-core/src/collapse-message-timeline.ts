import { initialActivityTiming } from './activity-timing.js'

export type IntermediateMessageStep = { kind: 'message'; text: string }

type Segment<Step> =
  | { kind: 'text'; text: string }
  | { kind: 'activity'; steps: Step[]; active: boolean; durationMs?: number }

/** Collect a response's work, leaving only its trailing text outside the disclosure.
 * Run before applying visibility preferences; never mutate the stored timeline.
 */
export function collapseMessageTimeline<Step extends { kind: string }>(
  timeline: Segment<Step>[],
  activityDurationMs: (steps: Step[]) => number | undefined,
  initialResponseDurationMs?: number,
): Segment<Step | IntermediateMessageStep>[] {
  const last = timeline.at(-1)
  const work = last?.kind === 'text' ? timeline.slice(0, -1) : timeline
  const initial = initialActivityTiming(timeline)
  const steps: Array<Step | IntermediateMessageStep> = []
  const durations: number[] = []
  for (const [index, segment] of work.entries()) {
    if (segment.kind === 'text') {
      steps.push({ kind: 'message', text: segment.text })
      continue
    }
    steps.push(...segment.steps)
    // The server's initial wait already includes all activity before first text.
    if (initialResponseDurationMs !== undefined && index <= initial.index) {
      if (index === initial.index) durations.push(initialResponseDurationMs)
    } else {
      const duration = activityDurationMs(segment.steps)
      if (duration !== undefined) durations.push(duration)
    }
  }
  const result: Segment<Step | IntermediateMessageStep>[] = []
  if (steps.length) {
    result.push({
      kind: 'activity',
      steps,
      // Earlier item statuses may be stale; only trailing work can be active.
      active: last?.kind === 'activity' && last.active,
      durationMs: durations.length ? durations.reduce((sum, ms) => sum + ms, 0) : undefined,
    })
  }
  if (last?.kind === 'text') result.push(last)
  return result
}
