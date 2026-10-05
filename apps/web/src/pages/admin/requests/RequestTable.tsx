import { Fragment, useState } from 'react'
import { ArrowRight, ChevronDown, ChevronRight } from 'lucide-react'
import type { AdminRequestRow, AdminRequestSort } from '@pulpo/contracts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/features/admin-analytics/components'
import { formatCount, formatMicros, formatMs, formatTimestamp } from '@/features/admin-analytics/format'
import { ui, uit } from '@/i18n/ui'
import { REQUEST_SORTS, categoryLabel, modelName, originLabel, platformLabel, sortLabel } from './filters'
import { RequestDetailPanel } from './RequestDetail'
import { StatusBadge } from './StatusBadge'

const COLUMN_COUNT = 11

function Flags({ row }: { row: AdminRequestRow }) {
  return (
    <div className="flex flex-wrap gap-1">
      {row.agentMode && <Badge variant="outline">{ui('agent')}</Badge>}
      {row.retryCount > 0 && <Badge variant="outline">{row.retryCount === 1 ? ui('1 retry') : uit`${row.retryCount} retries`}</Badge>}
      {row.fallbackUsed && <Badge variant="outline">{ui('fallback')}</Badge>}
      {row.stickyFallbackUsed && <Badge variant="outline">{ui('sticky')}</Badge>}
      {row.ocrStatus !== 'not_requested' && (
        <Badge variant={row.ocrStatus === 'failed' ? 'destructive' : 'outline'}>{uit`OCR ${row.ocrStatus.replaceAll('_', ' ')}`}</Badge>
      )}
      {row.toolCalls > 0 && <Badge variant="outline">{uit`${row.toolCalls} tools`}</Badge>}
    </div>
  )
}

function Identity({ row, onFilter }: { row: AdminRequestRow; onFilter: (key: 'userId' | 'apiKeyId', id: string) => void }) {
  return (
    <div className="max-w-44 min-w-0">
      {row.user
        ? <button type="button" className="block max-w-full truncate hover:underline" title={row.user.email} onClick={(event) => { event.stopPropagation(); onFilter('userId', row.user!.id) }}>{row.user.name || row.user.email}</button>
        : <span className="text-muted-foreground">—</span>}
      {row.apiKey && (
        <button type="button" className="block max-w-full truncate text-muted-foreground hover:underline" onClick={(event) => { event.stopPropagation(); onFilter('apiKeyId', row.apiKey!.id) }}>
          {row.apiKey.name} <span className="font-mono">{row.apiKey.prefix}</span>
        </button>
      )}
    </div>
  )
}

function RequestRowView({ row, open, onToggle, modelNames, onFilter }: {
  row: AdminRequestRow
  open: boolean
  onToggle: () => void
  modelNames: Record<string, string>
  onFilter: (key: 'userId' | 'apiKeyId', id: string) => void
}) {
  const redirected = row.actualModelId && row.actualModelId !== row.requestedModelId
  return (
    <Fragment>
      <tr className="cursor-pointer align-top" onClick={onToggle} data-request-id={row.id}>
        <td className="px-3 py-2">
          <button type="button" aria-expanded={open} aria-label={open ? ui('Collapse request') : ui('Expand request')} onClick={(event) => { event.stopPropagation(); onToggle() }}>
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        </td>
        <td className="whitespace-nowrap px-3 py-2">{formatTimestamp(row.createdAt)}</td>
        <td className="px-3 py-2">
          <div>{originLabel(row.origin)}</div>
          <Badge variant="secondary" className="mt-0.5 text-[10px]">{platformLabel(row.platform)}</Badge>
        </td>
        <td className="px-3 py-2"><Identity row={row} onFilter={onFilter} /></td>
        <td className="max-w-56 px-3 py-2">
          <div className="truncate">{modelName(modelNames, row.requestedModelId)}</div>
          {redirected && (
            <div className="flex items-center gap-1 truncate text-muted-foreground">
              <ArrowRight className="size-3 shrink-0" aria-hidden />
              {modelName(modelNames, row.actualModelId)}
            </div>
          )}
        </td>
        <td className="px-3 py-2"><Flags row={row} /></td>
        <td className="px-3 py-2 text-right tabular-nums" title={uit`${formatCount(row.inputTokens)} in (${formatCount(row.cachedInputTokens)} cached) / ${formatCount(row.outputTokens)} out`}>
          {formatCount(row.inputTokens + row.outputTokens)}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{formatMicros(row.costMicros)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMs(row.ttftMs)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMs(row.durationMs)}</td>
        <td className="px-3 py-2">
          <StatusBadge status={row.status} />
          {row.status === 'failed' && row.errorCategory && <div className="mt-1 text-destructive">{categoryLabel(row.errorCategory)}</div>}
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/20 hover:bg-muted/20">
          <td colSpan={COLUMN_COUNT} className="p-4">
            <RequestDetailPanel requestId={row.id} modelNames={modelNames} />
          </td>
        </tr>
      )}
    </Fragment>
  )
}

