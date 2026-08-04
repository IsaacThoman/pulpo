export type ToolItem = {
  type: 'pulpo_tool'
  id?: string
  tool?: string
  status?: string
  arguments?: unknown
  output?: string
  isError?: boolean
  startedAt?: string
  durationMs?: number
}

export type WorkspaceItem = {
  type: 'pulpo_workspace'
  state?: string
  position?: number
  error?: string
  startedAt?: string
  durationMs?: number
}

export type TimelineStep =
  | { kind: 'reasoning'; text: string; active: boolean; durationMs?: number }
  | { kind: 'tool'; tool: ToolItem }
  | { kind: 'workspace'; workspace: WorkspaceItem }

export type TimelineSegment =
  | { kind: 'activity'; steps: TimelineStep[]; active: boolean }
  | { kind: 'text'; text: string }

export function workspaceIsActive(state?: string): boolean {
  return state === 'waiting' || state === 'provisioning'
}

function textFromParts(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.map((part) => {
    const entry = part as { text?: string; content?: string; refusal?: string }
    return typeof part === 'string' ? part : entry.text ?? entry.content ?? entry.refusal ?? ''
  }).join('')
}

function activityHasContent(steps: TimelineStep[]): boolean {
  return steps.some((step) => step.kind !== 'reasoning' || Boolean(step.text) || step.active)
}

function insertWorkspace(steps: TimelineStep[], workspace: WorkspaceItem): TimelineStep[] {
  if (steps.some((step) => step.kind === 'workspace')) return steps
  const entry: TimelineStep = { kind: 'workspace', workspace }
  const firstTool = steps.findIndex((step) => step.kind === 'tool')
  return firstTool < 0 ? [entry, ...steps] : [...steps.slice(0, firstTool), entry, ...steps.slice(firstTool)]
}

/** Preserve the server's reasoning/tool/message order so agent turns render like web. */
export function buildMessageTimeline(output: unknown[], showReasoning: boolean): TimelineSegment[] {
  const segments: TimelineSegment[] = []
  let activity: Extract<TimelineSegment, { kind: 'activity' }> | null = null
  const workspace = output.find((item): item is WorkspaceItem => (item as { type?: string }).type === 'pulpo_workspace')

  const flush = () => {
    if (!activity) return
    const steps = showReasoning ? activity.steps : activity.steps.filter((step) => step.kind !== 'reasoning')
    if (activityHasContent(steps)) segments.push({ ...activity, steps })
    activity = null
  }

  for (const item of output) {
    const value = item as Record<string, unknown>
    if (value.type === 'pulpo_workspace') continue
    if (value.type === 'reasoning') {
      activity ??= { kind: 'activity', steps: [], active: false }
      const text = textFromParts(value.summary)
      const active = value.status === 'in_progress'
      if (text || active) {
        activity.steps.push({
          kind: 'reasoning', text, active,
          durationMs: typeof value.durationMs === 'number' ? value.durationMs : undefined,
        })
      }
      if (active) activity.active = true
      continue
    }
    if (value.type === 'pulpo_tool') {
      activity ??= { kind: 'activity', steps: [], active: false }
      const tool = item as ToolItem
      activity.steps.push({ kind: 'tool', tool })
      if (tool.status === 'running') activity.active = true
      continue
    }
    if (value.type === 'message') {
      const text = textFromParts(value.content)
      if (!text.trim()) continue
      flush()
      segments.push({ kind: 'text', text })
    }
  }
  flush()

  if (workspace) {
    const target = segments.find((segment): segment is Extract<TimelineSegment, { kind: 'activity' }> =>
      segment.kind === 'activity' && segment.steps.some((step) => step.kind === 'tool'))
      ?? segments.find((segment): segment is Extract<TimelineSegment, { kind: 'activity' }> => segment.kind === 'activity')
    if (target) {
      target.steps = insertWorkspace(target.steps, workspace)
      if (workspaceIsActive(workspace.state)) target.active = true
    } else {
      segments.unshift({ kind: 'activity', steps: [{ kind: 'workspace', workspace }], active: workspaceIsActive(workspace.state) })
    }
  }
  return segments
}

export function activityDurationMs(steps: TimelineStep[]): number | undefined {
  const durations = steps.flatMap((step) => {
    if (step.kind === 'reasoning') return step.durationMs === undefined ? [] : [step.durationMs]
    const duration = step.kind === 'tool' ? step.tool.durationMs : step.workspace.durationMs
    return duration === undefined ? [] : [duration]
  })
  return durations.length ? durations.reduce((sum, value) => sum + value, 0) : undefined
}
