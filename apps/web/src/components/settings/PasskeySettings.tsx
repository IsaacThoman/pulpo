import { useEffect, useState } from 'react'
import { KeyRound, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import type { PasskeyCeremony, PasskeyList, PasskeySummary } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { isPasskeyCancellation, passkeyErrorMessage, registerPasskey } from '@/lib/passkeys'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

type SensitiveValues = {
  currentPassword: string
  verificationCode: string
}

const EMPTY_SENSITIVE: SensitiveValues = { currentPassword: '', verificationCode: '' }

function formatPasskeyDate(value: string | null): string {
  if (!value) return 'Never used'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

export function PasskeySettings() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<PasskeyList | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<PasskeySummary | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [sensitive, setSensitive] = useState<SensitiveValues>(EMPTY_SENSITIVE)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const refresh = async () => setData(await apiRequest<PasskeyList>('/api/me/passkeys'))

  useEffect(() => {
    if (!open) return
    setError('')
    void refresh().catch((next) => setError(next instanceof Error ? next.message : 'Could not load passkeys.'))
  }, [open])

  const resetAction = () => {
    setAdding(false)
    setDeleting(null)
    setEditingId(null)
    setName('')
    setSensitive(EMPTY_SENSITIVE)
    setError('')
  }

  const add = async () => {
    setLoading(true)
    setError('')
    try {
      const ceremony = await apiRequest<PasskeyCeremony>('/api/me/passkeys/registration/options', {
        method: 'POST',
        body: {
          name,
          currentPassword: sensitive.currentPassword,
          verificationCode: data?.requiresSecondFactor ? sensitive.verificationCode : undefined,
        },
      })
      const response = await registerPasskey(ceremony)
      await apiRequest('/api/me/passkeys/registration/verify', {
        method: 'POST', body: { ceremonyToken: ceremony.ceremonyToken, response },
      })
      resetAction()
      await refresh()
    } catch (next) {
      if (!isPasskeyCancellation(next)) setError(passkeyErrorMessage(next, 'Could not add passkey.'))
    } finally {
      setLoading(false)
    }
  }

  const rename = async (passkey: PasskeySummary) => {
    setLoading(true)
    setError('')
    try {
      await apiRequest(`/api/me/passkeys/${passkey.id}`, { method: 'PATCH', body: { name } })
      resetAction()
      await refresh()
    } catch (next) {
      setError(next instanceof Error ? next.message : 'Could not rename passkey.')
    } finally {
      setLoading(false)
    }
  }

  const remove = async () => {
    if (!deleting) return
    setLoading(true)
    setError('')
    try {
      await apiRequest(`/api/me/passkeys/${deleting.id}`, {
        method: 'DELETE',
        body: {
          currentPassword: sensitive.currentPassword,
          verificationCode: data?.requiresSecondFactor ? sensitive.verificationCode : undefined,
        },
      })
      resetAction()
      await refresh()
    } catch (next) {
      setError(next instanceof Error ? next.message : 'Could not delete passkey.')
    } finally {
      setLoading(false)
    }
  }

  const updateSensitive = (key: keyof SensitiveValues, value: string) => {
    setSensitive((current) => ({ ...current, [key]: value }))
    setError('')
  }

  const sensitiveReady = sensitive.currentPassword.length > 0
    && (!data?.requiresSecondFactor || sensitive.verificationCode.length >= 6)

  return <>
    <div className="flex min-w-0 flex-col items-start gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Passkeys</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {data ? `${data.passkeys.length} of 10 added · Sign in without a password or authenticator code.` : 'Sign in securely without a password.'}
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Manage</Button>
    </div>

    <Dialog open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) resetAction() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Passkeys</DialogTitle>
          <DialogDescription>Use Face ID, Touch ID, a device PIN, or a security key to sign in.</DialogDescription>
        </DialogHeader>

        {adding ? <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="passkey-name">Passkey name</Label>
            <Input id="passkey-name" autoFocus maxLength={80} placeholder="e.g. MacBook Touch ID" value={name} onChange={(event) => { setName(event.target.value); setError('') }} />
          </div>
          <SensitiveFields values={sensitive} requiresSecondFactor={Boolean(data?.requiresSecondFactor)} onChange={updateSensitive} />
          <p className="text-xs text-muted-foreground">Adding a passkey signs out your other devices. This device stays signed in.</p>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={resetAction}>Cancel</Button>
            <Button disabled={!name.trim() || !sensitiveReady || loading} onClick={() => void add()}>
              {loading && <Loader2 className="animate-spin" />}Add passkey
            </Button>
          </div>
        </div> : deleting ? <div className="space-y-4">
          <p className="text-sm">Delete <strong>{deleting.name}</strong>? You can still sign in with your password or another passkey.</p>
          <SensitiveFields values={sensitive} requiresSecondFactor={Boolean(data?.requiresSecondFactor)} onChange={updateSensitive} />
          <p className="text-xs text-muted-foreground">Deleting a passkey signs out your other devices. This device stays signed in.</p>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={resetAction}>Cancel</Button>
            <Button variant="destructive" disabled={!sensitiveReady || loading} onClick={() => void remove()}>
              {loading && <Loader2 className="animate-spin" />}Delete passkey
            </Button>
          </div>
        </div> : <div className="space-y-4">
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          {!data ? <div className="flex justify-center py-8"><Loader2 className="animate-spin text-muted-foreground" /></div> : data.passkeys.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center">
              <KeyRound className="mx-auto mb-2 size-6 text-muted-foreground" />
              <p className="text-sm font-medium">No passkeys yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Add one to make sign-in faster and phishing-resistant.</p>
            </div>
          ) : <div className="divide-y rounded-lg border px-3">
            {data.passkeys.map((passkey) => <div key={passkey.id} className="py-3">
              {editingId === passkey.id ? <div className="flex items-center gap-2">
                <Input autoFocus maxLength={80} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && name.trim()) void rename(passkey) }} />
                <Button size="sm" disabled={!name.trim() || loading} onClick={() => void rename(passkey)}>Save</Button>
                <Button size="sm" variant="ghost" onClick={resetAction}>Cancel</Button>
              </div> : <div className="flex items-center gap-3">
                <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{passkey.name}</div>
                  <div className="text-xs text-muted-foreground">Added {formatPasskeyDate(passkey.createdAt)} · {passkey.lastUsedAt ? `Last used ${formatPasskeyDate(passkey.lastUsedAt)}` : 'Never used'}</div>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label={`Rename ${passkey.name}`} onClick={() => { resetAction(); setEditingId(passkey.id); setName(passkey.name) }}><Pencil /></Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Delete ${passkey.name}`} onClick={() => { resetAction(); setDeleting(passkey) }}><Trash2 /></Button>
              </div>}
            </div>)}
          </div>}
          <Separator />
          <Button className="w-full" disabled={!data || data.passkeys.length >= 10} onClick={() => { resetAction(); setAdding(true) }}><Plus />Add passkey</Button>
        </div>}
      </DialogContent>
    </Dialog>
  </>
}

function SensitiveFields({
  values,
  requiresSecondFactor,
  onChange,
}: {
  values: SensitiveValues
  requiresSecondFactor: boolean
  onChange: (key: keyof SensitiveValues, value: string) => void
}) {
  return <>
    <div className="space-y-2">
      <Label htmlFor="passkey-current-password">Current password</Label>
      <Input id="passkey-current-password" type="password" autoComplete="current-password" value={values.currentPassword} onChange={(event) => onChange('currentPassword', event.target.value)} />
    </div>
    {requiresSecondFactor && <div className="space-y-2">
      <Label htmlFor="passkey-verification-code">Authenticator or recovery code</Label>
      <Input id="passkey-verification-code" autoComplete="one-time-code" className="font-mono" value={values.verificationCode} onChange={(event) => onChange('verificationCode', event.target.value.toUpperCase())} />
    </div>}
  </>
}
