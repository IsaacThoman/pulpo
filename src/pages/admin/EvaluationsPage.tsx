import { useMemo, useState } from 'react'
import { Download, ThumbsDown, ThumbsUp, Trophy } from 'lucide-react'
import { ARENA_MODELS, makeEvalLeaderboard, makeFeedback } from '@/lib/mock-admin'
import { getModel } from '@/lib/mock'
import { useUsage } from '@/stores/usage'
import { formatDateTime, timeAgo } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { ModelIcon } from '@/components/ModelIcon'
import { cn } from '@/lib/utils'

export function EvaluationsPage() {
  const [tab, setTab] = useState<'leaderboard' | 'feedback'>('leaderboard')
  const [arenaEnabled, setArenaEnabled] = useState(true)
  const leaderboard = useMemo(makeEvalLeaderboard, [])
  const feedback = useMemo(makeFeedback, [])
  const users = useUsage((s) => s.users)

  const maxRating = leaderboard[0]?.rating ?? 1

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Evaluations</h2>
        <div className="ml-2 flex rounded-lg border p-0.5">
          {(['leaderboard', 'feedback'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'cursor-pointer rounded-md px-2.5 py-1 text-xs capitalize transition-colors',
                tab === t ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {tab === 'feedback' && (
          <Button variant="outline" size="sm">
            <Download />
            Export
          </Button>
        )}
      </div>

      {tab === 'leaderboard' && (
        <div className="space-y-4">
          <Card className="shadow-none">
            <CardContent className="flex items-center justify-between px-5 py-4">
              <div>
                <div className="text-sm font-medium">Arena models</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Blind A/B battles between model sets, rated by users.
                </p>
              </div>
              <Switch checked={arenaEnabled} onCheckedChange={setArenaEnabled} />
            </CardContent>
          </Card>

          {arenaEnabled && (
            <div className="grid gap-3 sm:grid-cols-2">
              {ARENA_MODELS.map((a) => (
                <Card key={a.id} className="shadow-none">
                  <CardContent className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <Trophy className="size-4 text-amber-500" />
                      <span className="font-medium">{a.name}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{a.description}</p>
                    <div className="mt-2.5 flex items-center gap-1.5">
                      {a.modelIds.map((id) => (
                        <ModelIcon key={id} model={getModel(id)} className="size-5 rounded-[3px]" />
                      ))}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {a.modelIds.length} models
                      </span>
                      <Button variant="outline" size="sm" className="ml-auto">
                        Configure
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-sm">Arena leaderboard (Elo)</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-6 py-2 font-medium">#</th>
                    <th className="py-2 font-medium">Model</th>
                    <th className="py-2 text-right font-medium">Rating</th>
                    <th className="py-2 text-right font-medium">Won</th>
                    <th className="py-2 text-right font-medium">Lost</th>
                    <th className="px-6 py-2 text-right font-medium">Draws</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((r, i) => (
                    <tr key={r.modelId} className="border-b last:border-0">
                      <td className="px-6 py-2.5 text-muted-foreground">{i + 1}</td>
                      <td className="py-2.5">
                        <span className="flex items-center gap-2">
                          <ModelIcon model={getModel(r.modelId)} className="size-5 rounded-[3px]" />
                          {getModel(r.modelId).name}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${(r.rating / maxRating) * 100}%` }}
                            />
                          </div>
                          <span className="w-10 tabular-nums">{r.rating}</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                        {r.won}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-destructive">{r.lost}</td>
                      <td className="px-6 py-2.5 text-right tabular-nums text-muted-foreground">
                        {r.draws}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'feedback' && (
        <Card className="shadow-none">
          <CardContent className="px-0 py-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">User</th>
                  <th className="py-2.5 font-medium">Model</th>
                  <th className="py-2.5 font-medium">Rating</th>
                  <th className="py-2.5 font-medium">Snippet</th>
                  <th className="px-5 py-2.5 text-right font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {feedback.map((f) => {
                  const u = users.find((x) => x.id === f.userId)
                  return (
                    <tr key={f.id} className="border-b last:border-0" title={formatDateTime(f.timestamp)}>
                      <td className="px-5 py-2.5">{u?.nickname ?? u?.name}</td>
                      <td className="py-2.5">
                        <span className="flex items-center gap-1.5">
                          <ModelIcon model={getModel(f.modelId)} className="size-4 rounded-[2px]" />
                          {getModel(f.modelId).name}
                        </span>
                      </td>
                      <td className="py-2.5">
                        {f.rating === 'up' ? (
                          <Badge variant="secondary" className="text-emerald-600 dark:text-emerald-400">
                            <ThumbsUp />
                            good
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            <ThumbsDown />
                            {f.reason}
                          </Badge>
                        )}
                      </td>
                      <td className="max-w-56 truncate py-2.5 text-muted-foreground">{f.snippet}</td>
                      <td className="px-5 py-2.5 text-right text-muted-foreground">
                        {timeAgo(f.timestamp)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
