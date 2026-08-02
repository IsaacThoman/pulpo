import { memo, useEffect, useMemo, useState } from 'react'
import {
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FilePenLine,
  FileText,
  FolderSearch,
  List,
  Pencil,
  RefreshCw,
  Search,
  Server,
  Terminal,
  Trash2,
  Wrench,
  Loader2,
  XCircle,
} from 'lucide-react'
import type { Chat, Message } from '@/lib/types'
import { getCatalogModel } from '@/stores/catalog'
import { formatCost, formatDuration, formatSecondsLabel, timeAgo } from '@/lib/format'
import { useChat } from '@/stores/chat'
import { useSettings } from '@/stores/settings'
import { Markdown } from './Markdown'
import { MessageAttachmentList } from './AttachmentImage'
import { ModelIcon } from '@/components/ModelIcon'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

type ToolItem = {
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

type WorkspaceItem = {
  type: 'pulpo_workspace'
  state?: string
  position?: number
  error?: string
  startedAt?: string
  durationMs?: number
}

type ReasoningStep = {
  kind: 'reasoning'
  text: string
  active: boolean
  durationMs?: number
}

type ToolStep = {
  kind: 'tool'
  tool: ToolItem
}

type WorkspaceStep = {
  kind: 'workspace'
  workspace: WorkspaceItem
}

type ActivityStep = ReasoningStep | ToolStep | WorkspaceStep

function ActionButton({
  label,
  onClick,
  active,
  disabled,
  children,
}: {
  label: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground',
        active && 'text-foreground'
      )}
    >
      {children}
    </button>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <ActionButton
      label="Copy"
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => {})
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </ActionButton>
  )
}

function BranchControls({
  chatId,
  branch,
}: {
  chatId: string
  branch?: Message['branch']
}) {
  const activateBranch = useChat((state) => state.activateBranch)
  if (!branch || branch.ids.length < 2) return null

  const activate = (index: number) => {
    const responseId = branch.ids[index]
    if (responseId) activateBranch(chatId, responseId)
  }

  return (
    <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
      <ActionButton
        label="Previous branch"
        onClick={() => activate(branch.index - 1)}
        disabled={branch.index === 0}
      >
        <ChevronLeft className="size-3.5" />
      </ActionButton>
      <span className="min-w-8 text-center tabular-nums">
        {branch.index + 1} / {branch.ids.length}
      </span>
      <ActionButton
        label="Next branch"
        onClick={() => activate(branch.index + 1)}
        disabled={branch.index === branch.ids.length - 1}
      >
        <ChevronRight className="size-3.5" />
      </ActionButton>
    </div>
  )
}

function toolIcon(name?: string) {
  switch (name) {
    case 'read':
      return FileText
    case 'write':
    case 'edit':
      return FilePenLine
    case 'bash':
      return Terminal
    case 'ls':
      return List
    case 'find':
      return FolderSearch
    case 'grep':
      return Search
    default:
      return Wrench
  }
}

function toolSummary(tool: ToolItem): string {
  const args = tool.arguments
  if (!args || typeof args !== 'object') return tool.tool ?? 'tool'
  const record = args as Record<string, unknown>
  const path = typeof record.path === 'string' ? record.path : undefined
  const command = typeof record.command === 'string' ? record.command : undefined
  const pattern = typeof record.pattern === 'string' ? record.pattern : undefined
  const query = typeof record.query === 'string' ? record.query : undefined
  if (tool.tool === 'bash' && command) {
    const oneLine = command.replace(/\s+/g, ' ').trim()
    return oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine
  }
  if (path) return path
  if (pattern) return pattern
  if (query) return query
  return tool.tool ?? 'tool'
}

function useElapsedMs(startTs: number, active: boolean, finalMs?: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [active, startTs])
  if (finalMs !== undefined) return finalMs
  if (!active) return 0
  return Math.max(0, now - startTs)
}

