import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import type { DailyModelUsage } from '@/lib/mock'
import { getCatalogModel } from '@/stores/catalog'
import { formatUsd } from '@/lib/format'
import type { Metric } from '@/lib/types'
import { ContributionGraph } from './ContributionGraph'
import { ui, activeLocale } from '@/i18n/ui'
import { useSettings } from '@/stores/settings'
import { DEFAULT_CHART_ANIMATION_DURATION_MS, scaledAnimationDuration } from '@/lib/animation-speed'

// Series colors by usage rank (OpenWebUI-Monitor palette)
const CHART_COLORS = [
  'hsl(220 70% 55%)',
  'hsl(160 60% 45%)',
  'hsl(30 80% 50%)',
  'hsl(280 60% 55%)',
  'hsl(340 65% 55%)',
  'hsl(190 65% 45%)',
  'hsl(85 45% 45%)',
  'hsl(15 70% 55%)',
]
const OTHER_COLOR = 'hsl(220 15% 45%)'
const MAX_LEGEND_MODELS = 8
const MAX_SEGMENTS_PER_DAY = 4

interface Series {
  key: string // modelId or 'other'
  name: string
  color: string
}

function valueOf(m: { calls: number; tokens: number; cost: number }, metric: Metric): number {
  return metric === 'cost' ? m.cost : metric === 'tokens' ? m.tokens : m.calls
}

function formatValue(v: number, metric: Metric): string {
  if (metric === 'cost') return formatUsd(v)
  if (metric === 'tokens') return `${Math.round(v).toLocaleString(activeLocale())} Tokens`
  return `${Math.round(v).toLocaleString(activeLocale())} calls`
}

/** per-day averages keep one decimal for small call counts ("0.3 calls") */
function formatAvg(v: number, metric: Metric): string {
  if (metric !== 'calls') return formatValue(v, metric)
  return `${v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString(activeLocale())} calls`
}

/** adaptive axis decimals for small dollar amounts */
function axisCost(v: number): string {
  if (v === 0) return '$0'
  if (v < 0.01) return `$${v.toFixed(3)}`
  if (v < 1) return `$${v.toFixed(2)}`
  return `$${v.toFixed(1)}`
}

function formatDay(date: string, withYear = false): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(activeLocale(), {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' as const } : {}),
  })
}

interface TipPayloadItem {
  dataKey?: string | number
  value?: number | string
}

