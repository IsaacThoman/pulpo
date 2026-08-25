import { useState } from 'react'
import { useTranslation } from '@/i18n/useAppTranslation'
import { Navigate, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/stores/auth'
import { ui } from '@/i18n/ui'

export function SetupPage() {
  const { t } = useTranslation()
  const user = useAuth((state) => state.user)
  const setupRequired = useAuth((state) => state.setupRequired)
  const setup = useAuth((state) => state.setup)
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (user) return <Navigate to="/" replace />
  if (setupRequired === false) return <Navigate to="/login" replace />

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError(t('auth.passwordMismatch'))
      return
    }
    setLoading(true)
    const result = await setup(name, username, email, password)
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    navigate('/')
  }

  return (
    <div className="rounded-xl border bg-card p-6 shadow-xs sm:p-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">{t('auth.setUp')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('auth.createAdministratorDescription')}
        </p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="setup-name">{t('auth.displayName')}</Label>
          <Input id="setup-name" autoComplete="name" placeholder={ui("Ada Lovelace")} value={name} onChange={(event) => setName(event.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="setup-email">{t('auth.email')}</Label>
          <Input id="setup-email" type="email" autoComplete="email" placeholder={ui("jon@pulpo.baby")} value={email} onChange={(event) => setEmail(event.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="setup-username">{t('auth.username')}</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
            <Input id="setup-username" autoComplete="username" placeholder={ui("ada_lovelace")} value={username} onChange={(event) => setUsername(event.target.value.replace(/^@/, '').toLowerCase())} className="pl-7" minLength={3} maxLength={30} pattern="[a-z0-9][a-z0-9_]{1,28}[a-z0-9]" title={t('auth.usernameRequirements')} required />
          </div>
          <p className="text-xs text-muted-foreground">{t('auth.usernameHint')}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="setup-password">{t('auth.password')}</Label>
          <div className="relative">
            <Input id="setup-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder={t('auth.passwordRequirements')} value={password} onChange={(event) => setPassword(event.target.value)} className="pr-10" minLength={8} required />
            <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground" tabIndex={-1} aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}>
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="setup-confirm">{t('auth.confirmPassword')}</Label>
          <Input id="setup-confirm" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="••••••••" value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
        </div>
        {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="animate-spin" />}
          {t('auth.createAdministrator')}
        </Button>
      </form>
    </div>
  )
}
