import { ui } from '@/i18n/ui'
import { useQuery } from '@tanstack/react-query'
import type { WorkspaceComputer, WorkspaceSelection } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'

export function WorkspacePicker({ value, onChange, disabled = false }: { value: WorkspaceSelection; onChange(value: WorkspaceSelection): void; disabled?: boolean }) {
  const userId = useAuth(state => state.user?.id)
  const { data } = useQuery({ queryKey: ['workspace-computers', userId], queryFn: () => apiRequest<{ computers: WorkspaceComputer[] }>('/api/me/computers'), enabled: !!userId, refetchInterval: 10_000 })
  const choices: Array<{ value: WorkspaceSelection; label: string }> = [
    { value: { kind: 'none' }, label: ui('No workspace') }, { value: { kind: 'pulpo' }, label: 'Pulpo' },
    ...(data?.computers ?? []).flatMap(computer => computer.roots.map(root => ({ value: { kind: 'computer' as const, deviceId: computer.id, rootId: root.id }, label: `${computer.name} · ${root.path} · ${computer.online ? ui('Online') : ui('Offline')}` }))),
  ]
  const selected = JSON.stringify(value)
  if (!choices.some(choice => JSON.stringify(choice.value) === selected)) choices.push({ value, label: ui('Computer unavailable') })
  return <select aria-label={ui('Workspace')} title={ui('Workspace')} className="h-8 max-w-56 rounded-full border bg-background px-2 text-xs" value={selected} disabled={disabled} onChange={event => onChange(JSON.parse(event.target.value) as WorkspaceSelection)}>
    {choices.map(choice => <option key={JSON.stringify(choice.value)} value={JSON.stringify(choice.value)}>{choice.label}</option>)}
  </select>
}
