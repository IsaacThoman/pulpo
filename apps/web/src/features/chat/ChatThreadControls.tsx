import { useState } from 'react'
import type { ChatKind, ChatThreadStatus, RelatedChats } from '@pulpo/contracts'
import { CircleCheckBig, CornerUpLeft, FolderKanban, GitFork, Loader2, MessagesSquare, Split, Undo2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ui, uit } from '@/i18n/ui'
import { timeAgo } from '@/lib/format'
import { queryClient } from '@/lib/query-client'
import { useAuth } from '@/stores/auth'
import { useChat } from '@/stores/chat'
import { useFileToasts } from '@/features/files/browser/toasts'
import { filesErrorMessage } from '@/features/files/file-display'
import { groupThreads, relatedChatsQueryKey, relatedChatsSummary } from './related-chats'
import { ThreadStatusIcon } from './thread-status'
import { threadStatusLabel } from './thread-status-label'

const HEADER_BUTTON = 'flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50'

function originLabel(kind: ChatKind, known: boolean): string {
  if (kind === 'side') return known ? ui('Side chat from') : ui('Side chat')
  if (kind === 'thread') return known ? ui('Thread from') : ui('Thread')
  return ui('Forked from')
}

function OriginIcon({ kind }: { kind: ChatKind }) {
  const Icon = kind === 'side' ? MessagesSquare : kind === 'thread' ? Split : GitFork
  return <Icon aria-hidden className="size-3.5 shrink-0" />
}

/**
 * Where a chat came from and what it belongs to, beside the model in the chat header: the chat a
 * side chat, thread, or fork was opened from (linked back), a thread's status, and the project.
 */
export function ChatContextLine({ kind, related, threadStatus, onOpenChat, onOpenFolder }: {
  kind: ChatKind
  related: RelatedChats | undefined
  /** Threads only. */
  threadStatus: ChatThreadStatus | null
  onOpenChat: (chatId: string) => void
  onOpenFolder?: (folderId: string) => void
}) {
  // Waits for the related chats, so the line does not change once they arrive.
  if (!related) return null
  const origin = related.origin
  // A fork whose origin is gone is just a chat; a side chat or thread still says what it is.
  const showOrigin = Boolean(origin) || kind !== 'chat'
  const project = related.project
  if (!showOrigin && !project && !threadStatus) return null
  return (
    <div className="flex min-w-0 items-center gap-3 px-1 text-xs text-muted-foreground">
      {showOrigin && (
        <div className="flex min-w-0 items-center gap-1">
          <OriginIcon kind={kind} />
          <span className="shrink-0">{originLabel(kind, Boolean(origin))}</span>
          {origin && (origin.deleted ? (
            <span className="min-w-0 truncate line-through" title={ui('This chat was deleted')}>{origin.title}</span>
          ) : (
            <button
              type="button"
              className="flex min-w-0 cursor-pointer items-center gap-0.5 font-medium text-foreground/80 underline-offset-4 hover:text-foreground hover:underline"
              aria-label={uit`Open "${origin.title}"`}
              onClick={() => onOpenChat(origin.id)}
            >
              <span className="min-w-0 truncate">{origin.title}</span>
              <CornerUpLeft aria-hidden className="size-3 shrink-0" />
            </button>
          ))}
        </div>
      )}
      {threadStatus && (
        <span role="status" className="flex shrink-0 items-center gap-1">
          <ThreadStatusIcon status={threadStatus} className="size-3.5" />
          {threadStatusLabel(threadStatus)}
        </span>
      )}
      {project && (
        onOpenFolder ? (
          <button
            type="button"
            className="hidden min-w-0 cursor-pointer items-center gap-1 hover:text-foreground sm:flex"
            aria-label={uit`Open project "${project.name}"`}
            onClick={() => onOpenFolder(project.folderId)}
          >
            <FolderKanban aria-hidden className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{project.name}</span>
          </button>
        ) : (
          <span className="hidden min-w-0 items-center gap-1 sm:flex">
            <FolderKanban aria-hidden className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{project.name}</span>
          </span>
        )
      )}
    </div>
  )
}

/** Marks a thread done, or reopens it, from its header. */
export function ThreadResolveButton({ chatId, originChatId, resolved }: { chatId: string; originChatId: string | null; resolved: boolean }) {
  const userId = useAuth((state) => state.user?.id)
  const [busy, setBusy] = useState(false)
  const label = resolved ? ui('Reopen thread') : ui('Resolve thread')
  const toggle = async () => {
    setBusy(true)
    try {
      await useChat.getState().setThreadResolved(chatId, !resolved)
      if (originChatId) {
        const key = relatedChatsQueryKey(userId, originChatId)
        // Resolving is known at once; a reopened thread's status comes from the refetch.
        if (!resolved) {
          queryClient.setQueryData<RelatedChats>(key, (current) => current && {
            ...current,
            threads: current.threads.map((thread) => thread.id === chatId ? { ...thread, status: 'resolved' } : thread),
          })
        }
        await queryClient.invalidateQueries({ queryKey: key })
      }
    } catch (cause) {
      useFileToasts.getState().show({ message: filesErrorMessage(cause), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={HEADER_BUTTON} aria-label={label} disabled={busy} onClick={() => void toggle()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : resolved ? <Undo2 className="size-4" /> : <CircleCheckBig className="size-4" />}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The chat's threads and side chats, from the chat header: a count, a dot while a thread needs
 * attention, and a list grouped by status that opens each one.
 */
export function ThreadsMenu({ related, onOpenChat }: { related: RelatedChats | undefined; onOpenChat: (chatId: string) => void }) {
  const summary = relatedChatsSummary(related)
  if (!related || !summary.count) return null
  const groups = groupThreads(related.threads)
  const label = summary.attention ? ui('Threads and side chats (a thread needs attention)') : ui('Threads and side chats')
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="relative flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2 text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
              aria-label={label}
            >
              {summary.working ? <Loader2 className="size-4 animate-spin" /> : <Split className="size-4" />}
              <span className="text-xs tabular-nums">{summary.count}</span>
              {summary.attention && <span aria-hidden className="absolute top-1 right-1 size-2 rounded-full bg-amber-500 ring-2 ring-background" />}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{ui('Threads and side chats')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="max-h-[min(32rem,var(--radix-dropdown-menu-content-available-height))] w-80 overflow-y-auto">
        {groups.map((group, index) => (
          <DropdownMenuGroup key={group.status} aria-label={threadStatusLabel(group.status)}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{threadStatusLabel(group.status)}</DropdownMenuLabel>
            {group.threads.map((thread) => (
              <DropdownMenuItem key={thread.id} className="items-start" onSelect={() => onOpenChat(thread.id)}>
                <ThreadStatusIcon status={group.status} className="mt-0.5 size-4 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{thread.title}</span>
                  {thread.summary && <span className="line-clamp-2 text-xs text-muted-foreground">{thread.summary}</span>}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
        {related.sideChats.length > 0 && (
          <DropdownMenuGroup aria-label={ui('Side chats')}>
            {groups.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{ui('Side chats')}</DropdownMenuLabel>
            {related.sideChats.map((side) => (
              <DropdownMenuItem key={side.id} onSelect={() => onOpenChat(side.id)}>
                <MessagesSquare className="size-4 shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate">{side.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(Date.parse(side.updatedAt))}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
