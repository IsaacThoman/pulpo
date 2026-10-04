import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/features/admin-analytics/components'
import { formatPercent } from '@/features/admin-analytics/format'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { share } from './query'

/** Shown when older rows predate the capture of the fields a share is based on. */
export function CoverageNote({ captured, total }: { captured: number; total: number }) {
  if (total <= 0 || captured >= total) return null
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="note">
      <Info className="size-3.5 shrink-0" aria-hidden />
      {uit`Based on ${formatPercent(share(captured, total))} of requests; older requests were recorded before these details were captured.`}
    </p>
  )
}

export function SectionError({ error }: { error: unknown }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
      {error instanceof Error && error.message ? uit`Couldn't load this section: ${error.message}` : ui("Couldn't load this section")}
    </div>
  )
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>
}

export interface ShareSegment { key: string; label: string; value: number; display: string; color: string }

/** A single 100% bar with a labelled legend, so each part reads without color. */
export function ShareBar({ segments, loading }: { segments: ShareSegment[]; loading?: boolean }) {
  if (loading) return <Skeleton className="h-16 w-full" />
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  if (total <= 0) return <EmptyState />
  const visible = segments.filter((segment) => segment.value > 0)
  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
        {visible.map((segment) => (
          <div key={segment.key} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(segment.value / total) * 100}%`, background: segment.color }} title={`${segment.label}: ${formatPercent(segment.value / total)}`} />
        ))}
      </div>
      <ul className="grid gap-1 text-xs">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-2">
            <span className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: segment.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{segment.label}</span>
            <span className="tabular-nums text-muted-foreground">{formatPercent(segment.value / total)}</span>
            <span className="min-w-12 text-right tabular-nums text-muted-foreground">{segment.display}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface Column<T> {
  key: string
  header: string
  align?: 'left' | 'right'
  render: (row: T) => ReactNode
}

export function DataTable<T>({ rows, columns, rowKey, loading, emptyText }: {
  rows: readonly T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  loading?: boolean
  emptyText?: string
}) {
  if (loading) return <div className="space-y-2">{[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-6 w-full" />)}</div>
  if (!rows.length) return <EmptyState>{emptyText}</EmptyState>
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-max">
        <thead>
          <tr className="border-b">
            {columns.map((column) => <th key={column.key} className={cn('px-2 py-1.5', column.align === 'right' && 'text-right')}>{column.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.key} className={cn('px-2 py-1.5', column.align === 'right' && 'text-right tabular-nums')}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
