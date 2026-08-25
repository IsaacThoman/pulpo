import { useEffect, useState } from 'react'
import { Check, Copy, Download, Loader2, RefreshCw, ShieldOff } from 'lucide-react'
import type { TwoFactorEnrollment, TwoFactorRecoveryCodes, TwoFactorStatus } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ui, uit } from '@/i18n/ui'

type Action = 'setup' | 'regenerate' | 'disable' | null

export function TwoFactorSettings() {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null)
  const [action, setAction] = useState<Action>(null)
  const [enrollment, setEnrollment] = useState<TwoFactorEnrollment | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [currentPassword, setCurrentPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [confirmationCode, setConfirmationCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const refresh = () => apiRequest<TwoFactorStatus>('/api/me/two-factor').then(setStatus)
  useEffect(() => { void refresh() }, [])

  const close = () => {
    setAction(null); setEnrollment(null); setRecoveryCodes([]); setCurrentPassword('')
    setVerificationCode(''); setConfirmationCode(''); setError(''); setCopied(false)
  }

  const begin = async () => {
    setLoading(true); setError('')
    try {
      setEnrollment(await apiRequest<TwoFactorEnrollment>('/api/me/two-factor/enrollment', {
        method: 'POST', body: { currentPassword, verificationCode: status?.enabled ? verificationCode : undefined },
      }))
      setVerificationCode('')
    } catch (next) { setError(next instanceof Error ? next.message : 'Could not start setup.') }
    finally { setLoading(false) }
  }

  const confirm = async () => {
    setLoading(true); setError('')
    try {
      const result = await apiRequest<TwoFactorRecoveryCodes>('/api/me/two-factor/enrollment/confirm', {
        method: 'POST', body: { code: confirmationCode },
      })
      setRecoveryCodes(result.recoveryCodes); setEnrollment(null); await refresh()
    } catch (next) { setError(next instanceof Error ? next.message : 'Could not confirm setup.') }
    finally { setLoading(false) }
  }

  const change = async () => {
    if (!action || action === 'setup') return
    setLoading(true); setError('')
    try {
      if (action === 'regenerate') {
        const result = await apiRequest<TwoFactorRecoveryCodes>('/api/me/two-factor/recovery-codes', {
          method: 'POST', body: { currentPassword, verificationCode },
        })
        setRecoveryCodes(result.recoveryCodes)
      } else {
        await apiRequest('/api/me/two-factor', { method: 'DELETE', body: { currentPassword, verificationCode } })
        close()
      }
      await refresh()
    } catch (next) { setError(next instanceof Error ? next.message : 'Could not update two-factor authentication.') }
    finally { setLoading(false) }
  }

  const recoveryText = recoveryCodes.join('\n')
  const copyRecoveryCodes = async () => {
    await navigator.clipboard.writeText(recoveryText); setCopied(true)
  }
  const downloadRecoveryCodes = () => {
    const url = URL.createObjectURL(new Blob([`Pulpo recovery codes\n\n${recoveryText}\n`], { type: 'text/plain' }))
    const link = document.createElement('a'); link.href = url; link.download = 'pulpo-recovery-codes.txt'; link.click()
    URL.revokeObjectURL(url)
  }

  return <>
    <div className="flex min-w-0 flex-col items-start gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{ui("Two-factor authentication")}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {status === null ? ui("Checking status…") : status.enabled ? uit`Enabled · ${status.recoveryCodesRemaining} recovery codes remaining` : ui("Add an authenticator app to protect your account.")}
        </div>
      </div>
      <Button variant="outline" size="sm" disabled={!status} onClick={() => setAction('setup')}>
        {status?.enabled ? ui("Replace") : ui("Set up")}
      </Button>
    </div>
    {status?.enabled && <div className="flex flex-wrap justify-end gap-2 pb-3">
      <Button variant="outline" size="sm" onClick={() => setAction('regenerate')}><RefreshCw />{ui("New recovery codes")}</Button>
      <Button variant="outline" size="sm" onClick={() => setAction('disable')}><ShieldOff />{ui("Disable")}</Button>
    </div>}

    <Dialog open={action !== null} onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="max-w-md">
        <DialogTitle>{action === 'disable' ? ui("Disable two-factor authentication") : action === 'regenerate' ? ui("Generate new recovery codes") : status?.enabled ? ui("Replace authenticator app") : ui("Set up two-factor authentication")}</DialogTitle>

        {recoveryCodes.length > 0 ? <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{ui("Save these codes now. Each can be used once and they will not be shown again.")}</p>
          <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-4 font-mono text-sm">
            {recoveryCodes.map((code) => <div key={code}>{code}</div>)}
          </div>
          <div className="flex gap-2"><Button variant="outline" onClick={() => void copyRecoveryCodes()}>{copied ? <Check /> : <Copy />}{copied ? ui("Copied") : ui("Copy")}</Button><Button variant="outline" onClick={downloadRecoveryCodes}><Download />{ui("Download")}</Button></div>
          <Button className="w-full" onClick={close}>{ui("Done")}</Button>
        </div> : action === 'setup' && enrollment ? <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{ui("Scan this QR code in your authenticator app, or enter the manual key.")}</p>
          <img src={enrollment.qrCodeDataUrl} alt={ui("Authenticator enrollment QR code")} className="mx-auto size-56 rounded-lg border bg-white p-2" />
          <div><Label>{ui("Manual key")}</Label><div className="mt-1 break-all rounded-md border bg-muted/40 p-2 font-mono text-sm">{enrollment.manualKey}</div></div>
          <div className="space-y-2"><Label htmlFor="totp-confirmation">{ui("Six-digit code")}</Label><Input id="totp-confirmation" autoFocus autoComplete="one-time-code" inputMode="numeric" maxLength={6} className="font-mono tracking-widest" value={confirmationCode} onChange={(event) => setConfirmationCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" disabled={confirmationCode.length !== 6 || loading} onClick={() => void confirm()}>{loading && <Loader2 className="animate-spin" />}{ui("Confirm and enable")}</Button>
        </div> : <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{ui("Confirm this security change with your password")}{status?.enabled ? ui(" and current authenticator or recovery code") : ''}.</p>
          <div className="space-y-2"><Label htmlFor="two-factor-password">{ui("Current password")}</Label><Input id="two-factor-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
          {status?.enabled && <div className="space-y-2"><Label htmlFor="two-factor-verification">{ui("Authenticator or recovery code")}</Label><Input id="two-factor-verification" autoComplete="one-time-code" className="font-mono" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.toUpperCase())} /></div>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Separator />
          <Button variant={action === 'disable' ? 'destructive' : 'default'} className="w-full" disabled={!currentPassword || (Boolean(status?.enabled) && verificationCode.length < 6) || loading} onClick={() => void (action === 'setup' ? begin() : change())}>
            {loading && <Loader2 className="animate-spin" />}{action === 'disable' ? ui("Disable two-factor authentication") : action === 'regenerate' ? ui("Generate recovery codes") : ui("Continue")}
          </Button>
        </div>}
      </DialogContent>
    </Dialog>
  </>
}