export interface RequestTableProps {
  rows: AdminRequestRow[]
  loading: boolean
  error: Error | null
  onRetry: () => void
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  sort: AdminRequestSort
  onSort: (sort: AdminRequestSort) => void
  modelNames: Record<string, string>
  onFilter: (key: 'userId' | 'apiKeyId', id: string) => void
}

export function RequestTable({ rows, loading, error, onRetry, hasMore, loadingMore, onLoadMore, sort, onSort, modelNames, onFilter }: RequestTableProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  })
  return (
    <Card className="gap-0 rounded-lg py-0 shadow-none">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="text-sm font-medium">{ui('Requests')}</span>
        <div className="flex-1" />
        <Select value={sort} onValueChange={(value: AdminRequestSort) => onSort(value)}>
          <SelectTrigger size="sm" className="w-40 text-xs" aria-label={ui('Sort requests')}><SelectValue /></SelectTrigger>
          <SelectContent>
            {REQUEST_SORTS.map((value) => <SelectItem key={value} value={value}>{sortLabel(value)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {error && !rows.length ? (
        <div role="alert" className="flex items-center gap-3 p-4 text-sm text-destructive">
          <span>{error.message}</span>
          <Button variant="outline" size="sm" onClick={onRetry}>{ui('Retry')}</Button>
        </div>
      ) : loading ? (
        <div className="space-y-2 p-3">{[0, 1, 2, 3, 4].map((index) => <Skeleton key={index} className="h-8 w-full" />)}</div>
      ) : !rows.length ? (
        <EmptyState className="min-h-32">{ui('No requests match these filters')}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table text-xs">
            <thead>
              <tr className="border-b">
                <th className="px-3 py-2"><span className="sr-only">{ui('Details')}</span></th>
                <th className="px-3 py-2">{ui('Started')}</th>
                <th className="px-3 py-2">{ui('Source')}</th>
                <th className="px-3 py-2">{ui('User / API key')}</th>
                <th className="px-3 py-2">{ui('Requested → actual')}</th>
                <th className="px-3 py-2">{ui('Flags')}</th>
                <th className="px-3 py-2 text-right">{ui('Tokens')}</th>
                <th className="px-3 py-2 text-right">{ui('Cost')}</th>
                <th className="px-3 py-2 text-right">{ui('TTFT')}</th>
                <th className="px-3 py-2 text-right">{ui('Duration')}</th>
                <th className="px-3 py-2">{ui('Status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <RequestRowView key={row.id} row={row} open={expanded.has(row.id)} onToggle={() => toggle(row.id)} modelNames={modelNames} onFilter={onFilter} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && rows.length > 0 && (
        <div className="flex justify-center border-t p-2">
          <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? ui('Loading…') : ui('Load more')}
          </Button>
        </div>
      )}
    </Card>
  )
}
