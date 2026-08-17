import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { io, type Socket } from 'socket.io-client'
import type {
  AdminUsageEvent, AdminUsagePayloadAvailability, AdminUsagePayloadResult, AdminUsageRange,
  AdminUsageRequest, AdminUsageRequestDetail, AdminUsageRequestsResult, AdminUsageSummaryResult,
  ClientToServerEvents, ServerToClientEvents,
} from '@pulpo/contracts'
import {
  Activity, AlertTriangle, Bot, BrainCircuit, Check, ChevronDown, ChevronRight, CircleDollarSign,
  Clock3, Copy, Database, ExternalLink, Filter, KeyRound, LoaderCircle, RefreshCw, Search,
  UserRound, Wrench, X, Zap,
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts'
import { apiRequest } from '@/lib/api'
import { formatDuration, formatNumber } from '@/lib/format'
import { adminTimelineItemTitle, adminUsageQueryParams, adminUsageTimeline, formatMicros, setAdminUsageFilter } from '@/lib/admin-usage'
import { cn } from '@/lib/utils'
import { useCatalog, getCatalogModel } from '@/stores/catalog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup } from '@/components/usage/ToggleGroup'
import { ModelIcon } from '@/components/ModelIcon'
import { ProfileAvatar } from '@/components/ProfileAvatar'

type ChartMetric = 'cost' | 'requests' | 'tokens' | 'errors'

const RANGES: Array<{ id: AdminUsageRange; label: string }> = [
  { id: '24h', label: '24h' }, { id: '7d', label: '7d' }, { id: '30d', label: '30d' },
  { id: '90d', label: '90d' }, { id: 'all', label: 'All' },
]
const METRICS: Array<{ id: ChartMetric; label: string }> = [
  { id: 'cost', label: 'USD' }, { id: 'requests', label: 'Requests' },
  { id: 'tokens', label: 'Tokens' }, { id: 'errors', label: 'Errors' },
]
const CHART_COLORS = ['hsl(220 70% 55%)', 'hsl(160 60% 45%)', 'hsl(30 80% 50%)', 'hsl(280 60% 55%)', 'hsl(340 65% 55%)']

function chartValue(row: AdminUsageSummaryResult['daily'][number], metric: ChartMetric): number {
  if (metric === 'cost') return row.costMicros / 1_000_000
  return row[metric]
}

function countLabel(value: number, singular: string): string {
  return `${value.toLocaleString()} ${value === 1 ? singular : `${singular}s`}`
}

function statusVariant(status: string): 'destructive' | 'secondary' | 'outline' {
  if (['failed', 'cancelled', 'incomplete'].includes(status)) return 'destructive'
  if (['queued', 'in_progress'].includes(status)) return 'secondary'
  return 'outline'
}

function StatusBadge({ status, compact = false }: { status: string; compact?: boolean }) {
  const active = ['queued', 'in_progress'].includes(status)
  return <Badge variant={statusVariant(status)} className={cn('whitespace-nowrap font-normal', compact && 'h-5 px-1.5 text-[10px]')}>
    {active && <span className="mr-1.5 size-1.5 animate-pulse rounded-full bg-blue-500" />}
    {status.replaceAll('_', ' ')}
  </Badge>
}

function SelectFilter({ value, placeholder, options, onChange, className }: {
  value: string | null; placeholder: string; options: Array<{ value: string; label: string }>; onChange: (value: string | null) => void; className?: string
}) {
  return <Select value={value ?? 'all'} onValueChange={(next) => onChange(next === 'all' ? null : next)}>
    <SelectTrigger className={cn('h-8 w-36 text-xs', className)}><SelectValue placeholder={placeholder} /></SelectTrigger>
    <SelectContent><SelectItem value="all">{placeholder}</SelectItem>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </Select>
}

function DelayedFilterInput({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (value: string | null) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => onChange(draft.trim() || null)
  return <Input value={draft} placeholder={placeholder} className="h-8 text-xs" onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => {
    if (event.key === 'Enter') { event.preventDefault(); commit() }
  }} />
}

export function AdminUsagePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const range = (searchParams.get('range') ?? '24h') as AdminUsageRange
  const [metric, setMetric] = useState<ChartMetric>('cost')
  const [searchDraft, setSearchDraft] = useState(searchParams.get('q') ?? '')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [inspected, setInspected] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const models = useCatalog((state) => state.models)
  const queryString = adminUsageQueryParams(searchParams).toString()
  const queryKey = ['admin-usage', queryString]

  const summaryQuery = useQuery({
    queryKey: [...queryKey, 'summary'],
    queryFn: ({ signal }) => apiRequest<AdminUsageSummaryResult>(`/api/admin/usage/summary?${queryString}`, { signal }),
  })
  const requestsQuery = useInfiniteQuery({
    queryKey: [...queryKey, 'requests'], initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams(queryString)
      params.set('limit', '50')
      if (pageParam) params.set('cursor', pageParam)
      return apiRequest<AdminUsageRequestsResult>(`/api/admin/usage/requests?${params}`, { signal })
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const rows = useMemo(() => requestsQuery.data?.pages.flatMap((page) => page.data) ?? [], [requestsQuery.data])
  const hasActive = rows.some((row) => ['queued', 'in_progress'].includes(row.status))

  useEffect(() => {
    let refreshTimer: number | undefined
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['admin-usage'] }), 250)
    }
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({ path: '/socket.io', withCredentials: true })
    const subscribe = () => socket.emit('admin.usage.subscribe')
    socket.on('connect', subscribe)
    socket.on('admin.usage.upsert', (_event: AdminUsageEvent) => scheduleRefresh())
    return () => { window.clearTimeout(refreshTimer); socket.emit('admin.usage.unsubscribe'); socket.disconnect() }
  }, [queryClient])

  useEffect(() => {
    if (!hasActive) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void queryClient.invalidateQueries({ queryKey: ['admin-usage'] })
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [hasActive, queryClient])

  const setFilter = (key: string, value: string | null) => {
    setExpanded(null)
    setSearchParams(setAdminUsageFilter(searchParams, key, value), { replace: true })
  }
  const submitSearch = (event: FormEvent) => { event.preventDefault(); setFilter('q', searchDraft.trim() || null) }
  const clearFilters = () => {
    const next = new URLSearchParams(); next.set('range', range); setSearchDraft(''); setSearchParams(next, { replace: true })
  }
  const filterCount = ['status', 'origin', 'model', 'userId', 'apiKeyId', 'agent', 'retry', 'fallback', 'ocr', 'errorCategory', 'tool'].filter((key) => searchParams.has(key)).length
  const summary = summaryQuery.data
  const loading = summaryQuery.isLoading || requestsQuery.isLoading
  const error = summaryQuery.error ?? requestsQuery.error

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start gap-3">
      <div><h2 className="text-lg font-medium">Usage analytics</h2><p className="mt-0.5 text-xs text-muted-foreground">Request-level cost, performance, and execution traces across Pulpo.</p></div>
      <div className="flex-1" />
      <ToggleGroup options={RANGES} value={range} onChange={(value) => setFilter('range', value)} />
      <Button variant="outline" size="icon-sm" title="Refresh analytics" onClick={() => void queryClient.invalidateQueries({ queryKey: ['admin-usage'] })}><RefreshCw className={cn('size-3.5', summaryQuery.isFetching && 'animate-spin')} /></Button>
    </div>

    {loading ? <DashboardSkeleton /> : error ? <ErrorState error={error} onRetry={() => void queryClient.invalidateQueries({ queryKey: ['admin-usage'] })} /> : summary && <>
      <SummaryStrip summary={summary} />
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-3"><span className="flex items-center gap-2 text-xs font-medium"><Activity className="size-3.5" />Activity</span><div className="h-4 w-px bg-border" /><ToggleGroup options={METRICS} value={metric} onChange={setMetric} /></div>
        <UsageChart data={summary.daily} metric={metric} range={range} />
      </section>
      <CostDrivers summary={summary} onFilter={setFilter} />
    </>}

    <section className="rounded-lg border">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="mr-2 flex items-center gap-2"><Zap className="size-3.5" /><h3 className="text-xs font-medium">Request explorer</h3></div>
        <form className="relative min-w-52 flex-1 md:max-w-sm" onSubmit={submitSearch}>
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="User, key, request, or response ID" className="h-8 pl-8 pr-8 text-xs" />
          {searchDraft && <button type="button" aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => { setSearchDraft(''); setFilter('q', null) }}><X className="size-3.5" /></button>}
        </form>
        <SelectFilter value={searchParams.get('status')} placeholder="All statuses" onChange={(value) => setFilter('status', value)} options={['queued', 'in_progress', 'completed', 'failed', 'cancelled', 'incomplete'].map((value) => ({ value, label: value.replaceAll('_', ' ') }))} />
        <SelectFilter value={searchParams.get('origin')} placeholder="All sources" onChange={(value) => setFilter('origin', value)} options={[{ value: 'web', label: 'Web' }, { value: 'api', label: 'API' }]} className="w-28" />
        <SelectFilter value={searchParams.get('model')} placeholder="All models" onChange={(value) => setFilter('model', value)} options={models.map((model) => ({ value: model.id, label: model.name }))} className="w-44" />
        <Popover>
          <PopoverTrigger asChild><Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs"><Filter className="size-3.5" />More{filterCount > 0 && <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[9px]">{filterCount}</Badge>}</Button></PopoverTrigger>
          <PopoverContent align="center" collisionPadding={16} className="w-80 space-y-3">
            <div className="flex items-center justify-between"><span className="text-xs font-medium">Operational filters</span>{filterCount > 0 && <button className="text-xs text-muted-foreground hover:text-foreground" onClick={clearFilters}>Clear all</button>}</div>
            <div className="grid grid-cols-2 gap-2">
              <SelectFilter value={searchParams.get('agent')} placeholder="Any mode" onChange={(value) => setFilter('agent', value)} options={[{ value: 'true', label: 'Agent' }, { value: 'false', label: 'Standard' }]} className="w-full" />
              <SelectFilter value={searchParams.get('retry')} placeholder="Any retry" onChange={(value) => setFilter('retry', value)} options={[{ value: 'true', label: 'Retried' }, { value: 'false', label: 'No retry' }]} className="w-full" />
              <SelectFilter value={searchParams.get('fallback')} placeholder="Any fallback" onChange={(value) => setFilter('fallback', value)} options={[{ value: 'true', label: 'Fallback used' }, { value: 'false', label: 'No fallback' }]} className="w-full" />
              <SelectFilter value={searchParams.get('ocr')} placeholder="Any OCR" onChange={(value) => setFilter('ocr', value)} options={[{ value: 'completed', label: 'OCR completed' }, { value: 'failed', label: 'OCR failed' }, { value: 'not_requested', label: 'Not requested' }]} className="w-full" />
            </div>
            <DelayedFilterInput value={searchParams.get('tool') ?? ''} placeholder="Exact tool name" onChange={(value) => setFilter('tool', value)} />
            <DelayedFilterInput value={searchParams.get('errorCategory') ?? ''} placeholder="Exact error category" onChange={(value) => setFilter('errorCategory', value)} />
          </PopoverContent>
        </Popover>
        {(filterCount > 0 || searchParams.has('q')) && <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>Clear</Button>}
      </div>
      <RequestExplorer rows={rows} expanded={expanded} onExpand={(id) => setExpanded((current) => current === id ? null : id)} onInspect={setInspected}
        loading={requestsQuery.isLoading} loadingMore={requestsQuery.isFetchingNextPage} hasMore={requestsQuery.hasNextPage}
        loadError={requestsQuery.isFetchNextPageError ? requestsQuery.error : null} onLoadMore={() => void requestsQuery.fetchNextPage()} />
    </section>
    <RequestInspector requestId={inspected} onClose={() => setInspected(null)} />
  </div>
}

