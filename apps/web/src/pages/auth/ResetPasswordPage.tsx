import { useState } from 'react'
import { useTranslation } from '@/i18n/useAppTranslation'
import { Link, useSearchParams } from 'react-router-dom'
import { apiRequest } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ResetPasswordPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const token = params.get('token') ?? ''
  return <form className="space-y-4" onSubmit={(event) => {
    event.preventDefault(); setError('')
    void apiRequest('/api/auth/reset-password', { method: 'POST', body: { token, password } })
      .then(() => setMessage(t('auth.passwordUpdated')))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t('auth.resetFailed')))
  }}>
    <div><h1 className="text-2xl font-semibold">{t('auth.resetPassword')}</h1><p className="mt-1 text-sm text-muted-foreground">{t('auth.resetPasswordDescription')}</p></div>
    {message ? <div className="space-y-3"><p className="text-sm text-emerald-600">{message}</p><Button asChild className="w-full"><Link to="/login">{t('auth.signIn')}</Link></Button></div> : <>
      <div className="space-y-1.5"><Label htmlFor="new-password">{t('auth.newPassword')}</Label><Input id="new-password" type="password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button className="w-full" type="submit" disabled={!token}>{t('auth.updatePassword')}</Button>
    </>}
  </form>
}
