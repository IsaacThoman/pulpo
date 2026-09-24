import { Link, Navigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/useAppTranslation'
import { ui } from '@/i18n/ui'
import { useAuth } from '@/stores/auth'

export function LandingPage() {
  const { t } = useTranslation()
  const instanceName = useAuth((s) => s.instanceName)
  const signupEnabled = useAuth((s) => s.signupEnabled)
  const setupRequired = useAuth((s) => s.setupRequired)

  if (setupRequired) return <Navigate to="/setup" replace />

  return (
    <div className="flex min-h-dvh flex-col bg-background px-4 text-foreground sm:px-8">
      <main className="flex flex-1 flex-col items-center justify-center py-16 text-center">
        <img src="/pulpo-smiley.png" alt="" className="size-20" />
        <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">{instanceName}</h1>
        <p className="mt-3 max-w-md text-base text-muted-foreground">{ui("A configurable self-hosted AI platform.")}</p>
        <div className="mt-8 flex w-full max-w-xs flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row">
          <Button asChild size="lg" className="sm:min-w-32">
            <Link to="/login">{ui("Log in")}</Link>
          </Button>
          {signupEnabled ? (
            <Button asChild size="lg" variant="outline" className="sm:min-w-32">
              <Link to="/signup">{t('auth.signUp')}</Link>
            </Button>
          ) : null}
        </div>
      </main>
      <footer className="flex justify-center gap-6 py-6 text-sm text-muted-foreground">
        <Link to="/privacy" className="hover:text-foreground">{ui("Privacy")}</Link>
        <Link to="/support" className="hover:text-foreground">{ui("Support")}</Link>
      </footer>
    </div>
  )
}