function SummaryStrip({ summary }: { summary: AdminUsageSummaryResult }) {
  const value = summary.summary
  const items: Array<{ label: string; value: ReactNode; note?: string; icon: ReactNode }> = [
    { label: 'Spend', value: formatMicros(value.spendMicros), icon: <CircleDollarSign /> },
    { label: 'Requests', value: value.requests.toLocaleString(), note: value.active ? `${value.active} active` : undefined, icon: <Activity /> },
    { label: 'Active users', value: value.activeUsers.toLocaleString(), icon: <UserRound /> },
    { label: 'Success', value: `${(value.successRate * 100).toFixed(1)}%`, note: `${value.errors.toLocaleString()} errors`, icon: <Check /> },
    { label: 'P95 latency', value: value.p95LatencyMs == null ? '—' : formatDuration(value.p95LatencyMs), icon: <Clock3 /> },
    { label: 'Tool spend', value: formatMicros(value.toolSpendMicros), note: `${formatMicros(value.providerToolCostMicros)} provider`, icon: <Wrench /> },
  ]
  return <div className="grid grid-cols-2 gap-y-3 md:grid-cols-3 lg:grid-cols-6 lg:divide-x">{items.map((item) => <div key={item.label} className="px-3 first:pl-0 last:pr-0"><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="[&>svg]:size-3.5">{item.icon}</span>{item.label}</div><div className="mt-1.5 text-lg font-medium tabular-nums">{item.value}</div>{item.note && <div className="mt-0.5 text-[10px] text-muted-foreground">{item.note}</div>}</div>)}</div>
}

