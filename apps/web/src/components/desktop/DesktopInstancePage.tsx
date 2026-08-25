import { useEffect, useState } from 'react'
import { Globe2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/stores/auth'
import { ui } from '@/i18n/ui'

export function DesktopInstancePage() {
  const currentUrl = useAuth((state) => state.instanceUrl)
  const currentError = useAuth((state) => state.instanceError)
  const switchInstance = useAuth((state) => state.switchInstance)
  const checking = useAuth((state) => state.checkingSession)
  const [value, setValue] = useState(currentUrl)
  const [error, setError] = useState(currentError)

  useEffect(() => setError(currentError), [currentError])

  const connect = async () => {
    setError('')
    try {
      await switchInstance(value.trim())
    } catch (next) {
      setError(next instanceof Error ? next.message : 'Could not connect to this Pulpo instance.')
    }
  }

  return (
    <div className="grid h-full place-items-center bg-background px-6">
      <main className="w-full max-w-md rounded-2xl border bg-card p-7 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <img src="/pulpo-smiley.png" alt="" className="size-11" />
          <div>
            <h1 className="text-xl font-semibold">{ui("Connect to Pulpo")}</h1>
            <p className="text-sm text-muted-foreground">{ui("Use pulpo.baby or your own Pulpo server.")}</p>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="desktop-instance">{ui("Instance address")}</Label>
          <div className="relative">
            <Globe2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="desktop-instance"
              className="pl-9"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://pulpo.baby"
              value={value}
              onChange={(event) => { setValue(event.target.value); setError('') }}
              onKeyDown={(event) => { if (event.key === 'Enter' && value.trim()) void connect() }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{ui("Production instances must use HTTPS.")}</p>
        </div>
        {error && <p className="mt-4 text-sm text-destructive" role="alert">{error}</p>}
        <Button className="mt-6 w-full" size="lg" disabled={!value.trim() || checking} onClick={() => void connect()}>
          {checking && <Loader2 className="animate-spin" />}{ui("Connect")} </Button>
      </main>
    </div>
  )
}