function ChartTip({
  active,
  payload,
  label,
  metric,
  series,
}: {
  active?: boolean
  payload?: readonly TipPayloadItem[]
  label?: string | number
  metric: Metric
  series: Series[]
}) {
  if (!active || !payload?.length) return null
  const items = payload
    .filter((p) => Number(p.value) > 0)
    .sort((a, b) => Number(b.value) - Number(a.value))
  if (items.length === 0) return null
  const total = items.reduce((a, p) => a + Number(p.value), 0)
  const nameOf = (key: string | number | undefined) =>
    series.find((s) => s.key === key)?.name ?? String(key)
  const colorOf = (key: string | number | undefined) =>
    series.find((s) => s.key === key)?.color ?? 'var(--muted-foreground)'
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{formatDay(String(label), true)}</div>
      <div className="mt-1 border-b pb-1 text-muted-foreground">
        {metric === 'cost' ? ui("USD") : metric === 'tokens' ? ui("Tokens") : ui("Calls")}:{' '}
        <span className="font-medium text-foreground tabular-nums">{formatValue(total, metric)}</span>
      </div>
      <div className="mt-1.5 space-y-0.5">
        {items.map((p) => (
          <div key={String(p.dataKey)} className="flex items-center justify-between gap-5">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-[2px]" style={{ background: colorOf(p.dataKey) }} />
              {nameOf(p.dataKey)}
            </span>
            <span className="tabular-nums">{formatValue(Number(p.value), metric)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function DailyUsageChart({
  data,
  contributionData,
  metric,
  periodDayCount,
  modelNames,
}: {
  data: DailyModelUsage[]
  contributionData?: DailyModelUsage[]
  metric: Metric
  /** number of days in the selected period, for per-day averages */
  periodDayCount: number
  modelNames?: Record<string, string>
}) {
  const animationSpeed = useSettings((state) => state.animationSpeed)
  const animationDuration = scaledAnimationDuration(DEFAULT_CHART_ANIMATION_DURATION_MS, animationSpeed)
  const { rows, series } = useMemo(() => {
    // rank models by total metric value across the whole period
    const totals = new Map<string, number>()
    for (const day of data)
      for (const m of day.models) totals.set(m.modelId, (totals.get(m.modelId) ?? 0) + valueOf(m, metric))
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
    const top = ranked.slice(0, MAX_LEGEND_MODELS)
    const hasOther = ranked.length > MAX_SEGMENTS_PER_DAY

    // per day: only the top 4 models get their own segment, the rest roll into "Other"
    const rows = data.map((day) => {
      const visible = day.models
        .filter((m) => top.includes(m.modelId))
        .sort((a, b) => valueOf(b, metric) - valueOf(a, metric))
        .slice(0, MAX_SEGMENTS_PER_DAY)
        .map((m) => m.modelId)
      const row: Record<string, number | string> = { date: day.date }
      let other = 0
      for (const m of day.models) {
        if (visible.includes(m.modelId)) row[m.modelId] = valueOf(m, metric)
        else other += valueOf(m, metric)
      }
      if (hasOther) row.other = other
      return row
    })

    const series: Series[] = [
      // largest model ends up on top of the stack (recharts stacks bottom-up)
      ...(hasOther ? [{ key: 'other', name: 'Other', color: OTHER_COLOR }] : []),
      ...top
        .slice()
        .reverse()
        .map((id) => ({
          key: id,
          name: modelNames?.[id] ?? getCatalogModel(id).name,
          color: CHART_COLORS[top.indexOf(id) % CHART_COLORS.length],
        })),
    ]
    return { rows, series }
  }, [data, metric, modelNames])

  const averages = useMemo(() => {
    const days = Math.max(1, periodDayCount)
    const t = data.reduce(
      (a, d) => ({ cost: a.cost + d.cost, tokens: a.tokens + d.tokens, calls: a.calls + d.calls }),
      { cost: 0, tokens: 0, calls: 0 }
    )
    return { cost: t.cost / days, tokens: t.tokens / days, calls: t.calls / days }
  }, [data, periodDayCount])

  // legend order: rank order, Other last (series are reversed for stacking)
  const legend = useMemo(
    () => [
      ...series.filter((s) => s.key !== 'other').reverse(),
      ...series.filter((s) => s.key === 'other'),
    ],
    [series]
  )

  const title =
    metric === 'cost' ? 'Daily USD Usage' : metric === 'tokens' ? 'Daily Token Usage' : 'Daily Calls'

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {legend.length > 0 && (
          <div className="flex flex-1 flex-wrap items-center justify-end gap-x-3 gap-y-1">
            {legend.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-2.5 rounded-[2px]" style={{ background: s.color }} />
                {s.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="flex h-[250px] items-center justify-center text-xs text-muted-foreground"> {ui("No usage in this period")} </div>
      ) : (
        <div className="mt-3 h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
                tickFormatter={(d: string) => formatDay(d)}
                minTickGap={30}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
                width={48}
                tickFormatter={(v: number) =>
                  metric === 'cost'
                    ? axisCost(v)
                    : v >= 1000
                      ? `${(v / 1000).toFixed(1)}k`
                      : String(Math.round(v))
                }
              />
              <RTooltip
                cursor={{ fill: 'var(--muted)', fillOpacity: 0.5 }}
                content={<ChartTip metric={metric} series={series} />}
              />
              {series.map((s) => (
                <Bar key={s.key} dataKey={s.key} stackId="day" fill={s.color} maxBarSize={28} animationDuration={animationDuration} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* per-day averages */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-0 sm:divide-x">
        {[
          { label: ui("Avg. spend per day"), value: formatAvg(averages.cost, 'cost') },
          { label: ui("Avg. tokens per day"), value: formatAvg(averages.tokens, 'tokens') },
          { label: ui("Avg. calls per day"), value: formatAvg(averages.calls, 'calls') },
        ].map((s) => (
          <div key={s.label} className="sm:px-4 py-3 first:pl-0 last:pr-0">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="mt-1 text-sm font-medium">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-2 border-t pt-4">
        <ContributionGraph data={contributionData ?? data} metric={metric} />
      </div>
    </div>
  )
}
