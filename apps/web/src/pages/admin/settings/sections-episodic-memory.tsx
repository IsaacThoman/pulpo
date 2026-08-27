import { useCallback, useEffect, useState } from 'react'
import { Activity, AlertCircle, CheckCircle2, Clock3, Database, Gauge, Layers3, Loader2, RotateCcw, Square } from 'lucide-react'
import type {
  EpisodicMemoryAdminStatus,
  EpisodicMemoryProfile,
  EpisodicMemoryRecallMode,
  EpisodicMemoryStatistics,
  EpisodicMemoryStatisticsRange,
} from '@pulpo/contracts'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SaveBar, Section, Toggle } from '@/components/admin/kit'
import { apiRequest } from '@/lib/api'
import { activeLocale, ui, uit } from '@/i18n/ui'

function bytes(value: number): string {
  if (value < 1_000) return `${Math.round(value)} B`
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)} kB`
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(value >= 100_000_000 ? 0 : 1)} MB`
  return `${(value / 1_000_000_000).toFixed(1)} GB`
}

function latency(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)}s` : `${Math.round(value)} ms`
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function count(value: number): string {
  return value.toLocaleString(activeLocale())
}

function relativeAge(value: number): string {
  if (!value) return '—'
  const seconds = Math.floor(value / 1_000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function generationStatusLabel(status: 'pending' | 'pulling' | 'indexing' | 'ready' | 'failed' | 'cancelled'): string {
  if (status === 'pending') return ui('Pending')
  if (status === 'pulling') return ui('Downloading model')
  if (status === 'indexing') return ui('Indexing')
  if (status === 'ready') return ui('Ready')
  if (status === 'failed') return ui('Failed')
  return ui('Cancelled')
}

export function EpisodicMemorySection() {
  const [status, setStatus] = useState<EpisodicMemoryAdminStatus | null>(null)
  const [statisticsRange, setStatisticsRange] = useState<EpisodicMemoryStatisticsRange>('24h')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => setStatus(await apiRequest<EpisodicMemoryAdminStatus>(`/api/admin/settings/episodic-memory?range=${statisticsRange}`)), [statisticsRange])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const interval = window.setInterval(() => void load(), status?.buildingGeneration ? 2_000 : 30_000)
    return () => window.clearInterval(interval)
  }, [load, status?.buildingGeneration])
  if (!status) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{ui('Loading episodic memory status…')}</div>

  const selected = status.profiles.find((profile) => profile.id === status.settings.profile) ?? status.profiles[0]!
  const installed = status.ollama.installedModels.find((model) => model.name === selected.model)
  const generation = status.buildingGeneration ?? status.activeGeneration
  const save = async () => {
    setBusy(true)
    try {
      setStatus(await apiRequest<EpisodicMemoryAdminStatus>(`/api/admin/settings/episodic-memory?range=${statisticsRange}`, {
        method: 'PATCH', body: status.settings,
      }))
    } finally { setBusy(false) }
  }
  const action = async (path: 'rebuild' | 'cancel') => {
    setBusy(true)
    try {
      await apiRequest(`/api/admin/settings/episodic-memory/${path}`, { method: 'POST' })
      await load()
    } finally { setBusy(false) }
  }

  return <div>
    <Section title={ui('Episodic memory')} hint={ui("Generate embeddings locally and recall relevant material from a user's previous chats when their Memories setting is enabled.")}>
      <Toggle
        label={ui('Enable relevant-chat recall')}
        hint={ui('Enabling downloads the selected model and backfills eligible chats for users who opted into Memories. Disabling pauses indexing and recall without deleting the active index.')}
        checked={status.settings.enabled}
        onChange={(enabled) => setStatus({ ...status, settings: { ...status.settings, enabled } })}
      />
      <label className="flex items-start justify-between gap-6 text-sm">
        <span><span className="block">{ui('Embedding model')}</span><span className="mt-0.5 block text-xs text-muted-foreground">{ui('Curated local models only. A model change builds a parallel index before switching.')}</span></span>
        <select
          className="h-9 w-64 rounded-md border bg-background px-3 text-sm"
          value={status.settings.profile}
          onChange={(event) => setStatus({ ...status, settings: { ...status.settings, profile: event.target.value as EpisodicMemoryProfile } })}
        >
          {status.profiles.map((profile) => <option key={profile.id} value={profile.id}>{uit`${profile.label} · ${profile.dimension}d · ~${bytes(profile.approximateSizeBytes)}`}</option>)}
        </select>
      </label>
      <label className="flex items-start justify-between gap-6 text-sm">
        <span><span className="block">{ui('Automatic recall mode')}</span><span className="mt-0.5 block text-xs text-muted-foreground">{ui('Balanced is the default; conservative abstains more often and eager recalls more broadly.')}</span></span>
        <select
          className="h-9 w-48 rounded-md border bg-background px-3 text-sm capitalize"
          value={status.settings.recallMode}
          onChange={(event) => setStatus({ ...status, settings: { ...status.settings, recallMode: event.target.value as EpisodicMemoryRecallMode } })}
        >
          {(['conservative', 'balanced', 'eager'] as const).map((mode) => <option key={mode} value={mode}>{ui(mode[0]!.toUpperCase() + mode.slice(1))}</option>)}
        </select>
      </label>
    </Section>

    <Section title={ui('Local runtime')} hint={uit`Pulpo connects to ${selected.model} through the deployment's PULPO_OLLAMA_URL.`}>
      <div className="flex items-center gap-2 text-sm">
        {status.ollama.healthy ? <CheckCircle2 className="size-4 text-emerald-600" /> : <AlertCircle className="size-4 text-amber-600" />}
        <span>{status.ollama.healthy
          ? status.ollama.version ? uit`Ollama ${status.ollama.version} is healthy` : ui('Ollama is healthy')
          : status.ollama.error ?? ui('Ollama is unavailable')}</span>
      </div>
      {status.ollama.healthy && <div className="text-sm">{installed
        ? uit`${selected.label} installed · ${installed.digest.slice(0, 19)}… · ${bytes(installed.size)}`
        : uit`${selected.label} is not installed yet`}</div>}
    </Section>

    <Section title={ui('Index status')} hint={ui('Download and backfill run on a dedicated queue and never consume response-generation concurrency.')}>
      {!generation && <div className="text-sm text-muted-foreground">{ui('No index has been built.')}</div>}
      {generation && <div className="space-y-2 text-sm">
        <div className="flex justify-between"><span>{generationStatusLabel(generation.status)}</span><span>{uit`${generation.profile} · ${generation.dimension} dimensions`}</span></div>
        {generation.status === 'pulling' && <div>{bytes(generation.downloadCompletedBytes)} / {bytes(generation.downloadTotalBytes || selected.approximateSizeBytes)}</div>}
        {generation.status === 'indexing' && <div>{uit`${generation.completedItems} / ${generation.totalItems} items · ${generation.failedItems} failed`}</div>}
        {generation.error && <div className="text-destructive">{generation.error}</div>}
      </div>}
      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={busy || !status.settings.enabled} onClick={() => void action('rebuild')}><RotateCcw />{ui('Rebuild index')}</Button>
        <Button type="button" variant="outline" disabled={busy || !status.buildingGeneration} onClick={() => void action('cancel')}><Square />{ui('Cancel build')}</Button>
      </div>
    </Section>
    <Section title={ui('Operational statistics')} hint={ui('Aggregate-only performance and health statistics; prompts, excerpts, and per-user activity are never recorded.')}>
      <EpisodicStatisticsPanel
        statistics={status.statistics}
        range={statisticsRange}
        onRangeChange={setStatisticsRange}
      />
    </Section>
    <SaveBar onSave={busy ? undefined : save} />
  </div>
}

