import type { CompactionItem, RecallItem, ToolApprovalItem, ToolImagePreview } from '@pulpo/contracts'

export type ToolItem = {
  type: 'pulpo_tool'
  id?: string
  tool?: string
  status?: string
  arguments?: unknown
  output?: string
  imagePreview?: ToolImagePreview
  isError?: boolean
  startedAt?: string
  durationMs?: number
}

export type WorkspaceItem = {
  type: 'pulpo_workspace'
  state?: string
  /** Sandbox unless the run targets one of the user's computers. */
  kind?: 'sandbox' | 'computer'
  computerName?: string
  os?: string
  accessMode?: string
  position?: number
  error?: string
  startedAt?: string
  durationMs?: number
  continueWithoutAgentAvailableAt?: string
}

export type ReasoningStep = {
  kind: 'reasoning'
  text: string
  active: boolean
  durationMs?: number
}

export type ToolStep = {
  kind: 'tool'
  tool: ToolItem
}

export type WorkspaceStep = {
  kind: 'workspace'
  workspace: WorkspaceItem
}

export type CompactionStep = {
  kind: 'compaction'
  compaction: CompactionItem
}

export type RecallStep = {
  kind: 'recall'
  recall: RecallItem
}

export type ApprovalStep = {
  kind: 'approval'
  approval: ToolApprovalItem
}

export type ActivityStep = ReasoningStep | ToolStep | WorkspaceStep | CompactionStep | RecallStep | ApprovalStep

export function approvalIsPending(approval: ToolApprovalItem): boolean {
  return approval.status === 'pending' && Date.parse(approval.expires_at) > Date.now()
}

export type ActivitySegment = {
  kind: 'activity'
  steps: ActivityStep[]
  active: boolean
}

export type TextSegment = {
  kind: 'text'
  text: string
}

export type TimelineSegment = ActivitySegment | TextSegment

export function workspaceIsActive(state?: string) {
  return state === 'waiting' || state === 'provisioning'
}

function reasoningFromItem(item: unknown): string {
  const typed = item as { summary?: unknown[] }
  if (!Array.isArray(typed.summary)) return ''
  return typed.summary.map((part) => {
    const entry = part as { text?: string; content?: string }
    return entry.text ?? entry.content ?? ''
  }).join('')
}

function messageTextFromItem(item: unknown): string {
  const typed = item as { content?: unknown }
  if (typeof typed.content === 'string') return typed.content
  if (!Array.isArray(typed.content)) return ''
  return typed.content.map((part) => {
    const entry = part as { text?: string; content?: string }
    return entry.text ?? entry.content ?? ''
  }).join('')
}

function activityHasContent(steps: ActivityStep[]): boolean {
  return steps.some((step) => {
    if (step.kind === 'reasoning') return Boolean(step.text)
    return true
  })
}

function insertWorkspaceStep(steps: ActivityStep[], workspace: WorkspaceItem): ActivityStep[] {
  if (steps.some((step) => step.kind === 'workspace')) return steps
  const step: WorkspaceStep = { kind: 'workspace', workspace }
  const firstTool = steps.findIndex((entry) => entry.kind === 'tool' || entry.kind === 'approval')
  if (firstTool === -1) return [step, ...steps]
  return [...steps.slice(0, firstTool), step, ...steps.slice(firstTool)]
}

/**
 * Groups consecutive reasoning and tools into activity blocks while preserving visible
 * assistant messages as text segments. Provider-generated empty text parts are ignored,
 * so they cannot create artificial boundaries between work phases.
 */
export function buildTimeline(outputItems: unknown[], showReasoning: boolean): TimelineSegment[] {
  const segments: TimelineSegment[] = []
  let activity: ActivitySegment | null = null
  const workspace = outputItems.find(
    (item): item is WorkspaceItem => (item as { type?: string }).type === 'pulpo_workspace',
  )

  const flushActivity = () => {
    if (!activity) return
    if (activityHasContent(activity.steps)) {
      segments.push(activity)
    }
    activity = null
  }

  for (const item of outputItems) {
    const type = (item as { type?: string }).type
    if (type === 'pulpo_workspace') continue
    if (type === 'pulpo_recall') {
      if (!activity) activity = { kind: 'activity', steps: [], active: false }
      activity.steps.push({ kind: 'recall', recall: item as RecallItem })
      continue
    }
    if (type === 'pulpo_compaction') {
      flushActivity()
      const compaction = item as CompactionItem
      segments.push({
        kind: 'activity',
        steps: [{ kind: 'compaction', compaction }],
        active: compaction.status === 'in_progress',
      })
      continue
    }
    if (type === 'reasoning') {
      if (!activity) activity = { kind: 'activity', steps: [], active: false }
      const text = reasoningFromItem(item)
      if (text || (item as { status?: string }).status === 'in_progress') {
        activity.steps.push({
          kind: 'reasoning',
          text,
          active: (item as { status?: string }).status === 'in_progress',
          durationMs: typeof (item as { durationMs?: unknown }).durationMs === 'number'
            ? (item as { durationMs: number }).durationMs
            : undefined,
        })
      }
      if ((item as { status?: string }).status === 'in_progress') activity.active = true
      continue
    }
    if (type === 'pulpo_tool') {
      if (!activity) activity = { kind: 'activity', steps: [], active: false }
      const tool = item as ToolItem
      activity.steps.push({ kind: 'tool', tool })
      if (tool.status === 'running') activity.active = true
      continue
    }
    if (type === 'pulpo_approval') {
      if (!activity) activity = { kind: 'activity', steps: [], active: false }
      const approval = item as ToolApprovalItem
      activity.steps.push({ kind: 'approval', approval })
      if (approvalIsPending(approval)) activity.active = true
      continue
    }
    if (type === 'message') {
      const text = messageTextFromItem(item)
      if (!text.trim()) continue
      flushActivity()
      segments.push({ kind: 'text', text })
    }
  }
  flushActivity()

  if (workspace) {
    const toolActivity = segments.find(
      (segment): segment is ActivitySegment =>
        segment.kind === 'activity' && segment.steps.some((step) => step.kind === 'tool'),
    )
    const target = toolActivity
      ?? segments.find((segment): segment is ActivitySegment => segment.kind === 'activity')
    if (target) {
      target.steps = insertWorkspaceStep(target.steps, workspace)
      if (workspaceIsActive(workspace.state)) target.active = true
    } else {
      segments.unshift({
        kind: 'activity',
        steps: [{ kind: 'workspace', workspace }],
        active: workspaceIsActive(workspace.state),
      })
    }
  }

  // Approval controls remain available even when work details are hidden.
  if (showReasoning) return segments
  return segments.flatMap((segment): TimelineSegment[] => {
    if (segment.kind === 'text') return [segment]
    const steps = segment.steps.filter((step): step is ApprovalStep => step.kind === 'approval' && approvalIsPending(step.approval))
    return steps.length ? [{ kind: 'activity', steps, active: steps.some((step) => approvalIsPending(step.approval)) }] : []
  })
}
