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
  CheckCircle2,
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
}

type WorkspaceItem = {
  type: 'pulpo_workspace'
  state?: string
  position?: number
  error?: string
}

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

function ActivityToolRow({ tool }: { tool: ToolItem }) {
  const [open, setOpen] = useState(tool.status === 'running')
  const Icon = toolIcon(tool.tool)
  const running = tool.status === 'running'
  const failed = tool.status === 'failed' || tool.isError
  const hasBody = tool.arguments !== undefined || Boolean(tool.output)

  useEffect(() => {
    if (running) setOpen(true)
  }, [running])

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

function ActivityBlock({
  reasoning,
  tools,
  streaming,
  startedAt,
  latencyMs,
  showReasoning,
}: {
  reasoning?: string
  tools: ToolItem[]
  streaming: boolean
  startedAt: number
  latencyMs?: number
  showReasoning: boolean
}) {
  const [open, setOpen] = useState(false)
  const hasTools = tools.length > 0
  const visibleReasoning = showReasoning && reasoning !== undefined && (Boolean(reasoning) || streaming)
  const show = visibleReasoning || hasTools
  const runningTool = tools.find((tool) => tool.status === 'running')
  const elapsedMs = useElapsedMs(startedAt, streaming, latencyMs)

  const label = useMemo(() => {
    if (runningTool) return `Running ${runningTool.tool ?? 'tool'}…`
    if (streaming && hasTools) return 'Working…'
    if (streaming && visibleReasoning) return 'Thinking…'
    if (streaming) return 'Working…'
    const duration = formatSecondsLabel(elapsedMs)
    if (hasTools) return `Worked for ${duration}`
    return `Thought for ${duration}`
  }, [runningTool, streaming, hasTools, visibleReasoning, elapsedMs])

  const triggerIcon = (() => {
    if (runningTool) {
      const Icon = toolIcon(runningTool.tool)
      return <Icon className="size-3.5 shrink-0 animate-pulse" />
    }
    if (streaming && hasTools) return <Wrench className="size-3.5 shrink-0 animate-pulse" />
    if (streaming) return <Brain className="size-3.5 shrink-0 animate-pulse" />
    if (hasTools) return <Wrench className="size-3.5 shrink-0" />
    return <Brain className="size-3.5 shrink-0" />
  })()

  if (!show) return null

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-1.5">
      <CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
        {triggerIcon}
        <span>{label}</span>
        {hasTools && !streaming && (
          <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-normal tabular-nums text-muted-foreground">
            {tools.length}
          </span>
        )}
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 space-y-2 border-l-2 border-muted pl-3">
          {visibleReasoning && reasoning ? (
            <div className="whitespace-pre-wrap text-[13px] leading-6 text-muted-foreground">
              {reasoning}
            </div>
          ) : null}
          {visibleReasoning && !reasoning && streaming && !hasTools ? (
            <div className="text-[13px] leading-6 text-muted-foreground/70">Thinking…</div>
          ) : null}
          {hasTools && (
            <div className="space-y-0.5">
              {tools.map((tool, index) => (
                <ActivityToolRow key={tool.id ?? `${tool.tool}:${index}`} tool={tool} />
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function WorkspaceStatus({
  item,
  messageId,
  onStop,
  onContinue,
  pending,
}: {
  item: WorkspaceItem
  messageId: string
  onStop: (id: string) => void
  onContinue: (id: string) => void
  pending: boolean
}) {
  const active = item.state === 'waiting' || item.state === 'provisioning'
  const failed = item.state === 'expired' || item.state === 'unavailable'
  const quiet = item.state === 'ready' || item.state === 'running'
  if (quiet) return null

  const label =
    item.state === 'waiting'
      ? `Waiting for workspace${typeof item.position === 'number' ? ` · queue #${item.position}` : ''}`
      : item.state === 'provisioning'
        ? 'Starting workspace…'
        : item.state === 'continuing_without_agent'
          ? 'Continuing without agent tools'
          : `Workspace ${item.state?.replaceAll('_', ' ') ?? 'unavailable'}`

  return (
    <div role="status" className="mt-1.5 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        {active ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : failed ? (
          <XCircle className="size-3.5 shrink-0 text-destructive" />
        ) : item.state === 'continuing_without_agent' ? (
          <Server className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
        )}
        <span className="font-medium text-foreground/90">{label}</span>
        {item.error && <span className="ml-auto text-destructive">{item.error}</span>}
      </div>
      {item.state === 'waiting' && (
        <div className="mt-2 flex flex-wrap gap-2 border-t pt-2">
          <Button size="sm" variant="outline" onClick={() => onStop(messageId)}>
            Cancel generation
          </Button>
          <Button size="sm" disabled={pending} onClick={() => onContinue(messageId)}>
            {pending ? 'Continuing…' : 'Continue without agent'}
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
  const tools = outputItems.filter((item): item is ToolItem => (item as { type?: string }).type === 'pulpo_tool')
  const workspace = outputItems.find((item): item is WorkspaceItem => (item as { type?: string }).type === 'pulpo_workspace')
  const otherItems = outputItems.filter((item) => {
    const type = (item as { type?: string }).type
    return type && !['message', 'reasoning', 'pulpo_tool', 'pulpo_workspace'].includes(type)
  })
  const showActivity =
    (showReasoning && message.reasoning !== undefined && (Boolean(message.reasoning) || streaming)) ||
    tools.length > 0
  const isActivityPending = streaming && !message.content && (showActivity || Boolean(workspace && (workspace.state === 'waiting' || workspace.state === 'provisioning')))

  return (
    <div className="group flex gap-3">
      <ModelIcon model={model} className="mt-1 size-7 rounded-[4px]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">{model.name}</span>
          <span className="text-xs text-muted-foreground">{timeAgo(message.timestamp)}</span>
        </div>

        {workspace && (
          <WorkspaceStatus
            item={workspace}
            messageId={message.id}
            onStop={stopStreaming}
            onContinue={(id) => {
              setCapacityActionPending(true)
              void continueWithoutAgent(id).catch(() => setCapacityActionPending(false))
            }}
            pending={capacityActionPending}
          />
        )}

        {showActivity && (
          <ActivityBlock
            reasoning={message.reasoning}
            tools={tools}
            streaming={streaming}
            startedAt={message.timestamp}
            latencyMs={message.latencyMs}
            showReasoning={showReasoning}
          />
        )}

        {editing ? (
          <div className="mt-2 rounded-2xl border bg-card p-3">
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
        ) : (
        <div className={cn('mt-1 text-[15px]', streaming && message.content && 'stream-caret')}>
          {message.error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {message.error}
            </div>
          ) : message.content ? (
            <Markdown content={message.content} />
          ) : (
            !isActivityPending && (
              <span className="inline-flex gap-1 py-2">
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
              </span>
            )
          )}
        </div>
        )}

        {otherItems.map((item, index) => {
          const type = (item as { type?: string }).type ?? 'unknown'
          return (
            <details
              key={`${type}:${index}`}
              className="mt-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs"
            >
              <summary className="cursor-pointer font-medium">{type.replaceAll('_', ' ')}</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
                {JSON.stringify(item, null, 2)}
              </pre>
            </details>
          )
        })}

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
