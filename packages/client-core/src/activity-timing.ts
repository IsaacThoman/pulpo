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
