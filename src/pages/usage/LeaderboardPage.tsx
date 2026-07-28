import { useMemo, useState } from 'react'
import { Crown } from 'lucide-react'
import { useUsage } from '@/stores/usage'
import { formatCost, formatDateTime, formatNumber, timeAgo } from '@/lib/format'
import type { Metric } from '@/lib/types'
import { ToggleGroup } from './PersonalPage'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ModelIcon } from '@/components/ModelIcon'
import { getModel } from '@/lib/mock'

const SORTS: { id: Metric | 'balance'; label: string }[] = [
  { id: 'cost', label: 'Spend' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'calls', label: 'Calls' },
  { id: 'balance', label: 'Balance' },
]

export function LeaderboardPage() {
  const records = useUsage((s) => s.records)
  const users = useUsage((s) => s.users)
  const currentUserId = useUsage((s) => s.currentUserId)
  const setLeaderboardPref = useUsage((s) => s.setLeaderboardPref)
  const [sort, setSort] = useState<Metric | 'balance'>('cost')

  const me = users.find((u) => u.id === currentUserId)!

  const rows = useMemo(() => {
    const stats = new Map<string, { calls: number; tokens: number; cost: number }>()
    for (const r of records) {
      const e = stats.get(r.userId) ?? { calls: 0, tokens: 0, cost: 0 }
      e.calls++
      e.tokens += r.tokensIn + r.tokensOut
      e.cost += r.cost
      stats.set(r.userId, e)
    }
    return users
      .filter((u) => u.showOnLeaderboard && !u.blocked)
      .map((u) => ({ user: u, ...(stats.get(u.id) ?? { calls: 0, tokens: 0, cost: 0 }) }))
      .sort((a, b) => (sort === 'balance' ? b.user.balance - a.user.balance : b[sort] - a[sort]))
  }, [records, users, sort])

  const max = rows.length
    ? Math.max(...rows.map((r) => (sort === 'balance' ? r.user.balance : r[sort])))
    : 1

  const expensive = useMemo(() => [...records].sort((a, b) => b.cost - a.cost)[0], [records])

  const fmt = (v: number) => (sort === 'cost' || sort === 'balance' ? formatCost(v) : formatNumber(v))

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Leaderboard</h2>
        <div className="flex-1" />
        <ToggleGroup options={SORTS} value={sort} onChange={setSort} />
      </div>

      {expensive && (
        <Card className="border-amber-500/30 bg-amber-500/5 shadow-none">
          <CardContent className="flex items-center gap-4 px-5 py-4">
            <Crown className="size-5 text-amber-500" />
            <div className="text-sm">
              <span className="font-medium">Most expensive call: </span>
              {users.find((u) => u.id === expensive.userId)?.name} burned{' '}
              <span className="font-semibold">{formatCost(expensive.cost)}</span> on{' '}
              {getModel(expensive.modelId).name} ({formatNumber(expensive.tokensIn + expensive.tokensOut)}{' '}
              tokens, {formatDateTime(expensive.timestamp)})
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-none">
        <CardContent className="space-y-2.5 px-5 py-5">
          {rows.map((r, i) => {
            const value = sort === 'balance' ? r.user.balance : r[sort]
            const name = r.user.nickname ?? r.user.name
            return (
              <div key={r.user.id} className="flex items-center gap-3">
                <span className="w-6 text-right text-sm tabular-nums text-muted-foreground">{i + 1}</span>
                <div className="w-40 truncate text-sm font-medium">
                  {name}
                  {r.user.id === currentUserId && (
                    <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                  )}
                </div>
                <div className="h-5 flex-1 overflow-hidden rounded-sm bg-muted">
                  {r.user.barColor === '#fafafa' ? (
                    <div
                      className="flex h-full items-center justify-end rounded-sm bg-primary pr-2"
                      style={{ width: `${Math.max(3, (value / max) * 100)}%` }}
                    >
                      <span className="text-[11px] font-medium tabular-nums text-primary-foreground">
                        {fmt(value)}
                      </span>
                    </div>
                  ) : (
                    <div
                      className="flex h-full items-center justify-end rounded-sm pr-2"
                      style={{
                        width: `${Math.max(3, (value / max) * 100)}%`,
                        backgroundColor: r.user.barColor,
                      }}
                    >
                      <span className="text-[11px] font-medium tabular-nums text-white">
                        {fmt(value)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* privacy prefs */}
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-sm">Your leaderboard preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-5 pb-5">
          <div className="flex items-center justify-between">
            <div className="text-sm">Show me on the leaderboard</div>
            <Switch
              checked={me.showOnLeaderboard}
              onCheckedChange={(v) => setLeaderboardPref(me.id, { showOnLeaderboard: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm">Nickname</div>
            <Input
              className="w-48"
              placeholder={me.name}
              value={me.nickname ?? ''}
              onChange={(e) => setLeaderboardPref(me.id, { nickname: e.target.value || null })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm">Bar color</div>
            <input
              type="color"
              className="h-8 w-12 cursor-pointer rounded border bg-transparent"
              value={me.barColor === '#fafafa' ? '#3f3f46' : me.barColor}
              onChange={(e) => setLeaderboardPref(me.id, { barColor: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      {/* global recent feed */}
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-sm">Recent activity (all users)</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <table className="w-full text-sm">
            <tbody>
              {records.slice(0, 8).map((r) => {
                const u = users.find((x) => x.id === r.userId)!
                return (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-6 py-2 text-muted-foreground">{timeAgo(r.timestamp)}</td>
                    <td className="py-2">{u.nickname ?? u.name}</td>
                    <td className="py-2">
                      <span className="flex items-center gap-1.5">
                        <ModelIcon model={getModel(r.modelId)} className="size-4 rounded-[2px]" />
                        {getModel(r.modelId).name}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatNumber(r.tokensIn + r.tokensOut)} tok</td>
                    <td className="px-6 py-2 text-right tabular-nums">{formatCost(r.cost)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
