import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, ChevronDown, ChevronRight, CircleCheck, Clock3, Coins, RefreshCw, Zap } from 'lucide-react'
import { io, type Socket } from 'socket.io-client'
import { isDesktopRuntime, runtimeInstanceUrl, runtimeSessionToken } from '@/lib/runtime'
import type { AdminUsageEvent, ClientToServerEvents, ServerToClientEvents } from '@pulpo/contracts'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { apiRequest } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ui, uit, activeLocale } from '@/i18n/ui'
import { useSettings } from '@/stores/settings'
import { DEFAULT_CHART_ANIMATION_DURATION_MS, scaledAnimationDuration } from '@/lib/animation-speed'
import { usageRequestSequence } from './usage-request-sequence'

type Range = '24h' | '7d' | '30d' | '90d' | 'all'
interface SummaryResult {
  summary: Record<string, number>; daily: Array<{ day: string; modelId: string; calls: number; costMicros: number; tokens: number }>
  topModels: Array<{ id: string; calls: number; costMicros: number }>; topUsers: Array<{ id: string; name: string; email: string; calls: number; costMicros: number }>
  topApiKeys: Array<{ id: string; name: string; prefix: string; calls: number; costMicros: number }>
}
interface LogRow { id: string; responseId: string; origin: string; purpose: string; status: string; requestedModelId: string; actualModelId: string | null; currentModelId: string | null; retryAttempt: number; turnNumber: number | null; retryCount: number; fallbackUsed: boolean; stickyFallbackUsed: boolean; ocrStatus: string; errorCategory: string | null; errorMessage: string | null; inputTokens: number; cachedInputTokens: number; cacheWriteTokens: number; outputTokens: number; costMicros: number; durationMs: number | null; tokensPerSecond: number | null; createdAt: string; user: { name: string; email: string }; apiKey: { name: string; prefix: string } | null }

