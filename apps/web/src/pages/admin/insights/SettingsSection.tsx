import type { InsightsSettings, NamedCount } from '@pulpo/contracts'
import { ChartCard, KpiTile, RankedList } from '@/features/admin-analytics/components'
import { formatCount, formatPercent } from '@/features/admin-analytics/format'
import type { AnalyticsSearch } from '@/features/admin-analytics/search-params'
import { ui } from '@/i18n/ui'
import { settingLabel } from './labels'
import { share, useInsights } from './query'
import { CoverageNote, KpiGrid, SectionError } from './shared'

function countRows(counts: NamedCount[], total: number, label: (count: NamedCount) => string = (count) => count.label) {
  return counts.map((count) => ({
    key: count.id,
    label: label(count),
    value: count.count,
    display: formatPercent(share(count.count, total)),
    detail: formatCount(count.count),
  }))
}

function Distribution({ title, counts, total, loading }: { title: string; counts: NamedCount[]; total: number; loading: boolean }) {
  return (
    <ChartCard title={title}>
      <RankedList loading={loading} rows={countRows(counts, total, (count) => settingLabel(count.id, count.label))} />
    </ChartCard>
  )
}

export function SettingsSection({ search }: { search: AnalyticsSearch }) {
  const query = useInsights<InsightsSettings>('settings', search)
  const data = query.data
  if (query.isError && !data) return <SectionError error={query.error} />
  const loading = query.isPending
  const captured = data?.settingsCaptured ?? 0
  const sumOf = (counts: NamedCount[] | undefined) => (counts ?? []).reduce((sum, count) => sum + count.count, 0)
  return (
    <div className="space-y-3">
      <CoverageNote captured={captured} total={data?.totalRequests ?? 0} />
      <KpiGrid>
        <KpiTile label={ui('Settings captured')} value={formatCount(captured)} loading={loading} />
        <KpiTile label={ui('With custom instructions')} value={formatPercent(share(data?.customInstructions ?? 0, captured))} loading={loading} />
        <KpiTile label={ui('With memory enabled')} value={formatPercent(share(data?.memoryEnabled ?? 0, captured))} loading={loading} />
        <KpiTile label={ui('Presets in use')} value={formatCount(data?.presets.length ?? 0)} loading={loading} />
      </KpiGrid>
      <div className="grid gap-3 lg:grid-cols-2">
        {loading && <ChartCard title={ui('Presets')}><RankedList rows={[]} loading /></ChartCard>}
        {!loading && !data?.presets.length && <ChartCard title={ui('Presets')}><RankedList rows={[]} emptyText={ui('No preset selections in this range')} /></ChartCard>}
        {data?.presets.map((preset) => (
          <ChartCard key={preset.presetId} title={preset.presetName} description={preset.modelName ?? preset.modelId ?? undefined}>
            <RankedList rows={preset.choices.map((choice) => ({
              key: choice.choiceId,
              label: choice.choiceName,
              value: choice.count,
              display: formatPercent(share(choice.count, preset.total)),
              detail: formatCount(choice.count),
            }))} />
          </ChartCard>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Distribution title={ui('Reasoning effort')} counts={data?.reasoningEffort ?? []} total={sumOf(data?.reasoningEffort)} loading={loading} />
        <Distribution title={ui('Verbosity')} counts={data?.verbosity ?? []} total={sumOf(data?.verbosity)} loading={loading} />
        <Distribution title={ui('Temperature')} counts={data?.temperature ?? []} total={sumOf(data?.temperature)} loading={loading} />
      </div>
      <ChartCard title={ui('Instruction presets')} description={ui('Share of requests with settings captured.')}>
        <RankedList loading={loading} emptyText={ui('No instruction presets used in this range')} rows={countRows(data?.instructionPresets ?? [], captured)} />
      </ChartCard>
    </div>
  )
}
