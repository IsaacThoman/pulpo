import { useState, type FormEvent } from 'react'
import { CircleCheck, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  passwordChangeValidationError,
  requestPasswordChange,
  type PasswordChangeValues,
} from './password-change'

const EMPTY_VALUES: PasswordChangeValues = {
  currentPassword: '',
  newPassword: '',
  confirmation: '',
}

export function PasswordSettings() {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<PasswordChangeValues>(EMPTY_VALUES)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [updated, setUpdated] = useState(false)

  const validationError = passwordChangeValidationError(values)

  const reset = () => {
    setValues(EMPTY_VALUES)
    setError('')
    setLoading(false)
    setUpdated(false)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) reset()
  }

  const updateValue = (key: keyof PasswordChangeValues, value: string) => {
    setValues((current) => ({ ...current, [key]: value }))
    setError('')
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (validationError) return

    setLoading(true)
    setError('')
    try {
      await requestPasswordChange(values.currentPassword, values.newPassword)
      setValues(EMPTY_VALUES)
      setUpdated(true)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not update password.')
    } finally {
      setLoading(false)
    }
  }

  const confirmationMismatch = Boolean(values.confirmation && values.confirmation !== values.newPassword)
  const unchangedPassword = Boolean(values.newPassword && values.newPassword === values.currentPassword)

  return <>
    <div className="flex min-w-0 flex-col items-start gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Password</div>
        <div className="mt-0.5 text-xs text-muted-foreground">Update the password used to sign in to your account.</div>
      </div>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Change password</Button>
    </div>

    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {updated ? <>
          <div className="flex flex-col items-center gap-3 py-3 text-center">
            <CircleCheck className="size-10 text-emerald-500" aria-hidden />
            <DialogTitle>Password updated</DialogTitle>
            <DialogDescription>Your new password is ready to use. Other signed-in devices remain active.</DialogDescription>
          </div>
          <DialogFooter>
            <Button className="w-full sm:w-auto" onClick={() => handleOpenChange(false)}>Done</Button>
          </DialogFooter>
        </> : <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>Use at least 8 characters. Other signed-in devices will remain active.</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={values.currentPassword}
              onChange={(event) => updateValue('currentPassword', event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              aria-invalid={unchangedPassword}
              value={values.newPassword}
              onChange={(event) => updateValue('newPassword', event.target.value)}
              required
            />
            {unchangedPassword && <p className="text-xs text-destructive">New password must be different from the current password.</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-new-password">Confirm new password</Label>
            <Input
              id="confirm-new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              aria-invalid={confirmationMismatch}
              value={values.confirmation}
              onChange={(event) => updateValue('confirmation', event.target.value)}
              required
            />
            {confirmationMismatch && <p className="text-xs text-destructive">New passwords do not match.</p>}
          </div>

          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={Boolean(validationError) || loading}>
              {loading && <Loader2 className="animate-spin" aria-hidden />}
              Update password
            </Button>
          </DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
  </>
}
