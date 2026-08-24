import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, Eye, EyeOff, Loader2, Server, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill, cancelPasskeyCeremony } from '@/lib/passkeys'
import { useAuth } from '@/stores/auth'
import { isDesktopRuntime } from '@/lib/runtime'

export function LoginPage() {
  const user = useAuth((s) => s.user)
  const login = useAuth((s) => s.login)
  const passkeyLogin = useAuth((s) => s.passkeyLogin)
  const signupEnabled = useAuth((s) => s.signupEnabled)
  const setupRequired = useAuth((s) => s.setupRequired)
  const instanceUrl = useAuth((s) => s.instanceUrl)
  const chooseInstance = useAuth((s) => s.chooseInstance)
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [twoFactorStep, setTwoFactorStep] = useState(false)
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const passkeySupported = isDesktopRuntime() || browserSupportsWebAuthn()

  useEffect(() => {
    let active = true
    if (isDesktopRuntime() || !passkeySupported || user || setupRequired !== false) return
    void browserSupportsWebAuthnAutofill().then(async (supported) => {
      if (!active || !supported) return
      const result = await passkeyLogin(true)
      if (!active || !result.ok) return
      const currentUser = useAuth.getState().user
      navigate(currentUser?.role === 'pending' ? '/pending' : '/')
    })
    return () => { active = false; cancelPasskeyCeremony() }
  }, [navigate, passkeyLogin, passkeySupported, setupRequired, user])

  if (user?.role === 'pending') return <Navigate to="/pending" replace />
  if (user) return <Navigate to="/" replace />
  if (setupRequired) return <Navigate to="/setup" replace />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const res = await login(email, password, twoFactorStep ? twoFactorCode : undefined)
    setLoading(false)
    if (!res.ok) {
      if ('twoFactorRequired' in res) {
        setTwoFactorStep(true)
        setTwoFactorCode('')
        return
      }
      setError(res.error)
      return
    }
    const currentUser = useAuth.getState().user
    navigate(currentUser?.role === 'pending' ? '/pending' : '/')
  }

  return (
    <>
      <div className="rounded-xl border bg-card p-6 shadow-xs sm:p-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">{twoFactorStep ? 'Verify your identity' : 'Welcome back'}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {twoFactorStep ? (recoveryMode ? 'Enter one of your saved recovery codes.' : 'Enter the six-digit code from your authenticator app.') : 'Sign in to your Pulpo account.'}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        {!twoFactorStep && <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username webauthn"
            placeholder="jon@pulpo.baby"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>}
        {!twoFactorStep && <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              to="/forgot-password"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pr-10"
              required
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>}

        {twoFactorStep && <div className="space-y-2">
          <Label htmlFor="two-factor-code">{recoveryMode ? 'Recovery code' : 'Authenticator code'}</Label>
          <div className="relative">
            <ShieldCheck className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="two-factor-code"
              autoFocus
              autoComplete="one-time-code"
              inputMode={recoveryMode ? 'text' : 'numeric'}
              maxLength={recoveryMode ? 14 : 6}
              placeholder={recoveryMode ? 'XXXX-XXXX-XXXX' : '000000'}
              value={twoFactorCode}
              onChange={(event) => setTwoFactorCode(recoveryMode ? event.target.value.toUpperCase() : event.target.value.replace(/\D/g, '').slice(0, 6))}
              className="pl-9 font-mono tracking-widest"
              required
            />
          </div>
          <button type="button" onClick={() => { setRecoveryMode((value) => !value); setTwoFactorCode(''); setError(null) }} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            {recoveryMode ? 'Use an authenticator code' : 'Use a recovery code'}
          </button>
        </div>}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="animate-spin" />}
          {twoFactorStep ? 'Verify and sign in' : 'Sign in'}
        </Button>
        {twoFactorStep && <Button type="button" variant="ghost" className="w-full" onClick={() => { setTwoFactorStep(false); setTwoFactorCode(''); setError(null) }}>
          <ArrowLeft /> Back
        </Button>}
      </form>

      {!twoFactorStep && (
        <div className="mt-4 text-center">
          <Link to="/login/options" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            More login options
          </Link>
        </div>
      )}

      {!twoFactorStep && signupEnabled && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link to="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
            Sign up
          </Link>
        </p>
      )}
      </div>
      {isDesktopRuntime() && !twoFactorStep && (
        <button
          type="button"
          aria-label={`Change server, currently ${instanceUrl}`}
          className="mx-auto mt-4 flex min-h-11 max-w-full cursor-pointer items-center justify-center gap-2 px-3 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => { void chooseInstance() }}
        >
          <Server className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="max-w-56 truncate">{instanceUrl}</span>
          <span className="font-medium text-foreground">Change</span>
        </button>
      )}
    </>
  )
}
