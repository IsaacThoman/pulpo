import { useMemo } from 'react'
import type { DailyUsage } from '@/lib/mock'
import { formatCost, formatNumber } from '@/lib/format'
import type { Metric } from '@/lib/types'
import { cn } from '@/lib/utils'

/** GitHub-style 365-day contribution heatmap */
export function Heatmap({ data, metric }: { data: DailyUsage[]; metric: Metric }) {
  const weeks = useMemo(() => {
    const byDate = new Map(data.map((d) => [d.date, d]))
    const today = new Date()
    const days: { date: string; value: number }[] = []
    for (let i = 364; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86_400_000)
      const key = d.toISOString().slice(0, 10)
      const rec = byDate.get(key)
      const value = rec ? (metric === 'cost' ? rec.cost : metric === 'tokens' ? rec.tokens : rec.calls) : 0
      days.push({ date: key, value })
    }
    // pad start so column 0 begins on Sunday
    const firstDow = new Date(days[0].date).getDay()
    const padded: ({ date: string; value: number } | null)[] = [
      ...Array.from({ length: firstDow }, () => null),
      ...days,
    ]
    const cols: (typeof padded)[] = []
    for (let i = 0; i < padded.length; i += 7) cols.push(padded.slice(i, i + 7))
    const max = Math.max(1, ...days.map((d) => d.value))
    return { cols, max }
  }, [data, metric])

  const level = (v: number) => {
    if (v <= 0) return 0
    const ratio = v / weeks.max
    if (ratio < 0.25) return 1
    if (ratio < 0.5) return 2
    if (ratio < 0.75) return 3
    return 4
  }

  const colors = [
    'bg-muted',
    'bg-emerald-500/25 dark:bg-emerald-400/20',
    'bg-emerald-500/50 dark:bg-emerald-400/40',
    'bg-emerald-500/75 dark:bg-emerald-400/65',
    'bg-emerald-600 dark:bg-emerald-400',
  ]

  const label = (date: string, value: number) =>
    `${date} · ${
      metric === 'cost'
        ? formatCost(value)
        : metric === 'tokens'
          ? `${formatNumber(value)} tokens`
          : `${value} calls`
    }`

  return (
    <div className="flex gap-[3px] overflow-x-auto pb-1">
      {weeks.cols.map((week, wi) => (
        <div key={wi} className="flex flex-col gap-[3px]">
          {week.map((day, di) =>
            day === null ? (
              <div key={`pad-${di}`} className="size-[11px]" />
            ) : (
              <div
                key={day.date}
                className={cn('size-[11px] rounded-[2px]', colors[level(day.value)])}
                title={label(day.date, day.value)}
                aria-label={label(day.date, day.value)}
              />
            )
          )}
        </div>
      ))}
    </div>
  )
}
