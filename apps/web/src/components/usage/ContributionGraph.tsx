import { useCallback, useMemo, useState } from 'react'
import type { DailyModelUsage } from '@/lib/mock'
import { formatUsd } from '@/lib/format'
import type { Metric } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ui, uit, activeLocale } from '@/i18n/ui'

const CELL = 11
const GAP = 3
const STEP = CELL + GAP
const GUTTER = 28 // day-of-week labels
const HEADER = 16 // month labels

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const LEVEL_COLORS = [
  'bg-muted',
  'bg-emerald-500/25 dark:bg-emerald-400/20',
  'bg-emerald-500/50 dark:bg-emerald-400/40',
  'bg-emerald-500/75 dark:bg-emerald-400/65',
  'bg-emerald-600 dark:bg-emerald-400',
]

interface Cell {
  key: string
  dateLabel: string
  value: number
  level: 0 | 1 | 2 | 3 | 4
  placeholder: boolean
}

function localKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function metricValue(day: DailyModelUsage, metric: Metric): number {
  return metric === 'cost' ? day.cost : metric === 'tokens' ? day.tokens : day.calls
}

function formatValue(value: number, metric: Metric): string {
  if (metric === 'cost') return formatUsd(value)
  if (metric === 'tokens') return `${Math.round(value).toLocaleString(activeLocale())} tokens`
  return `${Math.round(value).toLocaleString(activeLocale())} calls`
}

