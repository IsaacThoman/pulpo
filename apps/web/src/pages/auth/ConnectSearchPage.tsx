import { useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { SignedInAccountChooser } from '@/components/layout/AccountSwitcher'
import { Button } from '@/components/ui/button'
import { ui } from '@/i18n/ui'
import { apiRequest } from '@/lib/api'
import { isDesktopRuntime } from '@/lib/runtime'
import { useAuth } from '@/stores/auth'
import { AuthFormError } from './auth-form'
import { readSearchConnectInput, SEARCH_CONNECT_PATH } from '@/lib/search-connect'

export function ConnectSearchPage() {
  const location = useLocation()
  const user = useAuth((state) => state.user)
  const checkingSession = useAuth((state) => state.checkingSession)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const input = readSearchConnectInput(location.search)

  if (!input || isDesktopRuntime()) {
    return <div className="rounded-xl border bg-card p-6 shadow-xs sm:p-8">
      <h1 className="text-lg font-semibold">{ui('Connect Pulpo Search')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{ui('Open Pulpo Search in your browser to start sign-in.')}</p>
      <Link to="/" className="mt-4 inline-block text-sm underline">{ui('Back to Pulpo')}</Link>
    </div>
  }
  if (checkingSession) return <div role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />{ui('Checking your session…')}</div>
  const returnTo = SEARCH_CONNECT_PATH + location.search
  if (!user) return <Navigate to="/login" state={{ from: returnTo }} replace />
  if (user.role === 'pending') return <Navigate to="/pending" replace />

  async function connect() {
    if (!input || !user) return
    setWorking(true)
    setError('')
    try {
      const { redirectUrl } = await apiRequest<{ redirectUrl: string }>('/api/auth/search/authorize', {
        method: 'POST',
        body: { ...input, userId: user.id },
      })
      window.location.replace(redirectUrl)
    } catch (error) {
      setError(error instanceof Error ? error.message : ui('Could not connect to Pulpo Search.'))
      setWorking(false)
    }
  }

  return <>
    <div className="rounded-xl border bg-card p-6 shadow-xs sm:p-8">
      <h1 className="text-lg font-semibold">{ui('Continue to Pulpo Search')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{ui('Use your Pulpo account and shared credits.')}</p>
      <div className="mt-5 min-w-0">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="truncate text-sm text-muted-foreground">{user.email}</p>
      </div>
      {error && <div className="mt-4"><AuthFormError id="search-connect-error">{error}</AuthFormError></div>}
      <Button className="mt-5 w-full" onClick={() => void connect()} disabled={working}>
        {working && <Loader2 className="animate-spin" />}
        {ui('Continue')}
      </Button>
    </div>
    <div className="mt-4"><SignedInAccountChooser returnTo={returnTo} hideActive /></div>
  </>
}
