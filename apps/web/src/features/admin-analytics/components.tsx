import { useState, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, matchByDataKey } from 'recharts'
import type { AnalyticsBucket, AnalyticsRange } from '@pulpo/contracts'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { formatChartNumber } from '@/lib/format'
import { useSettings } from '@/stores/settings'
import { DEFAULT_CHART_ANIMATION_DURATION_MS, scaledAnimationDuration } from '@/lib/animation-speed'
import { formatBucketLabel, formatBucketTick, formatPercent } from './format'
import { ANALYTICS_RANGES, type AnalyticsSearch } from './search-params'

const MATCH_BY_BUCKET = matchByDataKey('bucket')

function rangeLabel(range: AnalyticsRange): string {
  switch (range) {
    case '1h': return ui('Last hour')
    case '24h': return ui('Last 24 hours')
    case '7d': return ui('Last 7 days')
    case '30d': return ui('Last 30 days')
    case '90d': return ui('Last 90 days')
    case 'all': return ui('All time')
    case 'custom': return ui('Custom range')
  }
}

/** `datetime-local` value for an ISO instant, in the viewer's zone. */
function localInputValue(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function isoFromLocalInput(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Preset ranges plus a custom from/to popover; writes straight to the URL. */
export function RangePicker({ search, ranges = ANALYTICS_RANGES }: { search: AnalyticsSearch; ranges?: readonly AnalyticsRange[] }) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(localInputValue(search.from))
  const [to, setTo] = useState(localInputValue(search.to))
  const fromIso = isoFromLocalInput(from)
  const toIso = isoFromLocalInput(to)
  const valid = Boolean(fromIso) && (!toIso || (fromIso !== null && fromIso < toIso))
  return (
    <div className="flex items-center gap-2">
      <Select
        value={search.range}
        onValueChange={(value: AnalyticsRange) => {
          if (value === 'custom') {
            setOpen(true)
            return
          }
          search.update({ range: value, from: null, to: null })
        }}
      >
        <SelectTrigger size="sm" className="w-40" aria-label={ui('Time range')}><SelectValue /></SelectTrigger>
        <SelectContent>
          {ranges.map((range) => <SelectItem key={range} value={range}>{rangeLabel(range)}</SelectItem>)}
        </SelectContent>
      </Select>
      {ranges.includes('custom') && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">{ui('Custom…')}</Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-3">
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">{ui('From')}</span>
              <Input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">{ui('To (empty means now)')}</span>
              <Input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
            <Button
              size="sm"
              className="w-full"
              disabled={!valid}
              onClick={() => {
                search.update({ range: 'custom', from: fromIso, to: toIso })
                setOpen(false)
              }}
            >
              {ui('Apply range')}
            </Button>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

export interface FilterOption { value: string; label: string }

/** Single-value dimension filter bound to one URL key; "all" clears it. */
export function FilterSelect({ search, name, label, options, className }: {
  search: AnalyticsSearch
  name: string
  label: string
  options: FilterOption[]
  className?: string
}) {
  return (
    <Select value={search.get(name) ?? 'all'} onValueChange={(value) => search.update({ [name]: value === 'all' ? null : value })}>
      <SelectTrigger size="sm" className={cn('w-36 text-xs', className)} aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{label}</SelectItem>
        {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

/**
 * Headline number with its change against the previous period. `goodWhen`
 * says which direction is an improvement (lower latency, higher success).
 */
export function KpiTile({ label, value, change, goodWhen = 'up', hint, loading }: {
  label: string
  value: ReactNode
  change?: number | null
  goodWhen?: 'up' | 'down' | 'neutral'
  hint?: string
  loading?: boolean
}) {
  const direction = change === null || change === undefined || Math.abs(change) < 0.005 ? 'flat' : change > 0 ? 'up' : 'down'
  const tone = direction === 'flat' || goodWhen === 'neutral'
    ? 'text-muted-foreground'
    : (direction === goodWhen ? 'text-[color:var(--viz-good)]' : 'text-[color:var(--viz-critical)]')
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus
  return (
    <Card className="gap-0 py-0 shadow-none">
      <CardContent className="space-y-1 p-3">
        <div className="truncate text-xs text-muted-foreground" title={hint}>{label}</div>
        {loading ? <Skeleton className="h-7 w-20" /> : <div className="truncate text-xl font-semibold tabular-nums">{value}</div>}
        {change !== undefined && !loading && (
          <div className={cn('flex items-center gap-0.5 text-[11px] tabular-nums', tone)}>
            <Icon className="size-3" aria-hidden />
            {change === null ? ui('No prior data') : ui('{{change}} vs previous period', { change: formatPercent(Math.abs(change)) })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function ChartCard({ title, description, actions, children, className }: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('gap-0 py-0 shadow-none', className)}>
      <CardContent className="p-4">
        <div className="mb-3 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{title}</div>
            {description && <div className="text-xs text-muted-foreground">{description}</div>}
          </div>
          {actions}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

export function EmptyState({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={cn('flex h-full min-h-24 items-center justify-center text-xs text-muted-foreground', className)}>{children ?? ui('No data for this range')}</div>
}

export interface SeriesSpec { key: string; label: string; color: string }

export function SeriesLegend({ series }: { series: SeriesSpec[] }) {
  if (series.length < 2) return null
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {series.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: item.color }} aria-hidden />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

interface TooltipEntry { dataKey?: string | number; value?: number | string | null; color?: string }

function SeriesTooltip({ active, payload, label, bucket, series, format }: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string
  bucket: AnalyticsBucket
  series: SeriesSpec[]
  format: (value: number) => string
}) {
  if (!active || !payload?.length || typeof label !== 'string') return null
  const byKey = new Map(payload.map((entry) => [String(entry.dataKey), entry]))
  const rows = series.filter((item) => byKey.get(item.key)?.value !== null && byKey.get(item.key)?.value !== undefined)
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-1 font-medium">{formatBucketLabel(label, bucket)}</div>
      {rows.map((item) => (
        <div key={item.key} className="flex items-center gap-2">
          <span className="inline-block size-2 rounded-sm" style={{ background: item.color }} aria-hidden />
          <span className="flex-1 text-muted-foreground">{item.label}</span>
          <span className="tabular-nums">{format(Number(byKey.get(item.key)?.value ?? 0))}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Time series over gap-filled buckets: stacked bars for counts that add up,
 * lines for measures that don't (latency percentiles). One y-axis only.
 */
export function TimeSeriesChart({ data, bucket, series, kind = 'stacked-bar', format = formatChartNumber, height = 220, loading }: {
  data: Array<Record<string, number | string | null>>
  bucket: AnalyticsBucket
  series: SeriesSpec[]
  kind?: 'stacked-bar' | 'line'
  format?: (value: number) => string
  height?: number
  loading?: boolean
}) {
  const animationSpeed = useSettings((state) => state.animationSpeed)
  const animationDuration = scaledAnimationDuration(DEFAULT_CHART_ANIMATION_DURATION_MS, animationSpeed)
  if (loading) return <Skeleton className="w-full" style={{ height }} />
  const hasValues = data.some((row) => series.some((item) => typeof row[item.key] === 'number' && (row[item.key] as number) > 0))
  if (!hasValues) return <div style={{ height }}><EmptyState /></div>
  const axis = {
    tick: { fontSize: 11, fill: 'var(--muted-foreground)' },
    tickLine: false,
    axisLine: false,
  }
  const tooltip = <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.5 }} content={<SeriesTooltip bucket={bucket} series={series} format={format} />} />
  const lastKey = series.at(-1)?.key
  return (
    <div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {kind === 'line' ? (
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="bucket" {...axis} minTickGap={24} tickFormatter={(value: string) => formatBucketTick(value, bucket)} />
              <YAxis {...axis} width={48} tickFormatter={(value: number) => format(value)} />
              {tooltip}
              {series.map((item) => (
                <Line key={item.key} type="monotone" dataKey={item.key} stroke={item.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls animationDuration={animationDuration} />
              ))}
            </LineChart>
          ) : (
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="bucket" {...axis} minTickGap={24} tickFormatter={(value: string) => formatBucketTick(value, bucket)} />
              <YAxis {...axis} width={48} allowDecimals={false} tickFormatter={(value: number) => format(value)} />
              {tooltip}
              {series.map((item) => (
                <Bar
                  key={item.key}
                  dataKey={item.key}
                  stackId="stack"
                  fill={item.color}
                  stroke="var(--card)"
                  strokeWidth={1}
                  radius={item.key === lastKey ? [4, 4, 0, 0] : 0}
                  animationDuration={animationDuration}
                  animationMatchBy={MATCH_BY_BUCKET}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      <SeriesLegend series={series} />
    </div>
  )
}

export interface RankedRow { key: string; label: ReactNode; value: number; display: string; detail?: ReactNode }

/** Ranked horizontal bars: label, proportional bar, value. Doubles as a table view. */
export function RankedList({ rows, loading, emptyText, color = 'var(--viz-1)', max }: {
  rows: RankedRow[]
  loading?: boolean
  emptyText?: string
  color?: string
  max?: number
}) {
  if (loading) return <div className="space-y-2">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-5 w-full" />)}</div>
  if (!rows.length) return <EmptyState>{emptyText}</EmptyState>
  const peak = max ?? Math.max(...rows.map((row) => row.value), 1)
  return (
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-xs">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="truncate">{row.label}</span>
              {row.detail && <span className="shrink-0 text-muted-foreground">{row.detail}</span>}
            </div>
            <div className="mt-0.5 h-1.5 rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${Math.max(2, (row.value / peak) * 100)}%`, background: color }} />
            </div>
          </div>
          <span className="tabular-nums text-muted-foreground">{row.display}</span>
        </li>
      ))}
    </ul>
  )
}