export function EpisodicStatisticsPanel({
  statistics,
  range,
  onRangeChange,
}: {
  statistics: EpisodicMemoryStatistics
  range: EpisodicMemoryStatisticsRange
  onRangeChange: (range: EpisodicMemoryStatisticsRange) => void
}) {
  const { current, summary } = statistics
  const queueDepth = current.queue.pending + current.queue.active
  const chart = statistics.series.map((point) => ({
    ...point,
    label: new Date(point.bucketStart).toLocaleString(activeLocale(), range === '24h'
      ? { hour: 'numeric' }
      : { month: 'short', day: 'numeric' }),
  }))
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-sm font-medium">{ui('Performance and health')}</div>
        <div className="text-xs text-muted-foreground">{ui('Hourly aggregates are retained without storing chat content.')}</div>
      </div>
      <select
        aria-label={ui('Statistics range')}
        className="h-8 w-24 rounded-md border bg-background px-2 text-xs"
        value={range}
        onChange={(event) => onRangeChange(event.target.value as EpisodicMemoryStatisticsRange)}
      >
        {(['24h', '7d', '30d'] as const).map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
    </div>

    <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
      <StatisticCard icon={<Clock3 />} label={ui('P95 recall overhead')} value={latency(summary.recall.latency.p95Ms)} />
      <StatisticCard icon={<Activity />} label={ui('Recall rate')} value={percentage(summary.recall.recallRate)} />
      <StatisticCard icon={<Gauge />} label={ui('Fallback rate')} value={percentage(summary.retrieval.fallbackRate)} />
      <StatisticCard icon={<Layers3 />} label={ui('Index coverage')} value={percentage(current.coverage)} />
      <StatisticCard icon={<Database />} label={ui('Queue depth')} value={current.queue.available ? count(queueDepth) : '—'} />
      <StatisticCard icon={<AlertCircle />} label={ui('Error rate')} value={percentage(summary.totalErrorRate)} />
    </div>

    <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
      <Card className="shadow-none">
        <CardContent className="h-60 p-4">
          <div className="mb-3 text-xs font-medium">{ui('Recall requests and p95 overhead')}</div>
          <ResponsiveContainer width="100%" height="88%">
            <ComposedChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={20} />
              <YAxis yAxisId="count" allowDecimals={false} tick={{ fontSize: 10 }} />
              <YAxis yAxisId="latency" orientation="right" tick={{ fontSize: 10 }} unit="ms" />
              <Tooltip />
              <Bar isAnimationActive={false} yAxisId="count" dataKey="recalled" name={ui('Recalled')} fill="#3b82f6" radius={[3, 3, 0, 0]} />
              <Bar isAnimationActive={false} yAxisId="count" dataKey="errors" name={ui('Errors')} fill="#ef4444" radius={[3, 3, 0, 0]} />
              <Line isAnimationActive={false} yAxisId="latency" dataKey="p95RecallLatencyMs" name={ui('P95 latency')} stroke="#a855f7" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="shadow-none"><CardContent className="space-y-2 p-4">
        <div className="text-xs font-medium">{ui('Current index')}</div>
        <StatisticRow label={ui('Indexed chats')} value={count(current.indexedChats)} />
        <StatisticRow label={ui('Chat chunks')} value={count(current.indexedChunks)} />
        <StatisticRow label={ui('Saved facts')} value={count(current.indexedFacts)} />
        <StatisticRow label={ui('Users indexed')} value={count(current.indexedUsers)} />
        <StatisticRow label={ui('Pending / failed')} value={`${count(current.pendingItems)} / ${count(current.failedItems)}`} />
        <StatisticRow label={ui('Queue active / failed')} value={`${count(current.queue.active)} / ${count(current.queue.failed)}`} />
        <StatisticRow label={ui('Queue status')} value={current.queue.available ? ui('Available') : ui('Unavailable')} />
        <StatisticRow label={ui('Index storage')} value={bytes(current.storageBytes)} />
        <StatisticRow label={ui('Oldest queued job')} value={relativeAge(current.queue.oldestJobAgeMs)} />
        <StatisticRow label={ui('Last indexed')} value={current.lastIndexedAt ? new Date(current.lastIndexedAt).toLocaleString(activeLocale()) : '—'} />
      </CardContent></Card>
    </div>

    <div className="overflow-x-auto rounded-lg border">
      <table className="data-table min-w-[760px]">
        <thead><tr className="border-b">
          <th className="px-3 py-2">{ui('Operation')}</th>
          <th className="px-3 py-2 text-right">{ui('Calls')}</th>
          <th className="px-3 py-2 text-right">{ui('P50')}</th>
          <th className="px-3 py-2 text-right">{ui('P95')}</th>
          <th className="px-3 py-2 text-right">{ui('Errors')}</th>
          <th className="px-3 py-2 text-right">{ui('Items')}</th>
        </tr></thead>
        <tbody>
          <OperationRow
            label={ui('Automatic recall')}
            operation={summary.recall}
            suffix={uit`${percentage(summary.recall.recallRate)} recalled · ${percentage(summary.recall.abstentionRate)} abstained`}
          />
          <OperationRow label={ui('Ollama embedding')} operation={summary.embedding} />
          <OperationRow label={ui('Database search and ranking')} operation={summary.databaseSearch} />
          <OperationRow label={ui('Indexing batches')} operation={summary.indexing} suffix={uit`${summary.indexing.itemsPerHour.toFixed(1)} items/hour`} />
          <OperationRow label={ui('search_chats')} operation={summary.agentSearch} />
          <OperationRow label={ui('read_chat')} operation={summary.agentRead} />
        </tbody>
      </table>
    </div>
  </div>
}

function StatisticCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <Card className="shadow-none"><CardContent className="p-3">
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="[&>svg]:size-3.5">{icon}</span>{label}</div>
    <div className="mt-2 text-lg font-semibold tabular-nums">{value}</div>
  </CardContent></Card>
}

function StatisticRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 text-xs"><span className="text-muted-foreground">{label}</span><span className="text-right tabular-nums">{value}</span></div>
}

function OperationRow({
  label,
  operation,
  suffix,
}: {
  label: string
  operation: { events: number; errors: number; items: number; latency: { p50Ms: number; p95Ms: number } }
  suffix?: string
}) {
  return <tr>
    <td className="px-3 py-2">{label}{suffix && <div className="text-[10px] text-muted-foreground">{suffix}</div>}</td>
    <td className="px-3 py-2 text-right tabular-nums">{count(operation.events)}</td>
    <td className="px-3 py-2 text-right tabular-nums">{latency(operation.latency.p50Ms)}</td>
    <td className="px-3 py-2 text-right tabular-nums">{latency(operation.latency.p95Ms)}</td>
    <td className="px-3 py-2 text-right tabular-nums">{count(operation.errors)}</td>
    <td className="px-3 py-2 text-right tabular-nums">{count(operation.items)}</td>
  </tr>
}
