import type { CompactionItem, RecallItem } from '@pulpo/contracts'
import { recalledChatLabel } from './recall-label'

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
  continueWithoutAgentAvailableAt?: string
}

export type TimelineStep =
  | { kind: 'reasoning'; text: string; active: boolean; durationMs?: number }
  | { kind: 'tool'; tool: ToolItem }
  | { kind: 'workspace'; workspace: WorkspaceItem }
  | { kind: 'compaction'; compaction: CompactionItem }
  | { kind: 'recall'; recall: RecallItem }

export type TimelineSegment =
  | { kind: 'activity'; steps: TimelineStep[]; active: boolean }
  | { kind: 'text'; text: string }

/**
 * Resolve an activity's visible state from its position in the response.
 * Item statuses can remain in progress until the next snapshot, but visible
 * assistant text is an authoritative boundary for all preceding activity.
 */
export function timelineActivityIsActive(
  timeline: TimelineSegment[],
  index: number,
  responseStreaming: boolean,
): boolean {
  const segment = timeline[index]
  if (segment?.kind !== 'activity') return false
  const following = timeline.slice(index + 1)
  if (following.some((entry) => entry.kind === 'text' && Boolean(entry.text.trim()))) return false
  const isLastActivity = !following.some((entry) => entry.kind === 'activity')
  return segment.active || (responseStreaming && isLastActivity)
}

export function completedActivityLabel(steps: TimelineStep[], durationMs?: number): string {
  const recall = steps.find((step) => step.kind === 'recall')
  const hasReasoning = steps.some((step) => step.kind === 'reasoning' && Boolean(step.text))
  const worked = steps.some((step) => step.kind === 'tool' || step.kind === 'workspace')
  if (recall?.kind === 'recall' && !hasReasoning && !worked) {
    return recalledChatLabel(recall.recall.sources.length)
  }
  const resolvedDurationMs = durationMs ?? activityDurationMs(steps)
  const seconds = resolvedDurationMs === undefined ? null : Math.max(0, Math.round(resolvedDurationMs / 1000))
  return `${worked ? 'Worked' : 'Thought'}${seconds === null ? '' : ` for ${seconds}s`}`
}

type LegacyMessageTimelineInput = {
  reasoning: string | undefined
  text: string
  streaming: boolean
  showReasoning: boolean
  reasoningDurationMs?: number
}

export function workspaceIsActive(state?: string): boolean {
  return state === 'waiting' || state === 'provisioning'
}

/**
 * Build the compatibility timeline used by cached messages that predate raw
 * output items. `undefined` means the provider never emitted reasoning; an
 * empty string means a reasoning item exists but has not emitted text yet.
 */
export function buildLegacyMessageTimeline({
  reasoning,
  text,
  streaming,
  showReasoning,
  reasoningDurationMs,
}: LegacyMessageTimelineInput): TimelineSegment[] {
  const segments: TimelineSegment[] = []
  if (showReasoning && reasoning?.trim()) {
    segments.push({
      kind: 'activity',
      active: streaming && !text,
      steps: [{
        kind: 'reasoning',
        text: reasoning,
        active: streaming && !text,
        durationMs: reasoningDurationMs,
      }],
    })
  }
  if (text) segments.push({ kind: 'text', text })
  return segments
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
    if (value.type === 'pulpo_recall') {
      activity ??= { kind: 'activity', steps: [], active: false }
      activity.steps.push({ kind: 'recall', recall: item as RecallItem })
      continue
    }
    if (value.type === 'pulpo_compaction') {
      flush()
      const compaction = item as CompactionItem
      segments.push({
        kind: 'activity',
        steps: [{ kind: 'compaction', compaction }],
        active: compaction.status === 'in_progress',
      })
      continue
    }
    if (value.type === 'reasoning') {
      const text = textFromParts(value.summary)
      const active = value.status === 'in_progress'
      if (text.trim()) {
        activity ??= { kind: 'activity', steps: [], active: false }
        activity.steps.push({
          kind: 'reasoning', text, active,
          durationMs: typeof value.durationMs === 'number' ? value.durationMs : undefined,
        })
        if (active) activity.active = true
      }
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
    if (step.kind === 'recall') return []
    if (step.kind === 'reasoning') return step.durationMs === undefined ? [] : [step.durationMs]
    const duration = step.kind === 'tool'
      ? step.tool.durationMs
      : step.kind === 'workspace'
        ? step.workspace.durationMs
        : step.compaction.duration_ms
    return duration === undefined ? [] : [duration]
  })
  return durations.length ? durations.reduce((sum, value) => sum + value, 0) : undefined
}
