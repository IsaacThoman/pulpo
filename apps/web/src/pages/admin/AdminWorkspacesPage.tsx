import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, AlertTriangle, Clock3, Loader2, MoveHorizontal, Power, RefreshCw, Server, Users } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { formatWorkspaceDeadline, formatWorkspaceDuration, workspaceCount } from '@/lib/admin-workspaces'
import { getCatalogModel } from '@/stores/catalog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

interface WorkspaceRow {
  id: string; controllerLeaseId: string | null; status: string; capacityState: string | null; queuePosition: number | null
  createdAt: string; updatedAt: string; claimedAt: string | null; lastUsedAt: string | null; expiresAt: string | null; hardExpiresAt: string | null; releasedAt: string | null
  error: string | null; imageDigest: string
  user: { id: string; name: string; email: string }; chat: { id: string; title: string }
  response: { id: string | null; modelId: string | null; status: string | null }
  run: { status: string; modelTurns: number; toolCalls: number; startedAt: string | null } | null
}
interface OpenWorkspace {
  id: string; name: string; leaseId: string | null; instanceId: string | null; chatId: string | null; lifecycleState: string; phase: string; ready: boolean; activeOperations: number
  createdAt: string; lastUsedAt: string | null; idleExpiresAt: string | null; hardExpiresAt: string | null; deletionStartedAt: string | null
  imageDigest: string | null; restartCount: number
  user: WorkspaceRow['user'] | null; chat: WorkspaceRow['chat'] | null; response: WorkspaceRow['response'] | null; run: WorkspaceRow['run']
}
interface WorkspaceResult {
  controller: { configured: boolean; healthy: boolean; warmCapacity: number; active: number; detail?: string }
  policy: { warmCapacity: number; maxActiveWorkspaces: number; cpu: string; memory: string; ephemeralStorage: string }
  summary: { ready: number; pending: number; recent: number }; openWorkspaces: OpenWorkspace[]; data: WorkspaceRow[]
}

const stateOrder: Record<string, number> = { active: 0, starting: 1, shutting_down: 2, idle: 3, warming: 4, warm: 5, unknown: 6 }

function stateLabel(state: string): string {
  if (state === 'shutting_down') return 'Shutting down'
  if (state === 'warm') return 'Warm · unclaimed'
  return state.charAt(0).toUpperCase() + state.slice(1).replaceAll('_', ' ')
}

function activityLabel(workspace: OpenWorkspace): string {
  if (workspace.lifecycleState === 'active') return `${workspace.activeOperations} running operation${workspace.activeOperations === 1 ? '' : 's'}`
  if (workspace.lifecycleState === 'idle') return 'No operation running'
  if (workspace.lifecycleState === 'starting') return workspace.user ? 'Starting for user' : 'Cold starting'
  if (workspace.lifecycleState === 'shutting_down') return 'Terminating pod'
  if (workspace.lifecycleState === 'warming') return 'Preparing warm capacity'
  if (workspace.lifecycleState === 'warm') return 'Waiting to be claimed'
  return workspace.phase
}

