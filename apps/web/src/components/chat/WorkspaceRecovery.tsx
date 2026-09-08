import { ui } from '@/i18n/ui'
import { useChat } from '@/stores/chat'
import { useState, useEffect } from 'react'
import type { WorkspaceSelection, WorkspaceWait, ResponseSnapshot } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { WorkspacePicker } from './WorkspacePicker'

export function WorkspaceRecovery({ responseId, wait }: { responseId: string; wait: WorkspaceWait }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const [target, setTarget] = useState<WorkspaceSelection>({ kind: 'pulpo' })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<'switch' | 'none' | null>(null)
  const recover = async (action: 'wait' | 'switch' | 'none', acknowledged = false) => {
    if (action !== 'wait' && wait.mayHaveStarted && !acknowledged) { setConfirm(action); return }
    setPending(true); setError('')
    try {
      const snapshot = await apiRequest<ResponseSnapshot>(`/api/responses/${responseId}/workspace-recovery`, { method: 'POST', body: { generation: wait.generation, action, workspace: target, acknowledgeUnknown: acknowledged } })
      useChat.getState().applyResponseSnapshot(snapshot)
      setConfirm(null)
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not recover workspace') }
    finally { setPending(false) }
  }
  if (wait.reason === 'capacity' && now < Date.parse(wait.startedAt) + 15_000) return null
  return <div role="status" className="my-3 space-y-2 rounded-lg border p-3 text-sm">
    <p>{wait.reason === 'capacity' ? ui('Waiting for workspace capacity.') : ui('The workspace has not responded for 30 seconds.')}</p>
    {confirm ? <><p>{ui('The old command may still run. Local files will stay on that computer. Pulpo will continue without replaying the command.')}</p><Button size="sm" variant="outline" disabled={pending} onClick={() => void recover(confirm, true)}>{confirm === 'switch' ? ui('Confirm switch') : ui('Confirm continue without workspace')}</Button><Button size="sm" variant="outline" className="ml-3" onClick={() => setConfirm(null)}>{ui('Cancel')}</Button></> : <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => void recover('wait')}>{ui('Keep waiting')}</Button>
      <WorkspacePicker value={target} onChange={setTarget} disabled={pending} />
      <Button size="sm" variant="outline" disabled={pending} onClick={() => void recover('switch')}>{ui('Switch workspace')}</Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => void recover('none')}>{ui('Continue without workspace')}</Button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </div>
}
