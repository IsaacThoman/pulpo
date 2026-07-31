import { memo, useState } from 'react'
import {
  Brain,
  Check,
  ChevronRight,
  Copy,
  Pencil,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import type { Chat, Message } from '@/lib/types'
import { getModel } from '@/lib/mock'
import { formatCost, formatDuration, formatNumber, timeAgo } from '@/lib/format'
import { useChat } from '@/stores/chat'
import { useSettings } from '@/stores/settings'
import { Markdown } from './Markdown'
import { ModelIcon } from '@/components/ModelIcon'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

function ActionButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string
  onClick?: () => void
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
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

export const MessageItem = memo(function MessageItem({
  chat,
  message,
  streaming,
}: {
  chat: Chat
  message: Message
  streaming: boolean
}) {
  const { regenerate, editUserMessage, rateMessage } = useChat()
  const showReasoning = useSettings((s) => s.showReasoning)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const [reasoningOpen, setReasoningOpen] = useState(true)

  if (message.role === 'user') {
    return (
      <div className="group flex flex-col items-end gap-1">
        {editing ? (
          <div className="w-full rounded-2xl border bg-card p-3">
            <textarea
              className="w-full resize-none bg-transparent text-sm outline-none"
              rows={Math.min(10, draft.split('\n').length + 1)}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setEditing(false)
                  if (draft.trim() && draft !== message.content)
                    editUserMessage(chat.id, message.id, draft.trim())
                }}
              >
                Save & resend
              </Button>
            </div>
          </div>
        ) : (
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[15px] leading-7">
            <div className="whitespace-pre-wrap">{message.content}</div>
          </div>
        )}
        {!editing && (
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <CopyButton text={message.content} />
            <ActionButton
              label="Edit"
              onClick={() => {
                setDraft(message.content)
                setEditing(true)
              }}
            >
              <Pencil className="size-3.5" />
            </ActionButton>
          </div>
        )}
      </div>
    )
  }

  const model = getModel(message.modelId ?? chat.modelId)
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

        <div className={cn('mt-1 text-[15px]', streaming && message.content && 'stream-caret')}>
          {message.content ? (
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

        {message.done && (
          <div className="mt-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <CopyButton text={message.content} />
            <ActionButton
              label="Good response"
              active={message.rating === 'up'}
              onClick={() => rateMessage(chat.id, message.id, message.rating === 'up' ? null : 'up')}
            >
              <ThumbsUp className="size-3.5" />
            </ActionButton>
            <ActionButton
              label="Bad response"
              active={message.rating === 'down'}
              onClick={() => rateMessage(chat.id, message.id, message.rating === 'down' ? null : 'down')}
            >
              <ThumbsDown className="size-3.5" />
            </ActionButton>
            <ActionButton label="Regenerate" onClick={() => regenerate(chat.id, message.id)}>
              <RefreshCw className="size-3.5" />
            </ActionButton>
            {(message.tokensIn !== undefined || message.cost !== undefined) && (
              <span className="ml-2 text-[11px] text-muted-foreground">
                {message.tokensIn !== undefined &&
                  `${formatNumber(message.tokensIn)}→${formatNumber(message.tokensOut ?? 0)} tok`}
                {message.cost !== undefined && ` · ${formatCost(message.cost)}`}
                {message.latencyMs !== undefined && ` · ${formatDuration(message.latencyMs)}`}
                {message.presetSelections &&
                  Object.keys(message.presetSelections).length > 0 &&
                  ` · ${Object.values(message.presetSelections).join(' · ')}`}
              </span>
            )}
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