function UsageChart({ data, metric, range }: { data: AdminUsageSummaryResult['daily']; metric: ChartMetric; range: AdminUsageRange }) {
  const { rows, series } = useMemo(() => {
    const totals = new Map<string, number>()
    for (const item of data) totals.set(item.modelId, (totals.get(item.modelId) ?? 0) + chartValue(item, metric))
    const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id)
    const grouped = new Map<string, Record<string, string | number>>()
    for (const item of data) {
      const row = grouped.get(item.day) ?? { day: item.day, other: 0 }
      const key = top.includes(item.modelId) ? item.modelId : 'other'
      row[key] = Number(row[key] ?? 0) + chartValue(item, metric); grouped.set(item.day, row)
    }
    return { rows: [...grouped.values()], series: [...top, ...(data.some((item) => !top.includes(item.modelId)) ? ['other'] : [])] }
  }, [data, metric])
  if (!rows.length) return <div className="grid h-28 place-items-center rounded-md border border-dashed bg-muted/10 text-xs text-muted-foreground">No usage in this period</div>
  if (rows.every((row) => series.every((key) => Number(row[key] ?? 0) === 0))) {
    return <div className="grid h-28 place-items-center rounded-md border border-dashed bg-muted/10 text-xs text-muted-foreground">No {metric === 'cost' ? 'billed spend' : metric} in this period</div>
  }
  const date = (value: string) => new Date(value.replace(' ', 'T'))
  return <div className="space-y-2">{series.length > 1 && <div className="flex min-h-5 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[10px] text-muted-foreground">{series.map((key, index) => <span key={key} className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ backgroundColor: key === 'other' ? 'hsl(220 15% 45%)' : CHART_COLORS[index % CHART_COLORS.length] }} />{key === 'other' ? 'Other' : getCatalogModel(key).name}</span>)}</div>}<div className={series.length > 1 ? 'h-60' : 'h-64'}><ResponsiveContainer width="100%" height="100%"><BarChart data={rows} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
    <CartesianGrid vertical={false} stroke="var(--border)" />
    <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} tickFormatter={(value: string) => range === '24h' ? date(value).toLocaleTimeString([], { hour: 'numeric' }) : date(value).toLocaleDateString([], { month: 'short', day: 'numeric' })} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
    <YAxis width={54} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} tickFormatter={(value: number) => metric === 'cost' ? `$${value < 1 ? value.toFixed(2) : value.toFixed(0)}` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)} />
    <ChartTooltip formatter={(value, name) => [metric === 'cost' ? `$${Number(value).toFixed(4)}` : Number(value).toLocaleString(), name === 'other' ? 'Other' : getCatalogModel(String(name)).name]} labelFormatter={(value) => date(String(value)).toLocaleString()} contentStyle={{ borderRadius: 6, borderColor: 'var(--border)', background: 'var(--popover)', fontSize: 12 }} />
    {series.map((key, index) => <Bar key={key} dataKey={key} stackId="usage" fill={key === 'other' ? 'hsl(220 15% 45%)' : CHART_COLORS[index % CHART_COLORS.length]} radius={index === series.length - 1 ? [3, 3, 0, 0] : 0} maxBarSize={42} />)}
  </BarChart></ResponsiveContainer></div></div>
}

