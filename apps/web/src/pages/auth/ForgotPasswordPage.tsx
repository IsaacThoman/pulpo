import { useState } from 'react'
import { useTranslation } from '@/i18n/useAppTranslation'
import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiRequest } from '@/lib/api'

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await apiRequest('/api/auth/forgot-password', { method: 'POST', body: { email } })
    } finally {
      setLoading(false)
      setSent(true)
    }
  }

  return (
    <div className="rounded-xl border bg-card p-6 shadow-xs sm:p-8">
      {sent ? (
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-6" />
          </div>
          <h1 className="text-lg font-semibold">{t('auth.checkEmail')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('auth.checkEmailDescription', { email })}
          </p>
          <Button asChild className="mt-6 w-full" variant="outline">
            <Link to="/login">{t('auth.backToSignIn')}</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-6">
            <h1 className="text-lg font-semibold">{t('auth.resetPassword')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('auth.resetRequestDescription')}
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="jon@pulpo.baby"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="animate-spin" />}
              {loading ? t('auth.sending') : t('auth.sendReset')}
            </Button>
          </form>

          <Link
            to="/login"
            className="mt-6 flex items-center justify-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <ArrowLeft className="size-3.5" />
            {t('auth.backToSignIn')}
          </Link>
        </>
      )}
    </div>
  )
}
