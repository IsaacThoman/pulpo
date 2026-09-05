import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { ui } from '@/i18n/ui'

export function DeleteAccountSettings() {
  const user = useAuth((state) => state.user)
  const logout = useAuth((state) => state.logout)
  const navigate = useNavigate()
  const [settings, setSettings] = useState<{ accountDeletionEnabled?: boolean; adminEmail?: string } | null>(null)
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void apiRequest<{ accountDeletionEnabled?: boolean; adminEmail?: string }>('/api/auth/settings')
      .then((value) => { if (active) setSettings(value) })
      .catch(() => { if (active) setError(ui('Could not load account deletion settings.')) })
    return () => { active = false }
  }, [])

  const submit = async () => {
    if (!window.confirm(ui('Permanently delete your account? This cannot be undone.'))) return
    setBusy(true); setError('')
    try {
      await apiRequest('/api/me', { method: 'DELETE', body: { currentPassword: password, verificationCode: code.trim() || undefined } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : ui('Could not delete account.'))
      setBusy(false)
      return
    }
    // Clear local data after durable acceptance, even though the session has already been revoked.
    await logout(true)
    navigate('/login', { replace: true, state: { accountDeletionRequested: true } })
  }

  return <div className="space-y-3 border-t py-4">
    <h3 className="text-sm font-medium">{ui('Delete account')}</h3>
    {!settings && !error && <p className="text-sm text-muted-foreground">{ui('Loading…')}</p>}
    {settings && !settings.accountDeletionEnabled && <p className="text-sm text-muted-foreground">
      {settings.accountDeletionEnabled === false ? ui('Account deletion is disabled by the instance administrator.') : ui('This server does not support account deletion.')}
      {settings.adminEmail && <> <a href={`mailto:${settings.adminEmail}`} className="underline">{settings.adminEmail}</a></>}
    </p>}
    {settings?.accountDeletionEnabled && <>
      {!open ? <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>{ui('Delete account')}</Button> : <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <p className="break-all text-sm">{user?.email} · {useAuth.getState().instanceUrl || window.location.origin}</p>
        <p className="text-sm text-muted-foreground">{ui('Deletion is permanent. Your chats, files, memories, and shared links will be removed. Subscriptions will be canceled and unused credits forfeited, with no automatic refunds. Access ends immediately; background cleanup may take time. Backups and payment records follow existing retention policies.')}</p>
        <Label htmlFor="delete-account-password">{ui('Current password')}</Label>
        <Input id="delete-account-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={busy} />
        <Label htmlFor="delete-account-code">{ui('Authenticator or recovery code (if enabled)')}</Label>
        <Input id="delete-account-code" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} disabled={busy} />
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => { setOpen(false); setPassword(''); setCode(''); setError('') }}>{ui('Cancel')}</Button>
          <Button type="submit" variant="destructive" disabled={busy || !password}>{busy ? ui('Deleting…') : ui('Permanently delete account')}</Button>
        </div>
      </form>}
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
}