function CostDrivers({ summary, onFilter }: { summary: AdminUsageSummaryResult; onFilter: (key: string, value: string | null) => void }) {
  return <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <DriverPanel title="Top models" icon={<BrainCircuit />} rows={summary.topModels.map((row) => ({ key: row.id, label: row.name, meta: countLabel(row.calls, 'request'), cost: row.costMicros, onClick: () => onFilter('model', row.id) }))} />
    <DriverPanel title="Top users" icon={<UserRound />} rows={summary.topUsers.map((row) => ({ key: row.id, label: row.name || row.email, meta: countLabel(row.calls, 'request'), cost: row.costMicros, avatar: <ProfileAvatar name={row.name || row.email} avatarUrl={row.avatarUrl} className="size-5" fallbackClassName="text-[8px]" />, onClick: () => onFilter('userId', row.id) }))} />
    <DriverPanel title="Top API keys" icon={<KeyRound />} rows={summary.topApiKeys.map((row) => ({ key: row.id, label: row.name, meta: `${row.prefix} · ${countLabel(row.calls, 'request')}`, cost: row.costMicros, onClick: () => onFilter('apiKeyId', row.id) }))} />
    <DriverPanel title="Top tools" icon={<Wrench />} rows={summary.topTools.map((row) => ({ key: row.name, label: row.name, meta: `${countLabel(row.calls, 'call')} · ${formatMicros(row.providerCostMicros)} provider`, cost: row.billedCostMicros, onClick: () => onFilter('tool', row.name) }))} />
  </div>
}

function DriverPanel({ title, icon, rows }: { title: string; icon: ReactNode; rows: Array<{ key: string; label: string; meta: string; cost: number; avatar?: ReactNode; onClick: () => void }> }) {
  const max = Math.max(...rows.map((row) => row.cost), 1)
  return <div className="overflow-hidden rounded-lg border"><div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium"><span className="[&>svg]:size-3.5">{icon}</span>{title}</div>{rows.length ? <div className="divide-y">{rows.slice(0, 6).map((row, index) => <button key={row.key} className="relative flex w-full items-center gap-2 overflow-hidden px-3 py-2 text-left hover:bg-muted/40" onClick={row.onClick}><span className="absolute inset-y-0 left-0 bg-primary/5" style={{ width: `${(row.cost / max) * 100}%` }} /><span className="relative w-3 text-[10px] text-muted-foreground">{index + 1}</span>{row.avatar}<span className="relative min-w-0 flex-1"><span className="block truncate text-xs">{row.label}</span><span className="block truncate text-[10px] text-muted-foreground">{row.meta}</span></span><span className="relative text-xs tabular-nums">{formatMicros(row.cost)}</span></button>)}</div> : <div className="p-6 text-center text-xs text-muted-foreground">No data</div>}</div>
}

