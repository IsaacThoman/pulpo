import { useState } from 'react'
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleStop, Loader2, Split } from 'lucide-react'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import type { Message } from '@/lib/types'
import { useRelatedChats } from '@/features/chat/use-related-chats'
import { ThreadStatusIcon } from '@/features/chat/thread-status'
import { threadStatusLabel } from '@/features/chat/thread-status-label'
import { isLongReport, parseThreadUpdate, type ThreadReport } from '@/features/chat/thread-update'
import { Markdown } from './Markdown'
import type { ToolItem } from './message-timeline'
import { startedThreadId, threadTitle } from './thread-tools'

/**
 * A thread the reply started: its title, and where it stands now, from the chat's threads list
 * (loaded by the chat header). Opens the thread.
 */
export function ThreadStartedCard({ chatId, tool, onOpenChat }: {
  chatId: string
  tool: ToolItem
  onOpenChat: (chatId: string) => void
}) {
  const related = useRelatedChats(chatId, false).data
  const threadId = startedThreadId(tool)
  const thread = threadId ? related?.threads.find((candidate) => candidate.id === threadId) : undefined
  const title = thread?.title ?? threadTitle(tool) ?? ui('Thread')
  const starting = !threadId
  const content = (
    <>
      <Split aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground/90">{title}</span>
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          {starting ? (
            <><Loader2 aria-hidden className="size-3 shrink-0 animate-spin" /><span>{ui('Starting thread…')}</span></>
          ) : thread?.status ? (
            <>
              <ThreadStatusIcon status={thread.status} className="size-3 shrink-0" />
              <span className="shrink-0">{threadStatusLabel(thread.status)}</span>
              {thread.summary && <span className="min-w-0 truncate">· {thread.summary}</span>}
            </>
          ) : (
            <span>{ui('Thread')}</span>
          )}
        </span>
      </span>
      {!starting && <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
    </>
  )
  const className = 'flex w-full max-w-md min-w-0 items-center gap-2.5 rounded-xl border bg-card px-3 py-2 text-left text-sm shadow-xs'
  return threadId ? (
    <button
      type="button"
      className={cn(className, 'cursor-pointer transition-colors hover:bg-accent')}
      aria-label={uit`Open thread "${title}"`}
      onClick={() => onOpenChat(threadId)}
    >
      {content}
    </button>
  ) : (
    <div role="status" className={className}>{content}</div>
  )
}

function ReportOutcome({ report }: { report: ThreadReport }) {
  switch (report.outcome) {
    case 'finished': return <><CircleCheck aria-hidden className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" /><span>{ui('Finished')}</span></>
    case 'failed': return <><CircleAlert aria-hidden className="size-3.5 shrink-0 text-destructive" /><span>{ui('Failed')}</span></>
    case 'stopped': return <><CircleStop aria-hidden className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" /><span>{ui('Stopped')}</span></>
    case 'incomplete': return <><CircleStop aria-hidden className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" /><span>{ui('Stopped before finishing')}</span></>
    case 'other': return <span>{report.outcomeText}</span>
  }
}

function ThreadReportSection({ report, onOpenChat }: { report: ThreadReport; onOpenChat: (chatId: string) => void }) {
  const long = isLongReport(report.body)
  const [expanded, setExpanded] = useState(false)
  const collapsed = long && !expanded
  return (
    <section className="min-w-0 space-y-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
        <button
          type="button"
          className="min-w-0 cursor-pointer truncate font-medium text-foreground underline-offset-4 hover:underline"
          aria-label={uit`Open thread "${report.title}"`}
          onClick={() => onOpenChat(report.threadId)}
        >
          {report.title}
        </button>
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><ReportOutcome report={report} /></span>
      </div>
      {report.body && (
        <div className="relative">
          <div className={cn('min-w-0 text-[14px] text-foreground/85', collapsed && 'max-h-40 overflow-hidden')}>
            <Markdown content={report.body} />
          </div>
          {collapsed && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-muted to-transparent" />}
        </div>
      )}
      {long && (
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDown aria-hidden className={cn('size-3 transition-transform', expanded && 'rotate-180')} />
          {expanded ? ui('Show less') : ui('Show more')}
        </button>
      )}
    </section>
  )
}

/**
 * The message of a thread update: what the chat's threads reported when they stopped, sent by the
 * server rather than typed by the user.
 */
export function ThreadUpdateCard({ message, onOpenChat }: { message: Pick<Message, 'content'>; onOpenChat: (chatId: string) => void }) {
  const reports = parseThreadUpdate(message.content)
  return (
    <div className="w-full min-w-0 space-y-3 rounded-xl border bg-muted px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Split aria-hidden className="size-3.5 shrink-0" />
        {reports.length > 1 ? uit`Thread updates (${reports.length})` : ui('Thread update')}
      </div>
      {reports.length
        ? reports.map((report, index) => <ThreadReportSection key={`${report.threadId}:${index}`} report={report} onOpenChat={onOpenChat} />)
        : <div className="min-w-0 text-[14px] text-foreground/85"><Markdown content={message.content} /></div>}
    </div>
  )
}
