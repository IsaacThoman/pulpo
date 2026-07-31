import { useEffect, useMemo, useState } from 'react'
import { Clock } from 'lucide-react'
import { useUsage } from '@/stores/usage'
import { useAuth } from '@/stores/auth'
import { makeDailyModelUsage } from '@/lib/mock'
import { formatBalance, formatDate } from '@/lib/format'
import { periodDays, rangeMs } from '@/lib/time-range'
import type { Metric, TimeRange } from '@/lib/types'
import { ToggleGroup } from '@/components/usage/ToggleGroup'
import { StatsRow } from '@/components/usage/StatsRow'
import { DailyUsageChart } from '@/components/usage/DailyUsageChart'
import { RecentUsagePanel, TopModelsPanel, type TopModelStat } from '@/components/usage/UsagePanels'

const RANGES: { id: TimeRange; label: string }[] = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '90d', label: '90d' },
  { id: 'all', label: 'All' },
]
const METRICS: { id: Metric; label: string }[] = [
  { id: 'cost', label: 'USD' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'calls', label: 'Calls' },
]

export function PersonalPage() {
  const loadPersonal = useUsage((s) => s.loadPersonal)
  const records = useUsage((s) => s.records)
  const userId = useUsage((s) => s.currentUserId)
  const users = useUsage((s) => s.users)
  const authUser = useAuth((state) => state.user)
  const me = users.find((u) => u.id === userId) ?? {
    id: authUser?.id ?? '', name: authUser?.name ?? 'Pulpo user', email: authUser?.email ?? '',
    nickname: null, role: authUser?.role ?? 'user', balance: (authUser?.balanceMicros ?? 0) / 1_000_000,
    joinedAt: authUser ? Date.parse(authUser.createdAt) : Date.now(), blocked: false,
    showOnLeaderboard: true, barColor: '#10b981',
  }
  const [range, setRange] = useState<TimeRange>('30d')
  const [metric, setMetric] = useState<Metric>('cost')

  useEffect(() => { void loadPersonal() }, [loadPersonal])

  const mine = useMemo(() => records.filter((r) => r.userId === userId), [records, userId])
  const inRange = useMemo(
    () => mine.filter((r) => Date.now() - r.timestamp <= rangeMs(range)),
    [mine, range]
  )

  const totals = useMemo(() => {
    const calls = inRange.length
    const tokens = inRange.reduce((a, r) => a + r.tokensIn + r.tokensOut, 0)
    const cost = inRange.reduce((a, r) => a + r.cost, 0)
    return { calls, tokens, cost }
  }, [inRange])

  // full-span daily data powers the contribution graph; range-filtered powers the bars
  const dailyAll = useMemo(() => makeDailyModelUsage(mine), [mine])
  const dailyRange = useMemo(
    () => dailyAll.filter((d) => Date.now() - new Date(`${d.date}T00:00:00`).getTime() <= rangeMs(range)),
    [dailyAll, range]
  )

  const topModels = useMemo<TopModelStat[]>(() => {
    const m = new Map<string, { calls: number; cost: number }>()
    for (const r of inRange) {
      const e = m.get(r.modelId) ?? { calls: 0, cost: 0 }
      e.calls++
      e.cost += r.cost
      m.set(r.modelId, e)
    }
    return [...m.entries()]
      .map(([modelId, s]) => ({ modelId, ...s }))
      .sort((a, b) => b.cost - a.cost)
  }, [inRange])

  const firstUse = mine.length > 0 ? mine[mine.length - 1].timestamp : null

  return (
    <div className="space-y-6">
      {/* profile + balance */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-lg font-medium">{me.name}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {me.email} · Joined {formatDate(me.joinedAt)}
          </div>
        </div>
        <div className="text-right">
          <div className="mb-1 text-xs text-muted-foreground">Balance</div>
          <div className="text-2xl font-medium text-emerald-600 dark:text-emerald-400">
            {formatBalance(me.balance)}
          </div>
        </div>
      </div>

      {/* usage overview */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-xs font-medium">
              <Clock className="size-3" />
              Usage overview
            </span>
            <div className="h-4 w-px bg-border" />
            <ToggleGroup options={METRICS} value={metric} onChange={setMetric} />
          </div>
          <ToggleGroup options={RANGES} value={range} onChange={setRange} />
        </div>
        <StatsRow calls={totals.calls} tokens={totals.tokens} cost={totals.cost} />
      </section>

      {/* daily chart + contribution graph */}
      <DailyUsageChart
        data={dailyRange}
        contributionData={dailyAll}
        metric={metric}
        periodDayCount={periodDays(range, firstUse)}
      />

      {/* records + model ranking */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentUsagePanel records={inRange} showBalance />
        </div>
        <TopModelsPanel models={topModels} />
      </div>
    </div>
  )
}