function stepSecondsLabel(ms?: number): string | null {
  if (ms === undefined || ms < 0) return null
  const seconds = Math.max(0, Math.round(ms / 1000))
  return `${seconds}s`
}

function StepDuration({ ms, live }: { ms?: number; live?: boolean }) {
  const label = stepSecondsLabel(ms)
  if (!label && !live) return null
  return (
    <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground/70">
      {live && !label ? '…' : label}
    </span>
  )
}

function ActivityToolRow({ tool }: { tool: ToolItem }) {
  const [open, setOpen] = useState(false)
  const Icon = toolIcon(tool.tool)
  const running = tool.status === 'running'
  const failed = tool.status === 'failed' || tool.isError
  const hasBody = tool.arguments !== undefined || Boolean(tool.output)
  const liveMs = useElapsedMs(
    tool.startedAt ? Date.parse(tool.startedAt) : 0,
    running && Boolean(tool.startedAt),
    tool.durationMs,
  )

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-1.5 rounded-md py-0.5 text-left text-[12px] text-muted-foreground hover:text-foreground">
        {running ? (
          <Loader2 className="size-3 shrink-0 animate-spin" />
        ) : failed ? (
          <XCircle className="size-3 shrink-0 text-destructive" />
        ) : (
          <Icon className="size-3 shrink-0" />
        )}
        <span className="shrink-0 font-medium text-foreground/80">{tool.tool ?? 'tool'}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] opacity-80">{toolSummary(tool)}</span>
        <StepDuration ms={running ? liveMs : tool.durationMs} live={running} />
        {hasBody && (
          <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
        )}
      </CollapsibleTrigger>
      {hasBody && (
        <CollapsibleContent>
          <div className="mt-1 space-y-1.5 pl-4">
            {tool.arguments !== undefined && (
              <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-4 text-muted-foreground/90">
                {typeof tool.arguments === 'string'
                  ? tool.arguments
                  : JSON.stringify(tool.arguments, null, 2)}
              </pre>
            )}
            {tool.output && (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/40 px-2 py-1.5 font-mono text-[11px] leading-4 text-muted-foreground">
                {tool.output}
              </pre>
            )}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}

type ActivitySegment = {
  kind: 'activity'
  steps: ActivityStep[]
  active: boolean
}

type TextSegment = {
  kind: 'text'
  text: string
}

type TimelineSegment = ActivitySegment | TextSegment

function workspaceIsQuiet(state?: string) {
  return state === 'ready' || state === 'running'
}

function workspaceIsActive(state?: string) {
  return state === 'waiting' || state === 'provisioning'
}

function workspaceIsFailed(state?: string) {
  return state === 'expired' || state === 'unavailable'
}

function workspaceLabel(item: WorkspaceItem): string {
  if (item.state === 'waiting') {
    return `Waiting for workspace${typeof item.position === 'number' ? ` · queue #${item.position}` : ''}`
  }
  if (item.state === 'provisioning') return 'Starting workspace…'
  if (item.state === 'continuing_without_agent') return 'Continuing without agent tools'
  if (workspaceIsFailed(item.state)) return `Workspace ${item.state?.replaceAll('_', ' ') ?? 'unavailable'}`
  if (workspaceIsQuiet(item.state)) return 'Started workspace'
  return 'Workspace'
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

function activityHasContent(steps: ActivityStep[], showReasoning: boolean): boolean {
  return steps.some((step) => {
    if (step.kind === 'reasoning') return showReasoning && Boolean(step.text)
    return true
  })
}

function insertWorkspaceStep(steps: ActivityStep[], workspace: WorkspaceItem): ActivityStep[] {
  if (steps.some((step) => step.kind === 'workspace')) return steps
  const step: WorkspaceStep = { kind: 'workspace', workspace }
  const firstTool = steps.findIndex((entry) => entry.kind === 'tool')
  if (firstTool === -1) return [step, ...steps]
  return [...steps.slice(0, firstTool), step, ...steps.slice(firstTool)]
}

/** Group consecutive reasoning/tools into activity blocks; messages become text segments.
 *  Steps keep arrival order (think → tool → think → tool). Workspace is lazy-started on the
 *  first tool call, so it is inserted immediately before the first tool step. */
function buildTimeline(outputItems: unknown[], showReasoning: boolean): TimelineSegment[] {
  const segments: TimelineSegment[] = []
  let activity: ActivitySegment | null = null
  const workspace = outputItems.find(
    (item): item is WorkspaceItem => (item as { type?: string }).type === 'pulpo_workspace',
  )

  const flushActivity = () => {
    if (!activity) return
    const steps = showReasoning
      ? activity.steps
      : activity.steps.filter((step) => step.kind !== 'reasoning')
    if (activityHasContent(steps, true)) {
      segments.push({ ...activity, steps })
    }
    activity = null
  }

  for (const item of outputItems) {
    const type = (item as { type?: string }).type
    if (type === 'pulpo_workspace') continue
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
    if (type === 'message') {
      flushActivity()
      const text = messageTextFromItem(item)
      if (text) segments.push({ kind: 'text', text })
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

  return segments
}

const WORKSPACE_ACTIONS_DELAY_MS = 15_000

function WorkspaceStepRow({ workspace }: { workspace: WorkspaceItem }) {
  const busy = workspaceIsActive(workspace.state)
  const failed = workspaceIsFailed(workspace.state)
  const liveMs = useElapsedMs(
    workspace.startedAt ? Date.parse(workspace.startedAt) : 0,
    busy && Boolean(workspace.startedAt),
    workspace.durationMs,
  )

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        {busy ? (
          <Loader2 className="size-3 shrink-0 animate-spin" />
        ) : failed ? (
          <XCircle className="size-3 shrink-0 text-destructive" />
        ) : (
          <Server className="size-3 shrink-0" />
        )}
        <span className="min-w-0 flex-1">{workspaceLabel(workspace)}</span>
        <StepDuration ms={busy ? liveMs : workspace.durationMs} live={busy} />
      </div>
      {workspace.error && (
        <div className="text-[12px] leading-5 text-destructive">{workspace.error}</div>
      )}
    </div>
  )
}

function ReasoningStepRow({ step }: { step: ReasoningStep }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1 whitespace-pre-wrap text-[13px] leading-5 text-muted-foreground">
          {step.text || (step.active ? 'Thinking…' : '')}
        </div>
        {!step.active && step.durationMs !== undefined ? (
          <StepDuration ms={step.durationMs} />
        ) : null}
      </div>
    </div>
  )
}

function ActivityBlock({
  steps,
  active,
  showDuration,
  durationMs,
  messageId,
  onStop,
  onContinue,
  capacityPending,
}: {
  steps: ActivityStep[]
  active: boolean
  showDuration: boolean
  durationMs?: number
  messageId: string
  onStop: (id: string) => void
  onContinue: (id: string) => void
  capacityPending: boolean
}) {
  const workspace = steps.find((step): step is WorkspaceStep => step.kind === 'workspace')?.workspace
  const tools = steps.flatMap((step) => (step.kind === 'tool' ? [step.tool] : []))
  const hasReasoning = steps.some((step) => step.kind === 'reasoning' && step.text)
  const workspaceBusy = workspaceIsActive(workspace?.state)
  const workspaceFailed = workspaceIsFailed(workspace?.state)
  const isWaiting = workspace?.state === 'waiting'
  const [showWorkspaceActions, setShowWorkspaceActions] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!isWaiting) {
      setShowWorkspaceActions(false)
      return
    }
    const timer = setTimeout(() => setShowWorkspaceActions(true), WORKSPACE_ACTIONS_DELAY_MS)
    return () => clearTimeout(timer)
  }, [isWaiting])

  const needsWorkspaceActions = isWaiting && showWorkspaceActions
  const hasTools = tools.length > 0
  const hasWorkspace = Boolean(workspace)
  const runningTool = tools.find((tool) => tool.status === 'running')

  const label = useMemo(() => {
    if (workspace && workspaceBusy) return workspaceLabel(workspace)
    if (workspaceFailed && workspace) return workspaceLabel(workspace)
    if (workspace?.state === 'continuing_without_agent' && !hasTools && !hasReasoning && !active) {
      return workspaceLabel(workspace)
    }
    if (runningTool) return `Running ${runningTool.tool ?? 'tool'}…`
    if (active && hasTools) return 'Working…'
    if (active) return 'Thinking…'
    if (showDuration && durationMs !== undefined) {
      const duration = formatSecondsLabel(durationMs)
      return hasTools || hasWorkspace ? `Worked for ${duration}` : `Thought for ${duration}`
    }
    return hasTools || hasWorkspace ? 'Worked' : 'Thought'
  }, [workspace, workspaceBusy, workspaceFailed, runningTool, active, hasTools, hasReasoning, hasWorkspace, showDuration, durationMs])

  const triggerIcon = (() => {
    if (workspace && workspaceBusy) {
      return <Server className="size-3.5 shrink-0 animate-pulse" />
    }
    if (workspaceFailed) return <XCircle className="size-3.5 shrink-0 text-destructive" />
    if (runningTool) {
      const Icon = toolIcon(runningTool.tool)
      return <Icon className="size-3.5 shrink-0 animate-pulse" />
    }
    if (active && hasTools) return <Wrench className="size-3.5 shrink-0 animate-pulse" />
    if (active) return <Brain className="size-3.5 shrink-0 animate-pulse" />
    if (hasTools) return <Wrench className="size-3.5 shrink-0" />
    if (hasWorkspace && !hasReasoning) return <Server className="size-3.5 shrink-0" />
    return <Brain className="size-3.5 shrink-0" />
  })()

  if (steps.length === 0) return null

  return (
    <div className="space-y-1.5">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
          {triggerIcon}
          <span>{label}</span>
          {hasTools && !active && !workspaceBusy && (
            <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-normal tabular-nums text-muted-foreground">
              {tools.length}
            </span>
          )}
          <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1 space-y-1.5 border-l-2 border-muted py-0.5 pl-2.5">
            {steps.map((step, index) => {
              if (step.kind === 'reasoning') {
                return <ReasoningStepRow key={`reasoning:${index}`} step={step} />
              }
              if (step.kind === 'workspace') {
                return <WorkspaceStepRow key={`workspace:${index}`} workspace={step.workspace} />
              }
              return (
                <ActivityToolRow
                  key={step.tool.id ?? `tool:${index}`}
                  tool={step.tool}
                />
              )
            })}
            {active && steps.length === 0 ? (
              <div className="text-[13px] leading-5 text-muted-foreground/70">Thinking…</div>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
      {needsWorkspaceActions && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => onStop(messageId)}>
            Cancel generation
          </Button>
          <Button size="sm" disabled={capacityPending} onClick={() => onContinue(messageId)}>
            {capacityPending ? 'Continuing…' : 'Continue without agent'}
          </Button>
        </div>
      )}
    </div>
  )
}

