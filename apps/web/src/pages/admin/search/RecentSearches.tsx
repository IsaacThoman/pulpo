import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { AdminSearchRequestRow } from '@pulpo/contracts'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/features/admin-analytics/components'
import { formatCount, formatMs, formatTimestamp } from '@/features/admin-analytics/format'
import { ui, uit } from '@/i18n/ui'
import { PHASE_KEYS, categoryLabel, failedAttempt, filterLabel, outcomeColor, outcomeLabel, phaseLabel, providerLabel } from './labels'
import { Waterfall, WaterfallLegend } from './Waterfall'

const COLUMN_COUNT = 9

export function OutcomeBadge({ outcome }: { outcome: string }) {
  return (
    <Badge variant="outline" className="gap-1.5">
      <span className="inline-block size-1.5 rounded-full" style={{ background: outcomeColor(outcome) }} aria-hidden />
      {outcomeLabel(outcome)}
    </Badge>
  )
}

function SearchDetail({ row }: { row: AdminSearchRequestRow }) {
  const phases = PHASE_KEYS.flatMap((key) => key !== 'otherMs' && row.phases[key] !== undefined ? [{ key, ms: row.phases[key]! }] : [])
  return (
    <div className="grid gap-4 text-xs md:grid-cols-3">
      <div>
        <div className="mb-1.5 font-medium">{ui('Provider attempts')}</div>
        {row.attempts.length ? (
          <ol className="space-y-1">
            {row.attempts.map((attempt, index) => (
              <li key={index} className="flex items-center gap-2 tabular-nums">
                <span className="w-16 shrink-0">{providerLabel(attempt.provider)}</span>
                <span className={failedAttempt(attempt.outcome) ? 'flex-1 text-destructive' : 'flex-1 text-muted-foreground'}>{outcomeLabel(attempt.outcome)}</span>
                {attempt.resultCount !== undefined && <span className="text-muted-foreground">{uit`${formatCount(attempt.resultCount)} results`}</span>}
                <span className="w-14 text-right">{formatMs(attempt.durationMs)}</span>
              </li>
            ))}
          </ol>
        ) : <div className="text-muted-foreground">{ui('No provider was called')}</div>}
      </div>
      <div>
        <div className="mb-1.5 font-medium">{ui('Phases')}</div>
        <ul className="space-y-1 tabular-nums">
          {phases.map((phase) => (
            <li key={phase.key} className="flex gap-2">
              <span className="flex-1 text-muted-foreground">{phaseLabel(phase.key)}</span>
              <span>{formatMs(phase.ms)}</span>
            </li>
          ))}
          <li className="flex gap-2 border-t pt-1 font-medium">
            <span className="flex-1">{ui('Total')}</span>
            <span>{formatMs(row.durationMs)}</span>
          </li>
        </ul>
      </div>
      <div>
        <div className="mb-1.5 font-medium">{ui('Request')}</div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">{ui('Query length')}</dt>
          <dd className="tabular-nums">{uit`${formatCount(row.queryLength)} characters`}</dd>
          <dt className="text-muted-foreground">{ui('Page')}</dt>
          <dd className="tabular-nums">{formatCount(row.page)}</dd>
          <dt className="text-muted-foreground">{ui('Options')}</dt>
          <dd>{row.filters.length ? row.filters.map(filterLabel).join(', ') : ui('None')}</dd>
        </dl>
      </div>
    </div>
  )
}

function SearchRowView({ row, open, onToggle, scaleMs }: { row: AdminSearchRequestRow; open: boolean; onToggle: () => void; scaleMs: number }) {
  return (
    <Fragment>
      <tr className="cursor-pointer align-middle" onClick={onToggle} data-search-id={row.id}>
        <td className="px-3 py-2">
          <button type="button" aria-expanded={open} aria-label={open ? ui('Collapse search') : ui('Expand search')} onClick={(event) => { event.stopPropagation(); onToggle() }}>
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        </td>
        <td className="whitespace-nowrap px-3 py-2">{formatTimestamp(row.createdAt)}</td>
        <td className="max-w-40 truncate px-3 py-2" title={row.user?.email}>{row.user ? row.user.name || row.user.email : '—'}</td>
        <td className="whitespace-nowrap px-3 py-2">
          {categoryLabel(row.category)}
          {row.page > 1 && <span className="text-muted-foreground">{uit` · page ${row.page}`}</span>}
        </td>
        <td className="px-3 py-2"><OutcomeBadge outcome={row.outcome} /></td>
        <td className="whitespace-nowrap px-3 py-2">
          {providerLabel(row.provider)}
          {row.fallback && <Badge variant="outline" className="ml-1.5">{ui('fallback')}</Badge>}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{formatCount(row.resultCount)}</td>
        <td className="w-full min-w-48 px-3 py-2"><Waterfall row={row} scaleMs={scaleMs} /></td>
        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMs(row.durationMs)}</td>
      </tr>
      {open && (
        <tr className="bg-muted/20 hover:bg-muted/20">
          <td colSpan={COLUMN_COUNT} className="p-4"><SearchDetail row={row} /></td>
        </tr>
      )}
    </Fragment>
  )
}

export function RecentSearches({ rows, loading }: { rows: AdminSearchRequestRow[]; loading: boolean }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  })
  // One scale for every row, so slow searches look slow next to fast ones.
  const scaleMs = Math.max(1, ...rows.map((row) => row.durationMs))
  const providers = [...new Set(rows.flatMap((row) => row.attempts.map((attempt) => attempt.provider)))].sort()
  return (
    <Card className="gap-0 rounded-lg py-0 shadow-none">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
        <span className="text-sm font-medium">{ui('Recent searches')}</span>
        <span className="text-xs text-muted-foreground">{ui('The latest 100, newest first. Query text is never stored.')}</span>
      </div>
      {loading ? (
        <div className="space-y-2 p-3">{[0, 1, 2, 3, 4].map((index) => <Skeleton key={index} className="h-8 w-full" />)}</div>
      ) : !rows.length ? (
        <EmptyState className="min-h-32">{ui('No searches match these filters')}</EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="data-table w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2"><span className="sr-only">{ui('Details')}</span></th>
                  <th className="px-3 py-2">{ui('Started')}</th>
                  <th className="px-3 py-2">{ui('User')}</th>
                  <th className="px-3 py-2">{ui('Type')}</th>
                  <th className="px-3 py-2">{ui('Outcome')}</th>
                  <th className="px-3 py-2">{ui('Provider')}</th>
                  <th className="px-3 py-2 text-right">{ui('Results')}</th>
                  <th className="px-3 py-2">{ui('Timeline')}</th>
                  <th className="px-3 py-2 text-right">{ui('Duration')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => <SearchRowView key={row.id} row={row} open={expanded.has(row.id)} onToggle={() => toggle(row.id)} scaleMs={scaleMs} />)}
              </tbody>
            </table>
          </div>
          <div className="border-t px-3 py-2"><WaterfallLegend providers={providers} /></div>
        </>
      )}
    </Card>
  )
}
