import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/stores/auth'

export function SignupPage() {
  const user = useAuth((s) => s.user)
  const signup = useAuth((s) => s.signup)
  const signupEnabled = useAuth((s) => s.signupEnabled)
  const setupRequired = useAuth((s) => s.setupRequired)
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (user?.role === 'pending') return <Navigate to="/pending" replace />
  if (user) return <Navigate to="/" replace />
  if (setupRequired) return <Navigate to="/setup" replace />

  if (!signupEnabled) {
    return (
      <div className="rounded-xl border bg-card p-6 shadow-xs sm:p-8">
        <h1 className="text-lg font-semibold">Sign ups closed</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          New account creation is currently disabled by an administrator. Contact your org admin if
          you need access.
        </p>
        <Button asChild className="mt-6 w-full" variant="outline">
          <Link to="/login">Back to sign in</Link>
        </Button>
      </div>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    const res = await signup(name, email, password)
    setLoading(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    const currentUser = useAuth.getState().user
    navigate(currentUser?.role === 'pending' ? '/pending' : '/')
  }

  return (
    <div className="rounded-xl border bg-card p-6 shadow-xs sm:p-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">Create your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Get started with Pulpo. New accounts may require admin approval.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            autoComplete="name"
            placeholder="Crazy Hamburger"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pr-10"
              required
              minLength={8}
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
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            type={showPw ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="animate-spin" />}
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
