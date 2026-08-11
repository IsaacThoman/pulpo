import { useMemo, useState } from 'react'
import { KeyRound, Loader2, X } from 'lucide-react'
import type { PasskeyCeremony } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { authenticateWithPasskey, isPasskeyCancellation, passkeyErrorMessage, registerPasskey } from '@/lib/passkeys'
import { Button } from '@/components/ui/button'

type BridgeMode = 'authentication' | 'enrollment'

function bridgeParameters(mode: BridgeMode) {
  if (mode === 'enrollment') {
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    return { token: fragment.get('token') ?? '', state: fragment.get('state') ?? '', codeChallenge: '' }
  }
  const query = new URLSearchParams(window.location.search)
  const validRequest = query.get('code_challenge_method') === 'S256'
    && query.get('redirect_uri') === 'pulpo://auth/passkey'
    && query.get('response_type') === 'code'
  return {
    token: '',
    state: validRequest ? query.get('state') ?? '' : '',
    codeChallenge: validRequest ? query.get('code_challenge') ?? '' : '',
  }
}

export function MobilePasskeyPage({ mode = 'authentication' }: { mode?: BridgeMode }) {
  const params = useMemo(() => bridgeParameters(mode), [mode])
  const [status, setStatus] = useState<'ready' | 'working' | 'cancelled' | 'error'>('ready')
  const [error, setError] = useState('')
  const enrollment = mode === 'enrollment'
  const valid = params.state.length >= 32
    && (enrollment ? params.token.length >= 32 : /^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge))

  const continueWithPasskey = async () => {
    if (!valid) return
    setStatus('working')
    setError('')
    try {
      if (enrollment) {
        const ceremony = await apiRequest<PasskeyCeremony>('/api/auth/passkey/browser-registration/options', {
          method: 'POST', body: { ceremonyToken: params.token },
        })
        const response = await registerPasskey(ceremony)
        const result = await apiRequest<{ redirectUrl: string }>('/api/auth/passkey/browser-registration/verify', {
          method: 'POST', body: { ceremonyToken: ceremony.ceremonyToken, response },
        })
        const redirect = new URL(result.redirectUrl)
        if (redirect.protocol !== 'pulpo:' || redirect.host !== 'auth' || redirect.pathname !== '/passkey-enrollment' || redirect.searchParams.get('state') !== params.state) throw new Error('The passkey callback was invalid.')
        window.location.assign(redirect.toString())
        return
      }

      const ceremony = await apiRequest<PasskeyCeremony>('/api/mobile/auth/passkey/browser/options', {
        method: 'POST', body: { state: params.state, codeChallenge: params.codeChallenge },
      })
      const response = await authenticateWithPasskey(ceremony)
      const result = await apiRequest<{ redirectUrl: string }>('/api/mobile/auth/passkey/browser/verify', {
        method: 'POST', body: { ceremonyToken: ceremony.ceremonyToken, response },
      })
      const redirect = new URL(result.redirectUrl)
      if (redirect.protocol !== 'pulpo:' || redirect.host !== 'auth' || redirect.pathname !== '/passkey' || redirect.searchParams.get('state') !== params.state || !redirect.searchParams.get('code')) throw new Error('The passkey callback was invalid.')
      window.location.assign(redirect.toString())
    } catch (next) {
      if (isPasskeyCancellation(next)) {
        setStatus('cancelled')
      } else {
        setStatus('error')
        setError(passkeyErrorMessage(next, enrollment ? 'Could not add passkey.' : 'Could not sign in.'))
      }
    }
  }

  const cancel = () => {
    if (params.state.length < 32) return
    const callback = new URL(enrollment ? 'pulpo://auth/passkey-enrollment' : 'pulpo://auth/passkey')
    callback.searchParams.set('state', params.state)
    callback.searchParams.set('error', 'access_denied')
    window.location.assign(callback.toString())
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <main className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2.5">
          <img src="/pulpo-smiley.png" alt="" className="size-9" />
          <span className="font-semibold">Pulpo</span>
        </div>
        <KeyRound className="mb-3 size-7" aria-hidden />
        <h1 className="text-xl font-semibold">{enrollment ? 'Add a passkey' : 'Sign in with a passkey'}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {enrollment ? 'Safari will ask where you want to save this passkey.' : 'Continue to use a passkey saved on this device, another device, or a security key.'}
        </p>

        {!valid ? <p className="mt-5 text-sm text-destructive" role="alert">This passkey request is invalid or has expired. Return to the Pulpo app and try again.</p> : status === 'cancelled' ? <div className="mt-5 rounded-lg bg-muted p-4 text-sm">
          <div className="flex items-center gap-2 font-medium"><X className="size-4" />Passkey prompt cancelled</div>
          <p className="mt-1 text-muted-foreground">You can try again or return to the app.</p>
        </div> : status === 'error' ? <p className="mt-5 text-sm text-destructive" role="alert">{error}</p> : null}

        <div className="mt-6 grid gap-2">
          <Button size="lg" disabled={!valid || status === 'working'} onClick={() => void continueWithPasskey()}>
            {status === 'working' ? <Loader2 className="animate-spin" /> : <KeyRound />}
            {status === 'working' ? 'Waiting for passkey…' : enrollment ? 'Add passkey' : 'Continue with passkey'}
          </Button>
          {valid && <Button variant="ghost" onClick={cancel}>Cancel</Button>}
        </div>
      </main>
    </div>
  )
}

export function MobilePasskeyEnrollmentPage() {
  return <MobilePasskeyPage mode="enrollment" />
}
