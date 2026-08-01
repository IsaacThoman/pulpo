import { memo, useState } from 'react'
import {
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Pencil,
  RefreshCw,
  Trash2,
  Terminal,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import type { Chat, Message } from '@/lib/types'
import { getCatalogModel } from '@/stores/catalog'
import { formatCost, formatDuration, timeAgo } from '@/lib/format'
import { useChat } from '@/stores/chat'
import { useSettings } from '@/stores/settings'
import { Markdown } from './Markdown'
import { MessageAttachmentList } from './AttachmentImage'
import { ModelIcon } from '@/components/ModelIcon'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

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
  const { regenerate, editUserMessage, editAssistantMessage, deleteUserMessage } = useChat()
  const showReasoning = useSettings((s) => s.showReasoning)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const [reasoningOpen, setReasoningOpen] = useState(false)
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
  const isThinking = streaming && !message.content && message.reasoning !== undefined

  return (
    <div className="group flex gap-3">
      <ModelIcon model={model} className="mt-1 size-7 rounded-[4px]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">{model.name}</span>
          <span className="text-xs text-muted-foreground">{timeAgo(message.timestamp)}</span>
        </div>

        {message.reasoning !== undefined && showReasoning && (message.reasoning || streaming) && (
          <Collapsible
            open={reasoningOpen && !(!streaming && !reasoningOpen)}
            onOpenChange={setReasoningOpen}
            className="mt-1.5"
          >
            <CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
              <Brain className={cn('size-3.5', isThinking && 'animate-pulse')} />
              {isThinking ? 'Thinking…' : 'Thought for a moment'}
              <ChevronRight className={cn('size-3 transition-transform', reasoningOpen && 'rotate-90')} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-1.5 border-l-2 border-muted pl-3 text-[13px] leading-6 text-muted-foreground">
                {message.reasoning}
              </div>
            </CollapsibleContent>
          </Collapsible>
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
            !isThinking && (
              <span className="inline-flex gap-1 py-2">
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
              </span>
            )
          )}
        </div>
        )}

        {message.agentMode && (
          <p className="mt-2 text-[11px] text-muted-foreground">Agent workspace is shared by every branch in this chat and is not rewound.</p>
        )}

        {message.outputItems
          ?.filter((item) => !['message', 'reasoning'].includes((item as { type?: string }).type ?? ''))
          .map((item, index) => {
            const typed = item as { type?: string; tool?: string; status?: string; state?: string; arguments?: unknown; output?: string; isError?: boolean; error?: string }
            const type = typed.type ?? 'unknown'
            if (type === 'pulpo_workspace') {
              const active = typed.state === 'provisioning'
              const failed = typed.state === 'expired' || typed.state === 'unavailable'
              return (
                <div key={`${type}:${index}`} role="status" className="mt-3 flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
                  {active ? <Loader2 className="size-3.5 animate-spin" /> : failed ? <XCircle className="size-3.5 text-destructive" /> : <CheckCircle2 className="size-3.5 text-emerald-600" />}
                  <span>Workspace {typed.state}</span>
                  {typed.error && <span className="ml-auto text-destructive">{typed.error}</span>}
                </div>
              )
            }
            if (type === 'pulpo_tool') return (
              <details key={`${type}:${index}`} open={typed.status === 'running'} className="mt-3 overflow-hidden rounded-lg border bg-muted/20 text-xs">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium">
                  <Terminal className="size-3.5" />
                  <span className="font-mono">{typed.tool}</span>
                  <span className="ml-auto text-muted-foreground">{typed.status === 'running' ? <Loader2 className="size-3.5 animate-spin" /> : typed.status === 'failed' || typed.isError ? <XCircle className="size-3.5 text-destructive" /> : <CheckCircle2 className="size-3.5 text-emerald-600" />}</span>
                </summary>
                <div className="border-t px-3 py-2">
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">{JSON.stringify(typed.arguments, null, 2)}</pre>
                  {typed.output && <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-background/60 p-2 text-[11px]">{typed.output}</pre>}
                </div>
              </details>
            )
            return (
              <details
                key={`${type}:${index}`}
                className="mt-3 rounded-lg border bg-muted/20 px-3 py-2 text-xs"
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
