import { Link } from 'react-router-dom'
import {
  ArrowRight,
  ArrowUpRight,
  Cpu,
  SquareFunction,
  MessagesSquare,
  Users,
} from 'lucide-react'
import { useUsage } from '@/stores/usage'
import { MODELS } from '@/lib/mock'
import { ADMIN_FUNCTIONS } from '@/lib/mock-admin'
import { formatCost, formatNumber } from '@/lib/format'
import { StatCard } from '@/components/usage/StatCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function DashboardPage() {
  const users = useUsage((s) => s.users)
  const records = useUsage((s) => s.records)

  const dayAgo = Date.now() - 86_400_000
  const recent = records.filter((r) => r.timestamp > dayAgo)
  const spend24h = recent.reduce((a, r) => a + r.cost, 0)

  const links = [
    {
      to: '/admin/users',
      icon: Users,
      title: 'Users & groups',
      desc: `${users.length} users, ${users.filter((u) => u.blocked).length} blocked`,
    },
    {
      to: '/admin/models',
      icon: Cpu,
      title: 'Models',
      desc: `${MODELS.filter((m) => m.enabled).length} of ${MODELS.length} enabled`,
    },
    {
      to: '/admin/functions',
      icon: SquareFunction,
      title: 'Functions',
      desc: `${ADMIN_FUNCTIONS.filter((f) => f.enabled).length} of ${ADMIN_FUNCTIONS.length} enabled`,
    },
    {
      to: '/admin/settings',
      icon: MessagesSquare,
      title: 'Instance settings',
      desc: 'Connections, web search, documents, audio',
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">Dashboard</h2>
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          v0.10.2 · healthy
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Messages (24h)" value={formatNumber(recent.length)} sub="+12% vs yesterday" />
        <StatCard label="Tokens (24h)" value={formatNumber(recent.reduce((a, r) => a + r.tokensIn + r.tokensOut, 0))} />
        <StatCard label="Spend (24h)" value={formatCost(spend24h)} />
        <StatCard label="Active users (24h)" value={String(new Set(recent.map((r) => r.userId)).size)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {links.map((l) => (
          <Link key={l.to} to={l.to} className="group">
            <Card className="h-full shadow-none transition-colors group-hover:bg-accent/40">
              <CardContent className="flex items-center gap-4 px-5 py-4">
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                  <l.icon className="size-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{l.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{l.desc}</div>
                </div>
                <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-sm">System</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 px-5 pb-5 text-sm">
          {[
            ['Version', '0.10.2-mock (latest)'],
            ['Usage monitor', 'connected · https://monitor.pulpo.dev'],
            ['Database', 'sqlite · 214 MB'],
            ['Vector storage', 'qdrant · 38,412 vectors'],
            ['Update channel', 'stable'],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between border-b py-2 last:border-0">
              <span className="text-muted-foreground">{k}</span>
              <span className="font-mono text-xs">{v}</span>
            </div>
          ))}
          <button className="mt-2 flex cursor-pointer items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            Check for updates <ArrowUpRight className="size-3.5" />
          </button>
        </CardContent>
      </Card>
    </div>
  )
}