function RequestExplorer({ rows, expanded, onExpand, onInspect, loading, loadingMore, hasMore, loadError, onLoadMore }: {
  rows: AdminUsageRequest[]; expanded: string | null; onExpand: (id: string) => void; onInspect: (id: string) => void;
  loading: boolean; loadingMore: boolean; hasMore: boolean; loadError: Error | null; onLoadMore: () => void
}) {
  if (loading) return <div className="space-y-2 p-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-10" />)}</div>
  if (!rows.length) return <div className="grid h-40 place-items-center text-xs text-muted-foreground">No requests match these filters</div>
  return <div className="relative max-h-[min(68vh,48rem)] overflow-y-auto overscroll-contain [scrollbar-gutter:stable]" tabIndex={0}><table className="w-full table-fixed text-left text-xs">
    <colgroup><col className="w-[4%]" /><col className="w-[15%] xl:w-[16%]" /><col className="w-[15%] xl:w-[16%]" /><col className="w-[15%] xl:w-[16%]" /><col className="w-[10%]" /><col className="w-[11%]" /><col className="w-[9%]" /><col className="w-[8%]" /><col className="w-[13%] xl:w-[10%]" /></colgroup>
    <thead className="sticky top-0 z-20 bg-background/95 text-muted-foreground shadow-[0_1px_0_var(--border)] backdrop-blur"><tr><th /><th className="px-1.5 py-2 font-normal">Time / source</th><th className="px-1.5 py-2 font-normal">Identity</th><th className="px-1.5 py-2 font-normal">Model</th><th className="px-1.5 py-2 text-right font-normal">Turns / tools</th><th className="px-1.5 py-2 text-right font-normal">Tokens</th><th className="px-1.5 py-2 text-right font-normal">Duration</th><th className="px-1.5 py-2 text-right font-normal">Cost</th><th className="px-1.5 py-2 font-normal">Status</th></tr></thead>
    <tbody className="divide-y">{rows.map((row) => <RequestRow key={row.id} row={row} open={expanded === row.id} onToggle={() => onExpand(row.id)} onInspect={() => onInspect(row.id)} />)}</tbody>
  </table>{(hasMore || loadingMore || loadError) && <div className="border-t p-3 text-center"><Button size="sm" variant="ghost" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? <><LoaderCircle className="animate-spin" />Loading…</> : loadError ? 'Retry loading requests' : 'Load more requests'}</Button>{loadError && <div className="mt-1 text-[10px] text-destructive">{loadError.message}</div>}</div>}</div>
}