export function AdminUsagePage() {
  const [range, setRange] = useState<Range>('24h')
  const animationSpeed = useSettings((state) => state.animationSpeed)
  const animationDuration = scaledAnimationDuration(DEFAULT_CHART_ANIMATION_DURATION_MS, animationSpeed)
  const [status, setStatus] = useState('all')
  const [summary, setSummary] = useState<SummaryResult | null>(null)
  const [rows, setRows] = useState<LogRow[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const query = `range=${range}${status === 'all' ? '' : `&status=${status}`}`
  const load = useCallback(async () => {
    const [s, r] = await Promise.all([apiRequest<SummaryResult>(`/api/admin/usage/summary?${query}`), apiRequest<{ data: LogRow[] }>(`/api/admin/usage/requests?${query}`)])
    setSummary(s); setRows(r.data)
  }, [query])
  useEffect(() => { void load() }, [load])
  useEffect(() => { const timer = window.setInterval(() => void load(), 2_000); return () => clearInterval(timer) }, [load])
  useEffect(() => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(isDesktopRuntime() ? runtimeInstanceUrl() : undefined, {
      path: '/socket.io',
      withCredentials: !isDesktopRuntime(),
      auth: isDesktopRuntime() ? { sessionToken: runtimeSessionToken() } : undefined,
    })
    const subscribe = () => { socket.emit('admin.usage.subscribe'); void load() }
    socket.on('connect', subscribe)
    socket.on('admin.usage.upsert', (_event: AdminUsageEvent) => { void load() })
    return () => { socket.emit('admin.usage.unsubscribe'); socket.disconnect() }
  }, [load])
  const chart = useMemo(() => Object.values(summary?.daily.reduce<Record<string, { day: string; calls: number; cost: number }>>((acc, item) => { const day = item.day.slice(0, 10); acc[day] ??= { day, calls: 0, cost: 0 }; acc[day]!.calls += item.calls; acc[day]!.cost += item.costMicros / 1_000_000; return acc }, {}) ?? {}), [summary])
  const s = summary?.summary ?? {}
  return <div className="space-y-5">
    <div className="flex items-center gap-3"><div><h2 className="text-lg font-semibold">{ui("Usage & operations")}</h2><p className="text-xs text-muted-foreground">{ui("Every web, API, agent, and built-in model call in real time.")}</p></div><div className="flex-1" /><Select value={range} onValueChange={(v: Range) => setRange(v)}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent>{['24h','7d','30d','90d','all'].map((v) => <SelectItem key={v} value={v}>{v === 'all' ? ui("All time") : v}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="icon-sm" onClick={() => void load()}><RefreshCw /></Button></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
      <Metric icon={<Activity />} label={ui("Active requests")} value={(s.queued ?? 0) + (s.inProgress ?? 0)} />
      <Metric icon={<CircleCheck />} label={ui("Completed")} value={s.completed ?? 0} />
      <Metric icon={<AlertTriangle />} label={ui("Errors")} value={(s.failed ?? 0) + (s.incomplete ?? 0)} />
      <Metric icon={<Coins />} label={ui("Spend")} value={`$${((s.spendMicros ?? 0) / 1_000_000).toFixed(4)}`} />
      <Metric icon={<Clock3 />} label={ui("Avg latency")} value={`${Math.round(s.averageLatencyMs ?? 0)} ms`} />
      <Metric icon={<Zap />} label={ui("Success")} value={`${((s.successRate ?? 0) * 100).toFixed(1)}%`} />
    </div>
    <Card className="gap-0 rounded-lg py-0 shadow-none"><div className="flex items-center gap-2 border-b px-3 py-2"><span className="text-xs font-medium">{ui("Recent model calls")}</span><div className="flex-1" /><Select value={status} onValueChange={setStatus}><SelectTrigger size="sm" className="w-32 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{ui("All statuses")}</SelectItem>{['in_progress','completed','failed'].map((v) => <SelectItem key={v} value={v}>{v.replace('_',' ')}</SelectItem>)}</SelectContent></Select></div>
      <div className="overflow-x-auto"><table className="data-table"><thead><tr className="border-b"><th className="px-3 py-2" /><th className="px-3 py-2">{ui("Started")}</th><th className="px-3 py-2">{ui("Source / identity")}</th><th className="px-3 py-2">{ui("Requested → actual")}</th><th className="px-3 py-2">{ui("Turn / attempt")}</th><th className="px-3 py-2">{ui("OCR")}</th><th className="px-3 py-2 text-right">{ui("Tokens")}</th><th className="px-3 py-2 text-right">{ui("Cost")}</th><th className="px-3 py-2">{ui("Status")}</th></tr></thead><tbody>{rows.map((row) => <RequestRow key={row.id} row={row} open={expanded === row.id} detail={expanded === row.id ? detail : null} onToggle={async () => { if (expanded === row.id) { setExpanded(null); setDetail(null); return } setExpanded(row.id); setDetail(await apiRequest(`/api/admin/usage/requests/${row.id}`)) }} />)}</tbody></table></div>
    </Card>
    <Card><CardContent className="h-64 p-4"><div className="mb-2 text-sm font-medium">{ui("Daily model calls")}</div><ResponsiveContainer width="100%" height="90%"><BarChart data={chart}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="day" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="calls" fill="#3b82f6" radius={[4,4,0,0]} animationDuration={animationDuration} /></BarChart></ResponsiveContainer></CardContent></Card>
    <div className="grid gap-3 lg:grid-cols-3"><Top title={ui("Top models")} rows={(summary?.topModels ?? []).map((x) => ({ label: x.id, value: `${x.calls} calls` }))} /><Top title={ui("Top users")} rows={(summary?.topUsers ?? []).map((x) => ({ label: x.name || x.email, value: `${x.calls} calls` }))} /><Top title={ui("Top API keys")} rows={(summary?.topApiKeys ?? []).map((x) => ({ label: x.name, value: `${x.calls} calls` }))} /></div>
  </div>
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) { return <Card><CardContent className="p-3"><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="[&>svg]:size-3.5">{icon}</span>{label}</div><div className="mt-2 text-xl font-semibold tabular-nums">{value}</div></CardContent></Card> }
function Top({ title, rows }: { title: string; rows: Array<{ label: string; value: string }> }) { return <Card><CardContent className="p-4"><div className="mb-3 text-sm font-medium">{title}</div><div className="space-y-2">{rows.length ? rows.map((r, i) => <div key={`${r.label}-${i}`} className="flex gap-3 text-xs"><span className="w-4 text-muted-foreground">{i+1}</span><span className="min-w-0 flex-1 truncate">{r.label}</span><span className="text-muted-foreground">{r.value}</span></div>) : <span className="text-xs text-muted-foreground">{ui("No data")}</span>}</div></CardContent></Card> }
function RequestRow({ row, open, detail, onToggle }: { row: LogRow; open: boolean; detail: Record<string, unknown> | null; onToggle: () => void }) { const live = row.status === 'in_progress'; const position = usageRequestSequence(row); const sequence = position.kind === 'turn' ? uit`Turn ${position.number}` : position.kind === 'compaction' ? ui("Compaction") : uit`Attempt ${position.number}`; return <><tr><td className="px-3 py-2"><button onClick={onToggle}>{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</button></td><td className="whitespace-nowrap px-3 py-2">{new Date(row.createdAt).toLocaleTimeString(activeLocale())}<div className="text-muted-foreground">{row.durationMs == null ? '—' : uit`${(row.durationMs/1000).toFixed(1)}s`}</div></td><td className="px-3 py-2">{row.origin.toUpperCase()}<div className="max-w-36 truncate text-muted-foreground">{row.purpose} · {row.apiKey?.name ?? row.user.name}</div></td><td className="px-3 py-2">{row.requestedModelId}<div className="text-muted-foreground">→ {row.actualModelId ?? row.currentModelId ?? '—'}</div></td><td className="px-3 py-2">{sequence}<div className="flex gap-1">{row.retryCount > 0 && <Badge variant="outline">{row.retryCount} {ui("retry")}</Badge>}{row.fallbackUsed && <Badge variant="outline">{ui("fallback")}</Badge>}{row.stickyFallbackUsed && <Badge variant="outline">{ui("sticky")}</Badge>}</div></td><td className="px-3 py-2"><Badge variant={row.ocrStatus === 'failed' ? 'destructive' : 'outline'}>{row.ocrStatus}</Badge></td><td className="px-3 py-2 text-right tabular-nums">{row.inputTokens + row.outputTokens}</td><td className="px-3 py-2 text-right tabular-nums">${(row.costMicros/1_000_000).toFixed(4)}</td><td className="px-3 py-2"><Badge variant={row.status === 'failed' ? 'destructive' : live ? 'secondary' : 'outline'}>{live && <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-blue-500" />}{row.status}</Badge>{row.errorCategory && <div className="mt-1 text-destructive">{row.errorCategory}</div>}</td></tr>{open && <tr className="bg-muted/20"><td colSpan={9} className="p-4"><pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-3 text-[11px]">{detail ? JSON.stringify(detail, null, 2) : ui("Loading…")}</pre></td></tr>}</> }