export const MessageItem = memo(function MessageItem({
  chat,
  message,
  streaming,
  activeModelId,
}: {
  chat: Chat
  message: Message
  streaming: boolean
  activeModelId: string
}) {
  const { regenerate, editUserMessage, editAssistantMessage, deleteUserMessage, stopStreaming, continueWithoutAgent } = useChat()
  const showReasoning = useSettings((s) => s.showReasoning)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const [capacityActionPending, setCapacityActionPending] = useState(false)
  const timeline = useMemo(() => {
    if (message.role !== 'assistant') return [] as TimelineSegment[]
    const items = message.outputItems ?? []
    if (items.length > 0) return buildTimeline(items, showReasoning)
    const segments: TimelineSegment[] = []
    if (showReasoning && message.reasoning !== undefined && (message.reasoning || streaming)) {
      segments.push({
        kind: 'activity',
        steps: message.reasoning || streaming
          ? [{
              kind: 'reasoning',
              text: message.reasoning || '',
              active: streaming && !message.content,
            }]
          : [],
        active: streaming && !message.content,
      })
    }
    if (message.content) segments.push({ kind: 'text', text: message.content })
    return segments
  }, [message.role, message.outputItems, showReasoning, message.reasoning, message.content, streaming])
  const elapsedMs = useElapsedMs(message.timestamp, streaming && message.role === 'assistant', message.latencyMs)
  const hasAttachments = Boolean(message.attachments?.length)
  const submitEdit = () => {
    const content = draft.trim()
    if (message.role === 'user') {
      if (!content && !hasAttachments) return
      if (content === message.content) {
        setEditing(false)
        return
      }
      setEditing(false)
      editUserMessage(chat.id, message.id, content, activeModelId)
      return
    }
    if (!content || content === message.content) return
    setEditing(false)
    editAssistantMessage(chat.id, message.id, content)
  }
  const handleEditKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submitEdit()
    }
  }

  if (message.role === 'user') {
    return (
      <div className="group flex flex-col items-end gap-1">
        {editing ? (
          <div className="w-full max-w-xl rounded-2xl border bg-card p-3">
            {message.attachments && message.attachments.length > 0 && (
              <div className="mb-3">
                <MessageAttachmentList attachments={message.attachments} align="start" />
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Attachments stay with this message when you edit.
                </p>
              </div>
            )}
            <textarea
              className="w-full resize-none bg-transparent text-sm outline-none"
              rows={Math.min(10, Math.max(2, draft.split('\n').length + 1))}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleEditKeyDown}
              placeholder={hasAttachments ? 'Add a caption…' : 'Message…'}
              autoFocus
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => {
                setDraft(message.content)
                setEditing(false)
              }}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={submitEdit}
                disabled={(!draft.trim() && !hasAttachments) || draft.trim() === message.content}
              >
                Save & resend
              </Button>
            </div>
          </div>
        ) : (
          <div className={cn(
            'max-w-[85%] rounded-2xl rounded-br-md bg-secondary text-[15px] leading-7',
            message.content ? 'px-4 py-2.5' : 'p-2',
          )}>
            {message.attachments && message.attachments.length > 0 && (
              <div className={cn(message.content ? 'mb-2' : undefined)}>
                <MessageAttachmentList attachments={message.attachments} />
              </div>
            )}
            {message.content ? <Markdown content={message.content} /> : null}
          </div>
        )}
        {!editing && (
          <div className="flex items-center gap-1">
            <BranchControls chatId={chat.id} branch={message.branch} />
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              {message.content ? <CopyButton text={message.content} /> : null}
              <ActionButton
                label="Edit"
                onClick={() => {
                  setDraft(message.content)
                  setEditing(true)
                }}
              >
                <Pencil className="size-3.5" />
              </ActionButton>
              <ActionButton label="Delete message" onClick={() => { if (confirm('Delete this user message and every response that follows from it?')) deleteUserMessage(chat.id, message.id) }}>
                <Trash2 className="size-3.5" />
              </ActionButton>
            </div>
          </div>
        )}
      </div>
    )
  }

  const model = getCatalogModel(message.modelId ?? chat.modelId)
  const outputItems = message.outputItems ?? []
  const otherItems = outputItems.filter((item) => {
    const type = (item as { type?: string }).type
    return type && !['message', 'reasoning', 'pulpo_tool', 'pulpo_workspace'].includes(type)
  })
  const activitySegments = timeline.filter((segment): segment is ActivitySegment => segment.kind === 'activity')
  const lastActivityIndex = activitySegments.length - 1
  const hasVisibleBody = timeline.length > 0 || Boolean(message.error)
  let activityOrdinal = -1

  return (
    <div className="group flex gap-3">
      <ModelIcon model={model} className="mt-1 size-7 rounded-[4px]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">{model.name}</span>
          <span className="text-xs text-muted-foreground">{timeAgo(message.timestamp)}</span>
        </div>

        <div className="mt-1 flex flex-col gap-1.5">
          {editing ? (
            <div className="rounded-2xl border bg-card p-3">
              <textarea
                className="w-full resize-none bg-transparent text-sm leading-6 outline-none"
                rows={Math.min(16, Math.max(3, draft.split('\n').length + 1))}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleEditKeyDown}
                autoFocus
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={submitEdit}
                  disabled={!draft.trim() || draft.trim() === message.content}
                >
                  Save as branch
                </Button>
              </div>
            </div>
          ) : message.error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {message.error}
            </div>
          ) : (
            <>
              {timeline.map((segment, index) => {
                if (segment.kind === 'activity') {
                  activityOrdinal += 1
                  const isLastActivity = activityOrdinal === lastActivityIndex
                  return (
                    <ActivityBlock
                      key={`activity:${index}`}
                      steps={segment.steps}
                      active={segment.active || (streaming && isLastActivity && !timeline.slice(index + 1).some((entry) => entry.kind === 'text'))}
                      showDuration={!streaming && isLastActivity}
                      durationMs={elapsedMs}
                      messageId={message.id}
                      onStop={stopStreaming}
                      onContinue={(id) => {
                        setCapacityActionPending(true)
                        void continueWithoutAgent(id).catch(() => setCapacityActionPending(false))
                      }}
                      capacityPending={capacityActionPending}
                    />
                  )
                }
                const isLastText = !timeline.slice(index + 1).some((entry) => entry.kind === 'text')
                return (
                  <div
                    key={`text:${index}`}
                    className={cn('text-[15px]', streaming && isLastText && 'stream-caret')}
                  >
                    <Markdown content={segment.text} />
                  </div>
                )
              })}
              {!hasVisibleBody && streaming && (
                <span className="inline-flex gap-1 py-1">
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
                </span>
              )}
            </>
          )}

          {otherItems.map((item, index) => {
            const type = (item as { type?: string }).type ?? 'unknown'
            return (
              <details
                key={`${type}:${index}`}
                className="rounded-lg border bg-muted/20 px-3 py-2 text-xs"
              >
                <summary className="cursor-pointer font-medium">{type.replaceAll('_', ' ')}</summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
                  {JSON.stringify(item, null, 2)}
                </pre>
              </details>
            )
          })}
        </div>

        {message.done && (
          <div className="mt-1.5 flex items-center gap-1">
            <BranchControls chatId={chat.id} branch={message.branch} />
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <CopyButton text={message.content} />
              <ActionButton
                label="Edit response"
                onClick={() => {
                  setDraft(message.content)
                  setEditing(true)
                }}
              >
                <Pencil className="size-3.5" />
              </ActionButton>
              <ActionButton label="Regenerate" onClick={() => regenerate(chat.id, message.id, activeModelId)}>
                <RefreshCw className="size-3.5" />
              </ActionButton>
              {(message.tokensIn !== undefined || message.cost !== undefined) && (
                <span className="ml-1 text-[11px] text-muted-foreground">
                  {message.tokensIn !== undefined &&
                    `${message.tokensIn.toLocaleString()}→${(message.tokensOut ?? 0).toLocaleString()} tok`}
                  {message.tokensOut !== undefined &&
                    message.latencyMs !== undefined &&
                    message.latencyMs > 0 &&
                    ` · ${Math.round((message.tokensOut * 1000) / message.latencyMs)}tok/sec`}
                  {message.cost !== undefined && ` · ${formatCost(message.cost)}`}
                  {message.latencyMs !== undefined && ` · ${formatDuration(message.latencyMs)}`}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

export function UserAvatar() {
  return (
    <Avatar className="size-7">
      <AvatarFallback className="bg-zinc-700 text-[10px] font-semibold text-zinc-100 dark:bg-zinc-300 dark:text-zinc-900">
        IT
      </AvatarFallback>
    </Avatar>
  )
}
