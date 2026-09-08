import { ui } from '@/i18n/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { WorkspaceComputer } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'

export function ComputerSettings() {
  const userId = useAuth(state => state.user?.id)
  const native = window.pulpoDesktop?.workspace
  const [error, setError] = useState('')
  const hosts = useQuery({ queryKey: ['workspace-computers', userId], queryFn: () => apiRequest<{ computers: WorkspaceComputer[] }>('/api/me/computers'), refetchInterval: 10_000 })
  const status = useQuery({ queryKey: ['local-workspace-host'], queryFn: () => native!.status(), enabled: !!native, refetchInterval: 5000 })
  const toggle = async () => {
    try { setError(''); if (status.data?.enabled) await native?.disable(); else await native?.enable(); await Promise.all([status.refetch(), hosts.refetch()]) }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not change hosting') }
  }
  return <div className="mb-5 space-y-2 rounded-lg border p-3 text-sm"><h3 className="font-semibold">{ui('Computer workspaces')}</h3>
    <p>{ui('Enable hosting in the Pulpo desktop app to use a computer’s files and tools from any of your devices.')}</p>
    {native && <button className="rounded border px-3 py-1" onClick={() => void toggle()}>{status.data?.enabled ? ui('Disable hosting on this computer') : ui('Use this computer as a workspace')}</button>}
    {hosts.data?.computers?.map(computer => <div key={computer.id} className="flex justify-between gap-2"><span>{computer.name} · {computer.online ? ui('Online') : ui('Offline')}<br />{computer.roots.map(root => root.path).join(', ')}</span><button onClick={() => void apiRequest(`/api/me/computers/${computer.id}`, { method: 'DELETE' }).then(() => hosts.refetch()).catch(error => setError(error.message))}>{ui('Disable')}</button></div>)}
    {error && <p role="alert">{error}</p>}
  </div>
}
