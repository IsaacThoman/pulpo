import { useEffect, useRef, type ReactNode, type UIEvent } from 'react'
import type { UsageCostItem } from '@pulpo/contracts'
import { BarChart3, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import { UsageModelIcon } from './UsageModelIcon'
import { formatUsd } from '@/lib/format'
import { useProfileLinkState } from '@/lib/profile'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { UsageCostBreakdown } from './UsageCostBreakdown'
import { ui, activeLocale } from '@/i18n/ui'

export interface PublicUsageRecord {
  id: string
  createdAt: string
  participant: { id: string; displayName: string; username: string; avatarUrl: string | null; profileColor: string | null }
  model: { id: string; name: string; logo: string | null }
  inputTokens: number
  outputTokens: number
  costMicros: number
  inferenceReferenceCostMicros: number
  subscriptionCoveredMicros: number
  costBreakdown: UsageCostItem[] | null
}

export interface PublicTopModel {
  modelId: string
  name: string
  logo: string | null
  calls: number
  costMicros: number
}

const PARTICIPANT_CLASS = 'flex min-w-0 max-w-48 items-center gap-1.5'

/** A record's participant. Leaderboards link them to their profile, which keeps the leaderboard as its origin. */
function Participant({ participant, link }: { participant: PublicUsageRecord['participant']; link: boolean }) {
  const content = <>
    <ProfileAvatar name={participant.displayName} avatarUrl={participant.avatarUrl} className="size-5" fallbackClassName="text-[8px]" />
    <span className={link ? 'truncate group-hover/participant:underline' : 'truncate'}>{participant.displayName}</span>
  </>
  return link ? <ParticipantLink participant={participant}>{content}</ParticipantLink> : <span className={PARTICIPANT_CLASS}>{content}</span>
}

// Its own component so only linked participants need a router.
function ParticipantLink({ participant, children }: { participant: PublicUsageRecord['participant']; children: ReactNode }) {
  const linkState = useProfileLinkState()
  return <Link
    to={`/${participant.username}`}
    state={linkState}
    aria-label={participant.displayName}
    className={`group/participant rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${PARTICIPANT_CLASS}`}
  >{children}</Link>
}

export function PublicRecentUsagePanel({
  records,
  showParticipant = true,
  linkParticipants = false,
  nextCursor,
  loadingMore,
  error,
  onLoadMore,
}: {
  records: PublicUsageRecord[]
  /** Off on a profile, where every record is the profile owner's. */
  showParticipant?: boolean
  /** Link each participant to their profile, as the friends and Pool leaderboards do. */
  linkParticipants?: boolean
  nextCursor: string | null
  loadingMore: boolean
  error?: string | null
  onLoadMore: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const onLoadMoreRef = useRef(onLoadMore)
  useEffect(() => { onLoadMoreRef.current = onLoadMore }, [onLoadMore])

  const maybeLoadMore = (el: HTMLDivElement) => {
    if (!nextCursor || loadingMore) return
    const { clientHeight, scrollHeight, scrollTop } = el
    if (scrollHeight - scrollTop - clientHeight < 160) onLoadMoreRef.current()
  }

  const onScroll = (e: UIEvent<HTMLDivElement>) => maybeLoadMore(e.currentTarget)

  // if content doesn't fill the scroll area, keep loading until it does or we run out
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !nextCursor || loadingMore || error) return
    if (el.scrollHeight <= el.clientHeight + 160) onLoadMoreRef.current()
  }, [records, nextCursor, loadingMore, error])

  return <div className="min-w-0 rounded-lg border">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div className="flex items-center gap-2"><Zap className="size-3" /><h3 className="text-xs font-medium">{ui("Recent usage")}</h3></div>
      <span className="text-xs text-muted-foreground">{records.length.toLocaleString(activeLocale())} {ui("settled calls")}</span>
    </div>
    {records.length === 0 ? <div className="p-6 text-center text-xs text-muted-foreground">{ui("No settled usage in this period")}</div> : <>
      <div ref={scrollRef} className="max-h-96 min-w-0 overflow-auto" onScroll={onScroll} tabIndex={0} role="region" aria-label={ui("Recent usage")}>
        <table className="data-table usage-records-table">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-2 font-normal">{ui("Time")}</th>
              {showParticipant && <th className="px-3 py-2 font-normal">{ui("User")}</th>}
              <th className="px-3 py-2 font-normal">{ui("Model")}</th>
              <th className="px-3 py-2 text-right font-normal">{ui("Tokens")}</th>
              <th className="px-3 py-2 text-right font-normal">{ui("Cost")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">{records.map((record) => <tr key={record.id}>
            <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{new Date(record.createdAt).toLocaleString(activeLocale())}</td>
            {showParticipant && <td className="px-3 py-2"><Participant participant={record.participant} link={linkParticipants} /></td>}
            <td className="px-3 py-2"><span className="flex min-w-0 max-w-48 items-center gap-1.5"><UsageModelIcon modelId={record.model.id} logo={record.model.logo} /><span className="truncate">{record.model.name}</span></span></td>
            <td className="px-3 py-2 text-right tabular-nums">{(record.inputTokens + record.outputTokens).toLocaleString(activeLocale())}</td>
            <td className="px-3 py-2 text-right tabular-nums">
              <UsageCostBreakdown
                costUsd={record.costMicros / 1_000_000}
                inferenceReferenceUsd={record.inferenceReferenceCostMicros / 1_000_000}
                subscriptionCoveredUsd={record.subscriptionCoveredMicros / 1_000_000}
                items={record.costBreakdown}
              />
            </td>
          </tr>)}</tbody>
        </table>
        {(loadingMore || error) && <div className="border-t p-2 text-center text-xs text-muted-foreground">
          {error ? <button type="button" className="text-destructive hover:underline" onClick={() => onLoadMore()}>{error} {ui("— Retry")}</button> : ui("Loading…")}
        </div>}
      </div>
    </>}
  </div>
}

export function PublicTopModelsPanel({ models }: { models: PublicTopModel[] }) {
  return <div className="min-w-0 rounded-lg border">
    <div className="flex items-center gap-2 border-b px-3 py-2"><BarChart3 className="size-3" /><h3 className="text-xs font-medium">{ui("Top models")}</h3></div>
    {models.length === 0 ? <div className="p-6 text-center text-xs text-muted-foreground">{ui("No settled usage in this period")}</div> : <div className="max-h-96 divide-y overflow-y-auto">
      {models.map((model, index) => {
        const name = model.modelId === 'other' ? 'Other' : model.name
        return <div key={model.modelId} className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2"><span className="flex w-4 shrink-0 justify-center text-xs text-muted-foreground">{index + 1}</span><UsageModelIcon modelId={model.modelId} logo={model.logo} /><div className="min-w-0 flex-1"><p className="truncate text-xs">{name}</p><p className="text-xs text-muted-foreground">{model.calls.toLocaleString(activeLocale())} {ui("calls")}</p></div></div>
          <span className="shrink-0 text-xs tabular-nums">{formatUsd(model.costMicros / 1_000_000)}</span>
        </div>
      })}
    </div>}
  </div>
}
