import { accountDeletionRequirementsSchema, type AccountDeletionRequirements } from '@pulpo/contracts'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
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
  const [requirements, setRequirements] = useState<AccountDeletionRequirements | null>(null)
  const [checking, setChecking] = useState(false)
  const requirementsRequest = useRef(0)
  useEffect(() => () => { requirementsRequest.current += 1 }, [])
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

  const loadRequirements = async () => {
    const requestId = ++requirementsRequest.current
    setChecking(true); setRequirements(null); setCode('')
    try {
      const [status, availability] = await Promise.all([
        apiRequest('/api/me/deletion'),
        apiRequest<{ accountDeletionEnabled?: boolean; adminEmail?: string }>('/api/auth/settings'),
      ])
      if (requestId !== requirementsRequest.current) return
      setSettings(availability)
      setRequirements(accountDeletionRequirementsSchema.parse(status))
    } catch {
      if (requestId === requirementsRequest.current) setError(ui('Could not load account deletion settings.'))
    } finally { if (requestId === requirementsRequest.current) setChecking(false) }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (busy) return
    setOpen(nextOpen)
    if (nextOpen) { setError(''); void loadRequirements() }
    if (!nextOpen) { requirementsRequest.current += 1; setRequirements(null); setPassword(''); setCode(''); setError('') }
  }

  const submit = async () => {
    if (busy || checking || !requirements || !settings?.accountDeletionEnabled || !password || (requirements.twoFactorEnabled && !code.trim())) return
    setBusy(true); setError('')
    try {
      await apiRequest('/api/me', { method: 'DELETE', body: { currentPassword: password, verificationCode: requirements.twoFactorEnabled ? code.trim() : undefined } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : ui('Could not delete account.'))
      await loadRequirements()
      setBusy(false)
      return
    }
    // Clear local data after durable acceptance, even though the session has already been revoked.
    try {
      await logout(true)
    } catch {
      navigate('/account-deletion', { replace: true, state: { accountDeletionCleanupFailed: true } })
      return
    }
    navigate('/account-deletion', { replace: true })
  }

  return <Dialog open={open} onOpenChange={handleOpenChange}>
    <div className="border-t">
      <div className="flex min-w-0 flex-col items-start gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{ui('Delete account')}</h3>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {!settings && !error && ui('Loading…')}
            {settings?.accountDeletionEnabled && ui('Permanently delete your account and its data.')}
            {settings && !settings.accountDeletionEnabled && <>
              {settings.accountDeletionEnabled === false ? ui('Account deletion is disabled by the instance administrator.') : ui('This server does not support account deletion.')}
              {settings.adminEmail && <> <a href={`mailto:${settings.adminEmail}`} className="underline">{settings.adminEmail}</a></>}
            </>}
          </div>
        </div>
        {settings?.accountDeletionEnabled && <DialogTrigger asChild><Button className="shrink-0" variant="destructive" size="sm">{ui('Delete account')}</Button></DialogTrigger>}
      </div>
      {!open && error && <p role="alert" className="pb-3 text-sm text-destructive">{error}</p>}
    </div>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md" showCloseButton={!busy} onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }} onInteractOutside={(event) => { if (busy) event.preventDefault() }}>
      <DialogTitle>{ui('Permanently delete account')}</DialogTitle>
      <DialogDescription>{ui('Permanently delete your account? This cannot be undone.')}</DialogDescription>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <div className="min-w-0 text-sm"><p className="break-words">{user?.email}</p><p className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{useAuth.getState().instanceUrl || window.location.origin}</p></div>
        <p className="text-sm text-muted-foreground">{ui('Deletion is permanent. Your chats, files, memories, and shared links will be removed. Subscriptions will be canceled and unused credits forfeited, with no automatic refunds. Access ends immediately; background cleanup may take time. Backups and payment records follow existing retention policies.')}</p>
        {checking && <p role="status">{ui('Loading…')}</p>}
        {!checking && !requirements && <Button type="button" variant="outline" onClick={() => { setError(''); void loadRequirements() }}>{ui('Retry')}</Button>}
        {settings && !settings.accountDeletionEnabled && <p>{settings.accountDeletionEnabled === false ? ui('Account deletion is disabled by the instance administrator.') : ui('This server does not support account deletion.')}{settings.adminEmail && <> <a href={`mailto:${settings.adminEmail}`}>{settings.adminEmail}</a></>}</p>}
        {requirements && settings?.accountDeletionEnabled && <><div className="space-y-2">
          <Label htmlFor="delete-account-password">{ui('Current password')}</Label>
          <Input id="delete-account-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={busy} />
        </div>
        {requirements.twoFactorEnabled && <div className="space-y-2">
          <Label htmlFor="delete-account-code">{ui('Authenticator or recovery code')}</Label>
          <Input id="delete-account-code" required autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} disabled={busy} />
        </div>}
        </> }
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Separator />
        <Button className="w-full" type="submit" variant="destructive" disabled={busy || checking || !requirements || !settings?.accountDeletionEnabled || !password || (requirements.twoFactorEnabled && !code.trim())}>{busy ? ui('Deleting…') : ui('Permanently delete account')}</Button>
      </form>
    </DialogContent>
  </Dialog>
}
