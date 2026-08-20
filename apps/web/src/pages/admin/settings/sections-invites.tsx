import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AdminInviteCode } from '@pulpo/contracts'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SaveBar, Section, Toggle } from '@/components/admin/kit'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { formatDate } from '@/lib/format'

interface AdminSettings { values: Record<string, unknown> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function inviteStatus(code: AdminInviteCode): 'unused' | 'redeemed' | 'revoked' {
  if (code.revokedAt) return 'revoked'
  if (code.redeemedByUserId) return 'redeemed'
  return 'unused'
}

export function InviteCodesSection() {
  const [enabled, setEnabled] = useState(false)
  const [auth, setAuth] = useState<Record<string, unknown> | null>(null)
  const [count, setCount] = useState(1)
  const [generating, setGenerating] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const listQuery = useQuery({
    queryKey: ['admin-invite-codes'],
    queryFn: () => apiRequest<{ data: AdminInviteCode[] }>('/api/admin/invite-codes'),
  })

  useEffect(() => {
    void apiRequest<AdminSettings>('/api/admin/settings').then((result) => {
      const stored = result.values.auth
      if (!isRecord(stored)) return
      setAuth(stored)
      setEnabled(stored.inviteCodesEnabled === true)
    })
  }, [])

  const generate = async () => {
    setGenerating(true)
    try {
      await apiRequest('/api/admin/invite-codes', { method: 'POST', body: { count } })
      await listQuery.refetch()
    } finally {
      setGenerating(false)
    }
  }

  const revoke = async (id: string) => {
    await apiRequest(`/api/admin/invite-codes/${id}`, { method: 'DELETE' })
    await listQuery.refetch()
  }

  const copy = async (code: AdminInviteCode) => {
    await navigator.clipboard.writeText(code.code)
    setCopiedId(code.id)
    window.setTimeout(() => setCopiedId((current) => current === code.id ? null : current), 1_500)
  }

  const codes = listQuery.data?.data.filter((code) => !code.revokedAt) ?? []

  return (
    <div>
      <Section title="Invite codes" hint="Pending users can redeem a code to gain access. Only available when billing is enabled.">
        <Toggle
          label="Enable invite codes"
          hint="Lets pending users redeem a code and lets granted users generate codes to share."
          checked={enabled}
          onChange={setEnabled}
        />
      </Section>

      <Section title="Pool codes" hint="Unassigned codes anyone with the value can redeem once.">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">Generate codes</div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={50}
              className="h-8 w-16"
              value={count}
              onChange={(event) => setCount(Math.min(50, Math.max(1, Number(event.target.value) || 1)))}
            />
            <Button size="sm" disabled={generating} onClick={() => void generate()}>
              <Plus />
              {generating ? 'Generating…' : 'Generate'}
            </Button>
          </div>
        </div>
      </Section>

      <div className="mb-7 overflow-x-auto rounded-lg border">
        <table className="data-table">
          <thead className="border-b">
            <tr>
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Redeemed by</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading codes…</td></tr>
            ) : codes.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No invite codes yet.</td></tr>
            ) : codes.map((code) => {
              const status = inviteStatus(code)
              return (
                <tr key={code.id}>
                  <td className="px-3 py-2 font-mono tracking-wider">{code.code}</td>
                  <td className="px-3 py-2 text-muted-foreground">{code.ownerUsername ? `@${code.ownerUsername}` : 'Pool'}</td>
                  <td className="px-3 py-2 capitalize text-muted-foreground">{status}</td>
                  <td className="px-3 py-2 text-muted-foreground">{code.redeemedByUsername ? `@${code.redeemedByUsername}` : '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(Date.parse(code.createdAt))}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button size="icon-sm" variant="ghost" title={copiedId === code.id ? 'Copied' : 'Copy'} onClick={() => void copy(code)}>
                        <Copy className="size-3.5" />
                      </Button>
                      {status === 'unused' && (
                        <Button size="icon-sm" variant="ghost" title="Revoke" className="text-destructive hover:text-destructive" onClick={() => void revoke(code.id)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <SaveBar onSave={async () => {
        const result = await apiRequest<AdminSettings>('/api/admin/settings')
        const stored = isRecord(result.values.auth) ? result.values.auth : auth ?? {}
        await apiRequest('/api/admin/settings', { method: 'PATCH', body: { auth: { ...stored, inviteCodesEnabled: enabled } } })
        setAuth({ ...stored, inviteCodesEnabled: enabled })
        useAuth.setState({ inviteCodesEnabled: enabled })
      }} />
    </div>
  )
}
