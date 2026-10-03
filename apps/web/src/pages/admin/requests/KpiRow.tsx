import type { RequestKpis } from '@pulpo/contracts'
import { KpiTile } from '@/features/admin-analytics/components'
import { formatCount, formatMicros, formatMs, formatPercent, relativeChange } from '@/features/admin-analytics/format'
import { ui } from '@/i18n/ui'

function tokens(kpis: RequestKpis): number {
  return kpis.inputTokens + kpis.outputTokens
}

/** Change vs previous period; latency and rates compare nullable values. */
function change(current: number | null, previous: number | null | undefined): number | null {
  return current === null ? null : relativeChange(current, previous)
}

export function KpiRow({ current, previous, loading }: { current: RequestKpis | undefined; previous: RequestKpis | null | undefined; loading: boolean }) {
  const show = Boolean(current) && !loading
  // All-time ranges have no previous period; omit deltas rather than show "no prior data".
  const has = previous !== null && previous !== undefined
  const delta = (pick: (kpis: RequestKpis) => number | null) => (current && has ? change(pick(current), pick(previous)) : undefined)
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-10 [&>*]:min-w-0">
      <KpiTile loading={!show} label={ui('Requests')} value={current ? formatCount(current.requests) : '—'} change={delta((k) => k.requests)} goodWhen="neutral" />
      <KpiTile loading={!show} label={ui('Success rate')} value={current ? formatPercent(current.successRate) : '—'} change={delta((k) => k.successRate)} goodWhen="up" hint={ui('Completed share of finished requests')} />
      <KpiTile loading={!show} label={ui('Error rate')} value={current ? formatPercent(current.errorRate) : '—'} change={delta((k) => k.errorRate)} goodWhen="down" />
      <KpiTile loading={!show} label={ui('TTFT p50')} value={formatMs(current?.ttftP50Ms)} change={delta((k) => k.ttftP50Ms)} goodWhen="down" hint={ui('Time to first token, median')} />
      <KpiTile loading={!show} label={ui('TTFT p95')} value={formatMs(current?.ttftP95Ms)} change={delta((k) => k.ttftP95Ms)} goodWhen="down" hint={ui('Time to first token, 95th percentile')} />
      <KpiTile loading={!show} label={ui('Duration p50')} value={formatMs(current?.durationP50Ms)} change={delta((k) => k.durationP50Ms)} goodWhen="down" />
      <KpiTile loading={!show} label={ui('Duration p95')} value={formatMs(current?.durationP95Ms)} change={delta((k) => k.durationP95Ms)} goodWhen="down" />
      <KpiTile loading={!show} label={ui('Spend')} value={current ? formatMicros(current.costMicros) : '—'} change={delta((k) => k.costMicros)} goodWhen="neutral" />
      <KpiTile loading={!show} label={ui('Tokens')} value={current ? formatCount(tokens(current)) : '—'} change={delta(tokens)} goodWhen="neutral" hint={ui('Input plus output tokens')} />
      <KpiTile loading={!show} label={ui('In flight')} value={current ? formatCount(current.inFlight) : '—'} />
    </div>
  )
}
