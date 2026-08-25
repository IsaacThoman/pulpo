import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ui } from '@/i18n/ui'

export type SensitiveRevealCredentials = {
  currentPassword?: string
  verificationCode?: string
}

export function SensitiveRevealDialog({
  open,
  description,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  description: string
  onOpenChange: (open: boolean) => void
  onConfirm: (credentials: SensitiveRevealCredentials) => Promise<void>
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [requiresSecondFactor, setRequiresSecondFactor] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setCurrentPassword('')
    setVerificationCode('')
    setRequiresSecondFactor(null)
    setLoading(false)
    setError('')
    if (!open) return
    let active = true
    void apiRequest<{ enabled: boolean }>('/api/me/two-factor')
      .then((status) => { if (active) setRequiresSecondFactor(status.enabled) })
      .catch((next) => { if (active) setError(next instanceof Error ? next.message : 'Could not check two-factor authentication status.') })
    return () => { active = false }
  }, [open])

  const confirm = async () => {
    setLoading(true)
    setError('')
    try {
      await onConfirm({
        currentPassword: requiresSecondFactor ? undefined : currentPassword,
        verificationCode: requiresSecondFactor ? verificationCode : undefined,
      })
      onOpenChange(false)
    } catch (next) {
      setError(next instanceof Error ? next.message : 'Could not reveal the API key.')
    } finally {
      setLoading(false)
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{ui("Confirm your identity")}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {requiresSecondFactor === false && <div className="space-y-2">
          <Label htmlFor="sensitive-reveal-password">{ui("Current password")}</Label>
          <Input
            id="sensitive-reveal-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={currentPassword}
            onChange={(event) => { setCurrentPassword(event.target.value); setError('') }}
          />
        </div>}
        {requiresSecondFactor && <div className="space-y-2">
          <Label htmlFor="sensitive-reveal-verification">{ui("Authenticator or recovery code")}</Label>
          <Input
            id="sensitive-reveal-verification"
            autoComplete="one-time-code"
            className="font-mono"
            value={verificationCode}
            onChange={(event) => { setVerificationCode(event.target.value.toUpperCase()); setError('') }}
          />
        </div>}
        {requiresSecondFactor === null && !error && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{ui("Checking security requirements…")}</p>
        )}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
          <Button
            disabled={requiresSecondFactor === null
              || (requiresSecondFactor ? verificationCode.length < 6 : !currentPassword)
              || loading}
            onClick={() => void confirm()}
          >
            {loading && <Loader2 className="animate-spin" />} {ui("Reveal API key")} </Button>
        </DialogFooter>
      </div>
    </DialogContent>
  </Dialog>
}