/** GitHub-style contribution heatmap with year switcher, month labels and hover tooltip. */
export function ContributionGraph({ data, metric }: { data: DailyModelUsage[]; metric: Metric }) {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState<'now' | number>('now')
  const [tip, setTip] = useState<{ x: number; y: number; above: boolean; text: string } | null>(null)

  const years = useMemo(() => {
    const set = new Set<number>([currentYear])
    for (const d of data) {
      const y = Number(d.date.slice(0, 4))
      if (!Number.isNaN(y)) set.add(y)
    }
    return [...set].sort((a, b) => b - a)
  }, [data, currentYear])

  const { weeks, monthLabels, activeDays, total } = useMemo(() => {
    const byDate = new Map(data.map((d) => [d.date, d]))
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const start = new Date(today)
    const end = new Date(today)
    if (year === 'now') {
      start.setDate(start.getDate() - 364)
    } else {
      start.setFullYear(year, 0, 1)
      end.setFullYear(year, 11, 31)
    }
    const gridStart = new Date(start)
    gridStart.setDate(gridStart.getDate() - gridStart.getDay())

    // quartile thresholds over positive in-window values
    const vals: number[] = []
    for (const c = new Date(gridStart); c <= end; c.setDate(c.getDate() + 1)) {
      if (c < start) continue
      const rec = byDate.get(localKey(c))
      if (rec) {
        const v = metricValue(rec, metric)
        if (v > 0) vals.push(v)
      }
    }
    vals.sort((a, b) => a - b)
    const q1 = vals[Math.floor(vals.length * 0.25)] ?? 0
    const q2 = vals[Math.floor(vals.length * 0.5)] ?? 0
    const q3 = vals[Math.floor(vals.length * 0.75)] ?? 0
    const levelOf = (v: number): Cell['level'] => {
      if (v <= 0) return 0
      if (v <= q1) return 1
      if (v <= q2) return 2
      if (v <= q3) return 3
      return 4
    }

    const weeksArr: Cell[][] = []
    const labels: { text: string; col: number }[] = []
    let week: Cell[] = []
    let lastMonth = -1
    let active = 0
    let sum = 0
    for (const it = new Date(gridStart); it <= end; it.setDate(it.getDate() + 1)) {
      const before = it < start
      const rec = byDate.get(localKey(it))
      const v = before || !rec ? 0 : metricValue(rec, metric)
      if (it.getDay() === 0 && it.getMonth() !== lastMonth && !before) {
        labels.push({ text: MONTHS[it.getMonth()], col: weeksArr.length })
        lastMonth = it.getMonth()
      }
      if (!before && v > 0) {
        active++
        sum += v
      }
      week.push({
        key: localKey(it),
        dateLabel: it.toLocaleDateString(activeLocale(), { month: 'short', day: 'numeric', year: 'numeric' }),
        value: v,
        level: before ? 0 : levelOf(v),
        placeholder: before,
      })
      if (week.length === 7) {
        weeksArr.push(week)
        week = []
      }
    }
    if (week.length > 0) weeksArr.push(week)
    return { weeks: weeksArr, monthLabels: labels, activeDays: active, total: sum }
  }, [data, metric, year])

  const onEnter = useCallback((e: React.MouseEvent<HTMLDivElement>, cell: Cell) => {
    const r = e.currentTarget.getBoundingClientRect()
    const above = r.top > 80
    const text =
      cell.value > 0
        ? `${formatValue(cell.value, metric)} on ${cell.dateLabel}`
        : `No ${metric === 'cost' ? 'usage' : metric} on ${cell.dateLabel}`
    setTip({ x: r.left + r.width / 2, y: above ? r.top - 8 : r.bottom + 8, above, text })
  }, [metric])
  const clear = useCallback(() => setTip(null), [])

  const graphWidth = GUTTER + weeks.length * STEP + 2

  return (
    <div onScrollCapture={clear}>
      <div className="mb-3 text-xs font-medium text-muted-foreground">
        {year === 'now'
          ? uit`${activeDays} active days in the last year`
          : uit`${activeDays} active days in ${year}`}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="overflow-x-auto pb-1" onScroll={clear}>
            <div className="relative" style={{ width: graphWidth, height: HEADER + 7 * STEP + 2 }}>
              {/* month labels */}
              {monthLabels.map((m, i) => (
                <span
                  key={i}
                  className="absolute top-0 text-[10px] text-muted-foreground"
                  style={{ left: GUTTER + m.col * STEP }}
                >
                  {m.text}
                </span>
              ))}
              {/* day-of-week labels */}
              {[
                { dow: 1, label: ui("Mon") },
                { dow: 3, label: ui("Wed") },
                { dow: 5, label: ui("Fri") },
              ].map((d) => (
                <span
                  key={d.dow}
                  className="absolute text-right text-[10px] leading-none text-muted-foreground"
                  style={{ top: HEADER + d.dow * STEP + CELL / 2 - 5, left: 0, width: GUTTER - 8 }}
                >
                  {d.label}
                </span>
              ))}
              {/* week columns */}
              <div className="absolute flex" style={{ left: GUTTER, top: HEADER, gap: GAP }}>
                {weeks.map((week, wi) => (
                  <div key={wi} className="flex flex-col" style={{ gap: GAP }}>
                    {week.map((cell) =>
                      cell.placeholder ? (
                        <div key={cell.key} style={{ width: CELL, height: CELL }} />
                      ) : (
                        <div
                          key={cell.key}
                          className={cn('rounded-[2px]', LEVEL_COLORS[cell.level])}
                          style={{ width: CELL, height: CELL }}
                          onMouseEnter={(e) => onEnter(e, cell)}
                          onMouseLeave={clear}
                        />
                      )
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* footer: total + legend */}
          <div className="mt-1 flex items-center justify-between" style={{ maxWidth: graphWidth }}>
            <span className="text-[10px] text-muted-foreground">
              {total > 0
                ? uit`Total: ${formatValue(total, metric)}`
                : uit`No activity in ${year === 'now' ? 'the last year' : year}`}
            </span>
            <div className="flex items-center gap-1">
              <span className="mr-1 text-[10px] text-muted-foreground">{ui("Less")}</span>
              {LEVEL_COLORS.map((c, i) => (
                <div key={i} className={cn('size-2.5 rounded-[2px]', c)} />
              ))}
              <span className="ml-1 text-[10px] text-muted-foreground">{ui("More")}</span>
            </div>
          </div>
        </div>

        {/* year switcher */}
        <div className="flex shrink-0 gap-1.5 lg:w-20 lg:flex-col">
          {(['now', ...years] as const).map((y) => (
            <button
              key={y}
              onClick={() => {
                clear()
                setYear(y)
              }}
              className={cn(
                'cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                year === y
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {y === 'now' ? ui("Now") : y}
            </button>
          ))}
        </div>
      </div>

      {/* hover tooltip */}
      {tip && (
        <div
          className="pointer-events-none fixed z-50 rounded-md border bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap text-popover-foreground shadow-md"
          style={{
            left: tip.x,
            top: tip.y,
            transform: tip.above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
          }}
        >
          {tip.text}
        </div>
      )}
    </div>
  )
}