function RequestRow({ row, open, onToggle, onInspect }: { row: AdminUsageRequest; open: boolean; onToggle: () => void; onInspect: () => void }) {
  const detailQuery = useQuery({ queryKey: ['admin-usage', 'request', row.id], enabled: open, queryFn: ({ signal }) => apiRequest<AdminUsageRequestDetail>(`/api/admin/usage/requests/${row.id}`, { signal }) })
  const createdAt = new Date(row.createdAt)
  return <><tr className={cn('hover:bg-muted/30', open && 'bg-muted/20')}>
    <td className="pl-2"><button className="grid size-6 place-items-center rounded hover:bg-muted" aria-label={open ? 'Collapse request' : 'Expand request'} onClick={onToggle}>{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</button></td>
    <td className="px-1.5 py-2"><div className="truncate whitespace-nowrap tabular-nums">{createdAt.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</div><div className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground"><span className="truncate tabular-nums">{createdAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><span>·</span>{row.agentMode && <Bot className="size-3 shrink-0" />}<span className="truncate uppercase">{row.origin}</span></div></td>
    <td className="px-1.5 py-2"><div className="flex min-w-0 items-center gap-1.5"><ProfileAvatar name={row.user.name} avatarUrl={row.user.avatarUrl} className="size-5 shrink-0" fallbackClassName="text-[8px]" /><span className="truncate">{row.apiKey?.name ?? row.user.name}</span></div><div className="mt-0.5 truncate text-[10px] text-muted-foreground">{row.apiKey ? `${row.apiKey.prefix} · ${row.user.email}` : row.user.email}</div></td>
    <td className="px-1.5 py-2"><div className="flex min-w-0 items-center gap-1.5"><ModelIcon model={getCatalogModel(row.requestedModel.id)} className="size-4 shrink-0" /><span className="truncate">{row.requestedModel.name}</span></div>{row.actualModel && row.actualModel.id !== row.requestedModel.id && <div className="mt-0.5 truncate pl-5 text-[10px] text-muted-foreground">→ {row.actualModel.name}</div>}</td>
    <td className="px-1.5 py-2 text-right tabular-nums"><div>{row.turns} / {row.toolCalls}</div>{(row.retryCount > 0 || row.fallbackUsed) && <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{row.retryCount ? `${row.retryCount} retry` : ''}{row.retryCount && row.fallbackUsed ? ' · ' : ''}{row.fallbackUsed ? 'fallback' : ''}</div>}</td>
    <td className="px-1.5 py-2 text-right tabular-nums"><div>{formatNumber(row.inputTokens + row.outputTokens)}</div><div className="mt-0.5 truncate text-[10px] text-muted-foreground">{formatNumber(row.inputTokens)} → {formatNumber(row.outputTokens)}</div></td>
    <td className="px-1.5 py-2 text-right tabular-nums">{row.durationMs == null ? '—' : formatDuration(row.durationMs)}</td><td className="px-1.5 py-2 text-right font-medium tabular-nums">{formatMicros(row.costMicros)}</td>
    <td className="overflow-hidden px-1.5 py-2"><StatusBadge status={row.status} compact />{row.errorCategory && <div className="mt-1 truncate text-[10px] text-destructive">{row.errorCategory}</div>}</td>
  </tr>{open && <tr className="bg-muted/10"><td colSpan={9} className="p-0">{detailQuery.isLoading ? <div className="flex h-24 items-center justify-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />Loading execution trace…</div> : detailQuery.error ? <div className="p-4 text-xs text-destructive">{detailQuery.error.message}</div> : detailQuery.data && <div className="p-4"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-medium">Execution trace</span><Button size="sm" variant="outline" className="h-7 text-xs" onClick={onInspect}>Inspect details <ExternalLink /></Button></div><ExecutionTimeline detail={detailQuery.data} compact /></div>}</td></tr>}</>
}

function ExecutionTimeline({ detail, compact = false }: { detail: AdminUsageRequestDetail; compact?: boolean }) {
  const items = adminUsageTimeline(detail)
  return <div><div className="relative space-y-0">{items.map((item, index) => {
    const itemError = item.type === 'tool' ? item.detail.error : item.detail.errorMessage
    return <div key={`${item.type}-${item.id}`} className="relative grid grid-cols-[16px_minmax(0,1fr)_auto] gap-2 py-2">
    {index < items.length - 1 && <span aria-hidden className="absolute -bottom-[19px] left-[7px] top-[19px] w-px bg-border" />}
    <span className={cn('relative z-10 mt-1 size-[15px] rounded-full border-2 border-background', item.type === 'model' ? 'bg-blue-500' : item.type === 'tool' ? 'bg-violet-500' : 'bg-amber-500')} />
    <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><span className="font-medium">{adminTimelineItemTitle(item)}</span><span className="truncate text-muted-foreground">· {item.label}</span><StatusBadge status={item.status} /></div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 text-[10px] text-muted-foreground"><span>{new Date(item.at).toLocaleTimeString()}</span>{item.durationMs != null && <span>{formatDuration(item.durationMs)}</span>}{item.type === 'model' && <><span>{formatNumber(item.detail.inputTokens)} → {formatNumber(item.detail.outputTokens)} tokens</span>{item.detail.cachedInputTokens > 0 && <span>{formatNumber(item.detail.cachedInputTokens)} cached</span>}{item.detail.retryAttempt > 1 && <span>attempt {item.detail.retryAttempt}</span>}{item.detail.fallbackFromModelId && <span>fallback from {getCatalogModel(item.detail.fallbackFromModelId).name}</span>}{item.detail.retryReason && <span>{item.detail.retryReason}</span>}</>}{item.type === 'tool' && <><span>{item.detail.provider ?? 'local'}</span><span>{formatMicros(item.detail.providerCostMicros)} provider</span></>}{item.type === 'ocr' && <span>cost not tracked</span>}</div>
      {!compact && item.type === 'tool' && Array.isArray(item.detail.providerAttempts) && item.detail.providerAttempts.length > 1 && <div className="mt-1 text-[10px] text-muted-foreground">{item.detail.providerAttempts.length} provider attempts</div>}
      {itemError && <div className="mt-1 text-[10px] text-destructive">{itemError}</div>}
    </div><div className="whitespace-nowrap text-right font-medium tabular-nums">{item.costMicros == null ? '—' : formatMicros(item.costMicros)}</div>
  </div>})}</div><div className="mt-2 grid gap-2 border-t pt-3 text-xs sm:grid-cols-4"><CostCell label="Model turns" value={detail.reconciliation.modelCostMicros} /><CostCell label="Billed tools" value={detail.reconciliation.toolBilledCostMicros} note={`${formatMicros(detail.reconciliation.toolProviderCostMicros)} provider`} /><CostCell label="Other / remainder" value={detail.reconciliation.remainderMicros} warning={detail.reconciliation.remainderMicros !== 0} /><CostCell label="Request total" value={detail.reconciliation.requestCostMicros} strong /></div></div>
}

function CostCell({ label, value, note, warning, strong }: { label: string; value: number; note?: string; warning?: boolean; strong?: boolean }) { return <div className={cn('rounded-md border px-2.5 py-2', warning && 'border-amber-500/40 bg-amber-500/5')}><div className="text-[10px] text-muted-foreground">{label}</div><div className={cn('mt-0.5 tabular-nums', strong && 'font-semibold')}>{formatMicros(value)}</div>{note && <div className="text-[9px] text-muted-foreground">{note}</div>}</div> }

function RequestInspector({ requestId, onClose }: { requestId: string | null; onClose: () => void }) {
  const detailQuery = useQuery({ queryKey: ['admin-usage', 'request', requestId], enabled: Boolean(requestId), queryFn: ({ signal }) => apiRequest<AdminUsageRequestDetail>(`/api/admin/usage/requests/${requestId}`, { signal }) })
  const detail = detailQuery.data
  return <Dialog open={Boolean(requestId)} onOpenChange={(open) => { if (!open) onClose() }}><DialogContent className="inset-y-0 right-0 left-auto top-0 flex h-screen max-h-screen w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-y-0 border-r-0 p-0 sm:max-w-3xl" showCloseButton>
    <DialogHeader className="border-b px-5 py-4 pr-12"><DialogTitle className="text-base">Request inspector</DialogTitle><DialogDescription className="truncate font-mono text-[11px]">{requestId}</DialogDescription></DialogHeader>
    {detailQuery.isLoading ? <div className="grid flex-1 place-items-center"><LoaderCircle className="size-5 animate-spin text-muted-foreground" /></div> : detailQuery.error ? <div className="grid flex-1 place-items-center p-6 text-sm text-destructive">{detailQuery.error.message}</div> : detail && <Tabs defaultValue="summary" className="min-h-0 flex-1 gap-0"><div className="border-b px-5 pt-3"><TabsList className="h-8"><TabsTrigger value="summary" className="text-xs">Summary</TabsTrigger><TabsTrigger value="trace" className="text-xs">Trace</TabsTrigger><TabsTrigger value="billing" className="text-xs">Billing</TabsTrigger><TabsTrigger value="metadata" className="text-xs">Metadata</TabsTrigger><TabsTrigger value="payloads" className="text-xs">Payloads</TabsTrigger></TabsList></div><div className="min-h-0 flex-1 overflow-y-auto p-5"><TabsContent value="summary"><InspectorSummary detail={detail} /></TabsContent><TabsContent value="trace"><ExecutionTimeline detail={detail} /></TabsContent><TabsContent value="billing"><BillingPanel detail={detail} /></TabsContent><TabsContent value="metadata"><MetadataPanel detail={detail} /></TabsContent><TabsContent value="payloads"><PayloadPanel detail={detail} /></TabsContent></div></Tabs>}
  </DialogContent></Dialog>
}

function InspectorSummary({ detail }: { detail: AdminUsageRequestDetail }) {
  const request = detail.request
  return <div className="space-y-5"><div className="flex items-center gap-3"><ProfileAvatar name={request.user.name} avatarUrl={request.user.avatarUrl} className="size-9" /><div className="min-w-0"><div className="truncate text-sm font-medium">{request.user.name}</div><div className="truncate text-xs text-muted-foreground">{request.user.email}{request.apiKey ? ` · ${request.apiKey.name}` : ''}</div></div><div className="ml-auto"><StatusBadge status={request.status} /></div></div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><InfoCell label="Started" value={new Date(request.startedAt ?? request.createdAt).toLocaleString()} /><InfoCell label="Duration" value={request.durationMs == null ? '—' : formatDuration(request.durationMs)} /><InfoCell label="Turns / tools" value={`${request.turns} / ${request.toolCalls}`} /><InfoCell label="Total cost" value={formatMicros(request.costMicros)} /></div>
    <div className="rounded-lg border p-4"><div className="mb-3 text-xs font-medium">Model and token usage</div><div className="flex items-center gap-2"><ModelIcon model={getCatalogModel(request.requestedModel.id)} className="size-5" /><span className="text-sm">{request.requestedModel.name}</span>{request.actualModel && request.actualModel.id !== request.requestedModel.id && <span className="text-xs text-muted-foreground">→ {request.actualModel.name}</span>}</div><div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5"><InfoCell label="Input" value={request.inputTokens.toLocaleString()} /><InfoCell label="Cached" value={request.cachedInputTokens.toLocaleString()} /><InfoCell label="Cache write" value={request.cacheWriteTokens.toLocaleString()} /><InfoCell label="Output" value={request.outputTokens.toLocaleString()} /><InfoCell label="Reasoning" value={request.reasoningTokens.toLocaleString()} /></div></div>
    {request.errorMessage && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs"><div className="font-medium text-destructive">{request.errorCategory ?? 'Request error'}</div><div className="mt-1 whitespace-pre-wrap text-muted-foreground">{request.errorMessage}</div></div>}
  </div>
}

function InfoCell({ label, value }: { label: string; value: ReactNode }) { return <div><div className="text-[10px] text-muted-foreground">{label}</div><div className="mt-0.5 text-xs tabular-nums">{value}</div></div> }

function BillingPanel({ detail }: { detail: AdminUsageRequestDetail }) {
  return <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><CostCell label="Model turn charges" value={detail.reconciliation.modelCostMicros} /><CostCell label="Tool charges" value={detail.reconciliation.toolBilledCostMicros} note={`${formatMicros(detail.reconciliation.toolProviderCostMicros)} provider cost`} /><CostCell label="Other / unreconciled" value={detail.reconciliation.remainderMicros} warning={detail.reconciliation.remainderMicros !== 0} /><CostCell label="Settled request total" value={detail.reconciliation.requestCostMicros} strong /></div>
    {detail.reconciliation.remainderMicros !== 0 && <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" /><span>The request total includes cost that is not represented by stored model-turn or billed-tool records. This can include historical or internal operations.</span></div>}
    <div className="rounded-lg border"><div className="border-b px-3 py-2 text-xs font-medium">Per-turn charges</div><div className="divide-y">{detail.attempts.map((attempt) => <div key={attempt.id} className="flex items-center gap-3 px-3 py-2 text-xs"><ModelIcon model={getCatalogModel(attempt.model.id)} className="size-4" /><span className="min-w-0 flex-1 truncate">{attempt.turnNumber ? `Turn ${attempt.turnNumber}` : attempt.purpose} · {attempt.model.name}</span><span className="text-muted-foreground">{attempt.inputTokens.toLocaleString()} → {attempt.outputTokens.toLocaleString()}</span><span className="font-medium tabular-nums">{formatMicros(attempt.costMicros)}</span></div>)}</div></div>
  </div>
}

function MetadataPanel({ detail }: { detail: AdminUsageRequestDetail }) {
  const metadata = { requestId: detail.request.id, responseId: detail.request.responseId, origin: detail.request.origin, agentMode: detail.request.agentMode, requestedModel: detail.request.requestedModel.id, actualModel: detail.request.actualModel?.id ?? null, userId: detail.request.user.id, apiKeyId: detail.request.apiKey?.id ?? null, agentRunId: detail.agentRun?.id ?? null, createdAt: detail.request.createdAt, startedAt: detail.request.startedAt, completedAt: detail.request.completedAt, retryCount: detail.request.retryCount, fallbackUsed: detail.request.fallbackUsed, stickyFallbackUsed: detail.request.stickyFallbackUsed, ocrStatus: detail.request.ocrStatus, payloadExpiresAt: detail.request.payloadExpiresAt }
  return <div className="space-y-3"><div className="text-xs text-muted-foreground">Operational identifiers and timestamps. Detailed content is available separately under Payloads.</div><pre className="overflow-auto rounded-lg border bg-muted/20 p-4 text-[11px] leading-5">{JSON.stringify(metadata, null, 2)}</pre></div>
}

function PayloadPanel({ detail }: { detail: AdminUsageRequestDetail }) {
  const [selected, setSelected] = useState<AdminUsagePayloadAvailability | null>(null)
  const [result, setResult] = useState<AdminUsagePayloadResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const prepareReveal = (payload: AdminUsagePayloadAvailability) => {
    setSelected(payload); setResult(null); setError(null); setSearch('')
  }
  const reveal = async () => {
    if (!selected) return
    setError(null); setLoading(true)
    try { setResult(await apiRequest<AdminUsagePayloadResult>(`/api/admin/usage-payloads/${detail.request.id}/reveal`, { method: 'POST', body: { scope: selected.scope, resourceId: selected.resourceId } })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to reveal payload') } finally { setLoading(false) }
  }
  const formatted = result ? (typeof result.value === 'string' ? result.value : JSON.stringify(result.value, null, 2)) : ''
  const visible = search ? formatted.split('\n').filter((line) => line.toLowerCase().includes(search.toLowerCase())).join('\n') : formatted
  return <div className="space-y-4"><div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" /><div><div className="font-medium">Sensitive data</div><div className="mt-0.5 text-muted-foreground">Reveal returns the exact unredacted stored value. Every reveal is recorded in the admin audit log.</div></div></div>
    <div className="divide-y rounded-lg border">{detail.payloads.map((payload) => <div key={`${payload.scope}-${payload.resourceId ?? 'request'}`}><div className="flex items-center gap-3 px-3 py-2.5"><Database className="size-4 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="truncate text-xs">{payload.label}</div><div className="text-[10px] text-muted-foreground">{payload.status === 'available' ? 'Stored' : payload.status === 'expired' ? 'Expired' : 'Not stored'}{payload.expiresAt ? ` · expires ${new Date(payload.expiresAt).toLocaleString()}` : ''}</div></div><Button size="sm" variant="outline" className="h-7 text-xs" disabled={payload.status !== 'available' || loading} onClick={() => prepareReveal(payload)}><Database />Reveal unredacted…</Button></div>{selected?.scope === payload.scope && selected.resourceId === payload.resourceId && !result && <div className="border-t border-amber-500/30 bg-amber-500/5 p-3 text-xs"><div className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" /><div><div className="font-medium">Confirm unredacted reveal</div><div className="mt-1 text-muted-foreground">This may contain credentials, personal data, or private message content. Access to {payload.label} will be audited.</div></div></div><div className="mt-3 flex justify-end gap-2"><Button size="sm" variant="ghost" className="h-7 text-xs" disabled={loading} onClick={() => setSelected(null)}>Cancel</Button><Button size="sm" variant="destructive" className="h-7 text-xs" disabled={loading} onClick={() => void reveal()}>{loading && <LoaderCircle className="animate-spin" />}Reveal exact payload</Button></div></div>}</div>)}</div>
    {error && <div className="text-xs text-destructive">{error}</div>}{result && <div className="overflow-hidden rounded-lg border"><div className="flex items-center gap-2 border-b p-2"><Search className="ml-1 size-3.5 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search revealed value" className="h-7 border-0 px-1 text-xs shadow-none focus-visible:ring-0" /><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void navigator.clipboard.writeText(formatted)}><Copy />Copy</Button></div><pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap break-words bg-muted/20 p-4 text-[10px] leading-4">{visible || (search ? 'No matching lines' : '')}</pre></div>}
  </div>
}

function DashboardSkeleton() { return <div className="space-y-5"><div className="grid grid-cols-3 gap-3 lg:grid-cols-6">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-16" />)}</div><Skeleton className="h-64" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-40" />)}</div></div> }
function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) { return <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-lg border text-sm text-muted-foreground"><AlertTriangle className="size-5 text-destructive" /><span>{error instanceof Error ? error.message : 'Unable to load usage analytics'}</span><Button size="sm" variant="outline" onClick={onRetry}>Try again</Button></div> }
