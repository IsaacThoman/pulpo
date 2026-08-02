import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Clock3, RefreshCw, Server, Users } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface WorkspaceRow {
  id: string; controllerLeaseId: string | null; status: string; capacityState: string | null; queuePosition: number | null
  createdAt: string; updatedAt: string; claimedAt: string | null; lastUsedAt: string | null; expiresAt: string | null; hardExpiresAt: string | null; releasedAt: string | null
  error: string | null; imageDigest: string
  user: { id: string; name: string; email: string }; chat: { id: string; title: string }
  response: { id: string | null; modelId: string | null; status: string | null }
  run: { status: string; modelTurns: number; toolCalls: number; startedAt: string | null } | null
}
interface WorkspaceResult {
  controller: { configured: boolean; healthy: boolean; warmCapacity: number; active: number; detail?: string }
  policy: { warmCapacity: number; maxActiveWorkspaces: number; cpu: string; memory: string; ephemeralStorage: string }
  summary: { ready: number; pending: number; recent: number }; data: WorkspaceRow[]
}

function duration(milliseconds: number): string {
  if (milliseconds <= 0) return 'now'
  const seconds = Math.floor(milliseconds / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function remaining(value: string | null, now: number): string {
  return value ? duration(new Date(value).getTime() - now) : '—'
}

export function AdminWorkspacesPage() {
  const [result, setResult] = useState<WorkspaceResult | null>(null)
  const [now, setNow] = useState(Date.now())
  const load = useCallback(async () => setResult(await apiRequest<WorkspaceResult>('/api/admin/usage/workspaces')), [])
  useEffect(() => { void load(); const refresh = window.setInterval(() => void load(), 2_000); const clock = window.setInterval(() => setNow(Date.now()), 1_000); return () => { clearInterval(refresh); clearInterval(clock) } }, [load])
  const rows = useMemo(() => result?.data ?? [], [result])
  const policy = result?.policy
  return <div className="space-y-4">
    <div className="flex items-center gap-3"><div><h2 className="text-lg font-semibold">Agent workspaces</h2><p className="text-xs text-muted-foreground">Live leases, owners, queue state, and forced cleanup deadlines.</p></div><div className="flex-1" /><Button variant="outline" size="icon-sm" onClick={() => void load()} aria-label="Refresh workspaces"><RefreshCw /></Button></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Metric icon={<Server />} label="Controller" value={result?.controller.healthy ? 'Healthy' : 'Unavailable'} />
      <Metric icon={<Activity />} label="Active" value={`${result?.controller.active ?? 0} / ${policy?.maxActiveWorkspaces ?? '—'}`} />
      <Metric icon={<Users />} label="Pending users" value={result?.summary.pending ?? 0} />
      <Metric icon={<Clock3 />} label="Warm capacity" value={result?.controller.warmCapacity ?? policy?.warmCapacity ?? '—'} />
      <Metric icon={<Server />} label="Per workspace" value={policy ? `${policy.cpu} CPU · ${policy.memory} · ${policy.ephemeralStorage}` : '—'} />
    </div>
    {!result?.controller.healthy && result?.controller.detail && <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{result.controller.detail}</div>}
    <Card><div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-left text-xs">
      <thead className="text-muted-foreground"><tr className="border-b"><th className="p-3">State</th><th>Owner</th><th>Chat / model</th><th>Workspace</th><th>Active for</th><th>Idle closes in</th><th>Forced close in</th><th>Activity</th><th>Last use</th></tr></thead>
      <tbody>{rows.length ? rows.map((row) => {
        const activeSince = row.claimedAt ?? row.createdAt
        const live = ['ready', 'provisioning'].includes(row.status)
        return <tr key={row.id} className="border-b align-top hover:bg-muted/30">
          <td className="p-3"><Badge variant={row.status === 'failed' ? 'destructive' : live ? 'secondary' : 'outline'}>{row.status}</Badge>{row.queuePosition && <div className="mt-1 text-muted-foreground">Queue #{row.queuePosition}</div>}{row.capacityState && <div className="text-muted-foreground">{row.capacityState}</div>}</td>
          <td className="max-w-40"><div className="truncate font-medium">{row.user.name || row.user.email}</div><div className="truncate text-muted-foreground">{row.user.email}</div></td>
          <td className="max-w-48"><div className="truncate">{row.chat.title}</div><div className="truncate text-muted-foreground">{row.response.modelId ?? 'Waiting for workspace'}</div></td>
          <td className="max-w-40 font-mono text-[11px]"><div className="truncate" title={row.controllerLeaseId ?? row.id}>{row.controllerLeaseId?.slice(0, 12) ?? row.id.slice(0, 12)}</div><div className="truncate text-muted-foreground" title={row.imageDigest}>{row.imageDigest.split('@')[1]?.slice(0, 15) ?? '—'}</div></td>
          <td className="tabular-nums">{live ? duration(now - new Date(activeSince).getTime()) : duration(new Date(row.releasedAt ?? row.updatedAt ?? row.createdAt).getTime() - new Date(activeSince).getTime())}</td>
          <td className="tabular-nums">{live ? remaining(row.expiresAt, now) : '—'}</td>
          <td className="tabular-nums">{live ? remaining(row.hardExpiresAt, now) : '—'}</td>
          <td>{row.run ? <><span>{row.run.modelTurns} turns</span><div className="text-muted-foreground">{row.run.toolCalls} tools · {row.run.status}</div></> : '—'}</td>
          <td className="whitespace-nowrap">{row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleTimeString() : '—'}{row.error && <div className="max-w-44 truncate text-destructive" title={row.error}>{row.error}</div>}</td>
        </tr>
      }) : <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">No workspace leases yet.</td></tr>}</tbody>
    </table></div></Card>
  </div>
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) { return <Card><CardContent className="p-3"><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="[&>svg]:size-3.5">{icon}</span>{label}</div><div className="mt-2 truncate text-lg font-semibold tabular-nums">{value}</div></CardContent></Card> }
