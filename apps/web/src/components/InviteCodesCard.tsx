import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { InviteCodeList } from '@pulpo/contracts'
import { Check, Copy, Plus, Trash2 } from 'lucide-react'
import { ApiError, apiRequest } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/stores/auth'

export function InviteCodesCard() {
  const enabled = useAuth((state) => state.inviteCodesEnabled)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const query = useQuery({
    queryKey: ['invite-codes'],
    queryFn: () => apiRequest<InviteCodeList>('/api/invite-codes'),
    enabled,
  })

  if (!enabled) return null
  const data = query.data
  if (!data || (data.quota <= 0 && data.codes.length === 0)) return null

  const remaining = Math.max(0, data.quota - data.used)

  const act = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await operation()
      await query.refetch()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to update invite codes.')
    } finally {
      setBusy(false)
    }
  }

  const copy = async (id: string, code: string) => {
    await navigator.clipboard.writeText(code)
    setCopiedId(id)
    window.setTimeout(() => setCopiedId((current) => current === id ? null : current), 1_500)
  }

  return (
    <section className="overflow-hidden rounded-xl border">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-medium">Invite codes</h2>
          <p className="text-xs text-muted-foreground">{remaining} of {data.quota} remaining</p>
        </div>
        <Button size="sm" disabled={busy || remaining <= 0} onClick={() => void act(() => apiRequest('/api/invite-codes', { method: 'POST' }))}>
          <Plus />
          Generate
        </Button>
      </div>
      {error && <p className="px-4 pt-3 text-sm text-destructive">{error}</p>}
      {data.codes.length ? (
        <div className="divide-y">
          {data.codes.map((code) => (
            <div key={code.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="font-mono text-sm tracking-wider">{code.code}</span>
              <div className="flex items-center gap-1">
                <Button size="icon-sm" variant="ghost" title={copiedId === code.id ? 'Copied' : 'Copy'} onClick={() => void copy(code.id, code.code)}>
                  {copiedId === code.id ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                </Button>
                <Button size="icon-sm" variant="ghost" title="Revoke" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => void act(() => apiRequest(`/api/invite-codes/${code.id}`, { method: 'DELETE' }))}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">Generate a code to share access.</div>
      )}
    </section>
  )
}
