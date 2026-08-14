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
import { queryClient } from '@/lib/query-client'
import { useAuth } from '@/stores/auth'
import {
  normalizeUsername,
  requestUsernameChange,
  usernameChangeValidationError,
} from './username-change'

export function UsernameSettings() {
  const user = useAuth((state) => state.user)
  const replaceUser = useAuth((state) => state.replaceUser)
  const [open, setOpen] = useState(false)
  const [username, setUsername] = useState(user?.username ?? '')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [updated, setUpdated] = useState(false)

  const validationError = user ? usernameChangeValidationError(username, user.username) : 'Account unavailable.'
  const showValidationError = Boolean(
    validationError && normalizeUsername(username) !== user?.username,
  )

  const reset = () => {
    setUsername(user?.username ?? '')
    setError('')
    setLoading(false)
    setUpdated(false)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    reset()
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (validationError) return
    setLoading(true)
    setError('')
    try {
      const result = await requestUsernameChange(username)
      replaceUser(result.user)
      setUpdated(true)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['friends'] }),
        queryClient.invalidateQueries({ queryKey: ['friends-usage'] }),
      ])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update username.')
    } finally {
      setLoading(false)
    }
  }

  return <>
    <div className="flex min-w-0 items-center justify-between gap-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Username</div>
        <div className="mt-0.5 text-xs text-muted-foreground">Friends can find you using @{user?.username}.</div>
      </div>
      <Button variant="outline" size="sm" onClick={() => handleOpenChange(true)}>Change username</Button>
    </div>

    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {updated ? <>
          <div className="flex flex-col items-center gap-3 py-3 text-center">
            <CircleCheck className="size-10 text-emerald-500" aria-hidden />
            <DialogTitle>Username updated</DialogTitle>
            <DialogDescription>Your username is now @{normalizeUsername(username)}.</DialogDescription>
          </div>
          <DialogFooter>
            <Button className="w-full sm:w-auto" onClick={() => handleOpenChange(false)}>Done</Button>
          </DialogFooter>
        </> : <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>Change username</DialogTitle>
            <DialogDescription>Friends can search by your username or display name. Your username must be unique.</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="new-username">New username</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
              <Input
                id="new-username"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(event) => {
                  setUsername(normalizeUsername(event.target.value))
                  setError('')
                }}
                className="pl-7"
                minLength={3}
                maxLength={30}
                pattern="[a-z0-9][a-z0-9_]{1,28}[a-z0-9]"
                title="Use 3–30 letters, numbers, or underscores; begin and end with a letter or number"
                aria-invalid={showValidationError}
                required
              />
            </div>
            {showValidationError
              ? <p className="text-xs text-destructive">{validationError}</p>
              : <p className="text-xs text-muted-foreground">Use 3–30 lowercase letters, numbers, or underscores.</p>}
          </div>

          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={Boolean(validationError) || loading}>
              {loading && <Loader2 className="animate-spin" aria-hidden />}
              Update username
            </Button>
          </DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
  </>
}