export function AdminWorkspacesPage() {
  const [now, setNow] = useState(Date.now())
  const [terminateTarget, setTerminateTarget] = useState<OpenWorkspace | null>(null)
  const [terminating, setTerminating] = useState(false)
  const [terminateError, setTerminateError] = useState<string | null>(null)
  const workspaceQuery = useQuery({
    queryKey: ['admin-usage', 'workspaces'],
    queryFn: ({ signal }) => apiRequest<WorkspaceResult>('/api/admin/usage/workspaces', { signal }),
    refetchInterval: 5_000,
  })
  const result = workspaceQuery.data ?? null
  useEffect(() => { const clock = window.setInterval(() => setNow(Date.now()), 1_000); return () => clearInterval(clock) }, [])
  const rows = useMemo(() => result?.data ?? [], [result])
  const openWorkspaces = useMemo(() => [...(result?.openWorkspaces ?? [])].sort((a, b) => (stateOrder[a.lifecycleState] ?? 99) - (stateOrder[b.lifecycleState] ?? 99) || a.createdAt.localeCompare(b.createdAt)), [result])
  const policy = result?.policy
  const loading = workspaceQuery.isLoading && !result
  const controllerStatus = !result ? '—' : !result.controller.configured ? 'Not configured' : result.controller.healthy ? 'Healthy' : 'Unavailable'
  const terminate = async () => {
    if (!terminateTarget) return
    setTerminating(true); setTerminateError(null)
    try {
      const path = terminateTarget.leaseId
        ? `/api/admin/usage/workspaces/${encodeURIComponent(terminateTarget.leaseId)}`
        : `/api/admin/usage/workspaces/orphans/${encodeURIComponent(terminateTarget.name)}`
      await apiRequest(path, { method: 'DELETE' })
      setTerminateTarget(null)
      await workspaceQuery.refetch()
    } catch (error) {
      setTerminateError(error instanceof Error ? error.message : 'Unable to terminate workspace VM')
    } finally {
      setTerminating(false)
    }
  }
  return <div className="space-y-4">
    <div className="flex items-center gap-3"><div><h2 className="text-lg font-semibold">Agent workspaces</h2><p className="text-xs text-muted-foreground">Live leases, owners, queue state, and forced cleanup deadlines.</p></div><div className="flex-1" /><Button variant="outline" size="icon-sm" disabled={workspaceQuery.isFetching} onClick={() => void workspaceQuery.refetch()} aria-label="Refresh workspaces"><RefreshCw className={workspaceQuery.isFetching ? 'animate-spin' : undefined} /></Button></div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Metric icon={<Server />} label="Controller" value={controllerStatus} compactValue loading={loading} />
      <Metric icon={<Activity />} label="Open VMs" value={result ? openWorkspaces.length : '—'} loading={loading} />
      <Metric icon={<Users />} label="Claimed" value={result ? `${result.controller.active} / ${policy?.maxActiveWorkspaces ?? '—'}` : '—'} loading={loading} />
      <Metric icon={<Users />} label="Pending users" value={result?.summary.pending ?? '—'} loading={loading} />
      <Metric icon={<Clock3 />} label="Warm pool" value={result ? `${openWorkspaces.filter((workspace) => ['warm', 'warming'].includes(workspace.lifecycleState)).length} / ${result.controller.warmCapacity ?? policy?.warmCapacity ?? '—'}` : '—'} loading={loading} />
      <Metric icon={<Server />} label="Per workspace" value={policy ? `${policy.cpu} CPU` : '—'} note={policy ? `${policy.memory} memory · ${policy.ephemeralStorage} disk` : undefined} loading={loading} />
    </div>
    {workspaceQuery.error && <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"><AlertTriangle className="size-3.5 shrink-0" /><span className="min-w-0 flex-1">{workspaceQuery.error.message}</span><Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => void workspaceQuery.refetch()}>Retry</Button></div>}
    {!workspaceQuery.error && !result?.controller.healthy && result?.controller.detail && <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{result.controller.detail}</div>}
    <div>
      <h3 className="text-sm font-semibold">Open VMs</h3>
      <p className="mb-2 text-xs text-muted-foreground">Every workspace pod currently present in the cluster, including warm capacity and terminating VMs.</p>
      <Card className="overflow-hidden"><ScrollHint /><div className="max-h-[28rem] overflow-auto overscroll-contain [scrollbar-gutter:stable]"><table className="w-full min-w-[960px] table-fixed text-left text-xs [&_td]:px-2.5 [&_td]:py-2.5 [&_th]:px-2.5 [&_th]:py-2.5">
        <colgroup><col className="w-[9%]" /><col className="w-[11%]" /><col className="w-[14%]" /><col className="w-[12%]" /><col className="w-[8%]" /><col className="w-[13%]" /><col className="w-[9%]" /><col className="w-[10%]" /><col className="w-[8%]" /><col className="w-[6%]" /></colgroup>
        <thead className="sticky top-0 z-10 bg-card text-muted-foreground shadow-[0_1px_0_var(--border)]"><tr><th>State</th><th>Owner</th><th>Chat / model</th><th>VM</th><th>Open for</th><th>Activity</th><th>Idle closes in</th><th>Forced close in</th><th>Health</th><th className="text-right">Actions</th></tr></thead>
        <tbody>{openWorkspaces.length ? openWorkspaces.map((workspace) => {
          const warmPool = ['warm', 'warming'].includes(workspace.lifecycleState)
          return <tr key={workspace.id} className="border-b align-top hover:bg-muted/30">
            <td><Badge variant={workspace.lifecycleState === 'active' ? 'secondary' : workspace.lifecycleState === 'shutting_down' ? 'destructive' : 'outline'}>{stateLabel(workspace.lifecycleState)}</Badge></td>
            <td>{workspace.user ? <><div className="truncate font-medium">{workspace.user.name || workspace.user.email}</div><div className="truncate text-muted-foreground">{workspace.user.email}</div></> : <><span className="text-muted-foreground">{warmPool ? 'Warm pool' : 'Unassigned'}</span>{workspace.instanceId && <div className="truncate font-mono text-[10px] text-muted-foreground" title={workspace.instanceId}>{workspace.instanceId}</div>}</>}</td>
            <td>{workspace.chat ? <><div className="truncate">{workspace.chat.title}</div><div className="truncate text-muted-foreground">{workspace.response?.modelId ? getCatalogModel(workspace.response.modelId).name : 'Waiting for workspace'}</div></> : '—'}</td>
            <td className="font-mono text-[11px]"><div className="truncate" title={workspace.name}>{workspace.name}</div><div className="truncate text-muted-foreground" title={workspace.imageDigest ?? undefined}>{workspace.imageDigest?.split('@')[1]?.slice(0, 15) ?? workspace.leaseId?.slice(0, 12) ?? '—'}</div></td>
            <td className="tabular-nums">{formatWorkspaceDuration(now - new Date(workspace.createdAt).getTime())}</td>
            <td><span>{activityLabel(workspace)}</span>{workspace.run && <div className="text-muted-foreground">{workspaceCount(workspace.run.modelTurns, 'turn')} · {workspaceCount(workspace.run.toolCalls, 'tool')}</div>}</td>
            <td className="tabular-nums">{formatWorkspaceDeadline(workspace.idleExpiresAt, now)}</td>
            <td className="tabular-nums">{formatWorkspaceDeadline(workspace.hardExpiresAt, now)}</td>
            <td><span className={workspace.ready ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}>{workspace.ready ? 'Ready' : workspace.phase}</span>{workspace.restartCount > 0 && <div className="text-amber-600">{workspace.restartCount} restarts</div>}</td>
            <td className="text-right">{((workspace.leaseId && ['active', 'idle', 'starting'].includes(workspace.lifecycleState)) || (!workspace.leaseId && ['starting', 'unknown'].includes(workspace.lifecycleState))) ? <Button size="icon-sm" variant="ghost" className="hover:text-destructive" title={workspace.leaseId ? 'Terminate VM' : 'Delete orphan VM'} aria-label={`${workspace.leaseId ? 'Terminate' : 'Delete orphan'} ${workspace.name}`} onClick={() => { setTerminateError(null); setTerminateTarget(workspace) }}><Power /></Button> : <span className="text-muted-foreground">—</span>}</td>
          </tr>
        }) : <tr><td colSpan={10} className="h-24 text-center text-muted-foreground">{loading ? 'Loading VM inventory…' : workspaceQuery.error ? 'Workspace inventory unavailable.' : 'No open workspace VMs.'}</td></tr>}</tbody>
      </table></div></Card>
    </div>
    <div>
      <h3 className="text-sm font-semibold">Lease history</h3>
      <p className="mb-2 text-xs text-muted-foreground">Recent user workspace requests, including queued, released, expired, and failed leases.</p>
    <Card className="overflow-hidden"><ScrollHint /><div className="max-h-[min(60vh,42rem)] overflow-auto overscroll-contain [scrollbar-gutter:stable]"><table className="w-full min-w-[960px] table-fixed text-left text-xs [&_td]:px-2.5 [&_td]:py-2.5 [&_th]:px-2.5 [&_th]:py-2.5">
      <colgroup><col className="w-[9%]" /><col className="w-[14%]" /><col className="w-[18%]" /><col className="w-[13%]" /><col className="w-[9%]" /><col className="w-[10%]" /><col className="w-[10%]" /><col className="w-[9%]" /><col className="w-[8%]" /></colgroup>
      <thead className="sticky top-0 z-10 bg-card text-muted-foreground shadow-[0_1px_0_var(--border)]"><tr><th>State</th><th>Owner</th><th>Chat / model</th><th>Workspace</th><th>Active for</th><th>Idle closes in</th><th>Forced close in</th><th>Activity</th><th>Last use</th></tr></thead>
      <tbody>{rows.length ? rows.map((row) => {
        const activeSince = row.claimedAt ?? row.createdAt
        const live = ['ready', 'provisioning'].includes(row.status)
        return <tr key={row.id} className="border-b align-top hover:bg-muted/30">
          <td><Badge variant={row.status === 'failed' ? 'destructive' : live ? 'secondary' : 'outline'}>{stateLabel(row.status)}</Badge>{row.queuePosition && <div className="mt-1 text-muted-foreground">Queue #{row.queuePosition}</div>}{row.capacityState && <div className="text-muted-foreground">{stateLabel(row.capacityState)}</div>}</td>
          <td><div className="truncate font-medium">{row.user.name || row.user.email}</div><div className="truncate text-muted-foreground">{row.user.email}</div></td>
          <td><div className="truncate">{row.chat.title}</div><div className="truncate text-muted-foreground">{row.response.modelId ? getCatalogModel(row.response.modelId).name : 'Waiting for workspace'}</div></td>
          <td className="font-mono text-[11px]"><div className="truncate" title={row.controllerLeaseId ?? row.id}>{row.controllerLeaseId?.slice(0, 12) ?? row.id.slice(0, 12)}</div><div className="truncate text-muted-foreground" title={row.imageDigest}>{row.imageDigest.split('@')[1]?.slice(0, 15) ?? '—'}</div></td>
          <td className="tabular-nums">{live ? formatWorkspaceDuration(now - new Date(activeSince).getTime()) : formatWorkspaceDuration(new Date(row.releasedAt ?? row.updatedAt ?? row.createdAt).getTime() - new Date(activeSince).getTime())}</td>
          <td className="tabular-nums">{live ? formatWorkspaceDeadline(row.expiresAt, now) : '—'}</td>
          <td className="tabular-nums">{live ? formatWorkspaceDeadline(row.hardExpiresAt, now) : '—'}</td>
          <td>{row.run ? <><span>{workspaceCount(row.run.modelTurns, 'turn')}</span><div className="text-muted-foreground">{workspaceCount(row.run.toolCalls, 'tool')} · {stateLabel(row.run.status)}</div></> : '—'}</td>
          <td>{row.lastUsedAt ? <><div className="whitespace-nowrap tabular-nums">{new Date(row.lastUsedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</div><div className="whitespace-nowrap text-muted-foreground tabular-nums">{new Date(row.lastUsedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div></> : '—'}{row.error && <div className="truncate text-destructive" title={row.error}>{row.error}</div>}</td>
        </tr>
      }) : <tr><td colSpan={9} className="h-24 text-center text-muted-foreground">{loading ? 'Loading lease history…' : workspaceQuery.error ? 'Lease history unavailable.' : 'No workspace leases yet.'}</td></tr>}</tbody>
    </table></div></Card>
    </div>
    <Dialog open={!!terminateTarget} onOpenChange={(open) => { if (!open && !terminating) { setTerminateTarget(null); setTerminateError(null) } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{terminateTarget?.leaseId ? 'Terminate workspace VM?' : 'Delete orphan workspace VM?'}</DialogTitle>
          <DialogDescription>{terminateTarget?.leaseId ? 'This immediately stops the VM and any running operation. The user can receive a new workspace if they use agent tools again.' : 'This VM has no active lease or owner. Deleting it immediately removes the abandoned workspace pod.'}</DialogDescription>
        </DialogHeader>
        {terminateTarget && <div className="min-w-0 rounded-md border bg-muted/30 p-3 text-xs"><div className="truncate font-medium">{terminateTarget.user?.name || terminateTarget.user?.email || 'Unassigned workspace'}</div><div className="mt-1 break-words text-muted-foreground">{terminateTarget.chat?.title ?? 'No chat'} · <span className="font-mono">{terminateTarget.name}</span></div></div>}
        {terminateError && <div className="whitespace-pre-wrap break-words rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{terminateError}</div>}
        <DialogFooter>
          <Button variant="outline" disabled={terminating} onClick={() => { setTerminateTarget(null); setTerminateError(null) }}>Cancel</Button>
          <Button variant="destructive" disabled={terminating} onClick={() => void terminate()}>{terminating ? <Loader2 className="animate-spin" /> : <Power />}{terminating ? (terminateTarget?.leaseId ? 'Terminating…' : 'Deleting…') : (terminateTarget?.leaseId ? 'Terminate VM' : 'Delete orphan VM')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}

function ScrollHint() { return <div className="flex items-center gap-1.5 border-b px-3 py-1.5 text-[10px] text-muted-foreground xl:hidden"><MoveHorizontal className="size-3" />Scroll horizontally to view all columns</div> }

function Metric({ icon, label, value, note, compactValue, loading }: { icon: React.ReactNode; label: string; value: React.ReactNode; note?: string; compactValue?: boolean; loading?: boolean }) {
  return <Card><CardContent className="p-3"><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="[&>svg]:size-3.5">{icon}</span>{label}</div>{loading ? <Skeleton className="mt-2 h-7 w-2/3" /> : <><div className={`mt-2 truncate font-semibold tabular-nums ${compactValue ? 'text-base' : 'text-lg'}`} title={typeof value === 'string' ? value : undefined}>{value}</div>{note && <div className="mt-0.5 break-words text-[10px] leading-4 text-muted-foreground" title={note}>{note}</div>}</>}</CardContent></Card>
}
