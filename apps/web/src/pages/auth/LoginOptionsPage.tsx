import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, KeyRound, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { browserSupportsWebAuthn } from '@/lib/passkeys'
import { useAuth } from '@/stores/auth'

export function LoginOptionsPage() {
  const user = useAuth((state) => state.user)
  const passkeyLogin = useAuth((state) => state.passkeyLogin)
  const setupRequired = useAuth((state) => state.setupRequired)
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const passkeySupported = browserSupportsWebAuthn()

  if (user?.role === 'pending') return <Navigate to="/pending" replace />
  if (user) return <Navigate to="/" replace />
  if (setupRequired) return <Navigate to="/setup" replace />

  const submitPasskey = async () => {
    setError(null)
    setLoading(true)
    const result = await passkeyLogin(false)
    setLoading(false)
    if (!result.ok) {
      if (result.error) setError(result.error)
      return
    }
    const currentUser = useAuth.getState().user
    navigate(currentUser?.role === 'pending' ? '/pending' : '/')
  }

  return (
    <div className="rounded-xl border bg-card p-6 shadow-xs sm:p-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">More login options</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choose another way to sign in to your Pulpo account.</p>
      </div>

      <div className="space-y-3">
        <Button type="button" variant="outline" className="w-full" disabled={!passkeySupported || loading} onClick={() => void submitPasskey()}>
          {loading ? <Loader2 className="animate-spin" /> : <KeyRound />}
          Sign in with a passkey
        </Button>

        {!passkeySupported && <p className="text-center text-xs text-muted-foreground">Passkeys are not supported by this browser.</p>}
        {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

        <Button asChild type="button" variant="ghost" className="w-full">
          <Link to="/login"><ArrowLeft /> Back</Link>
        </Button>
      </div>
    </div>
  )
}
