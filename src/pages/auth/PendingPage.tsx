import { Navigate, useNavigate } from 'react-router-dom'
import { Clock, LogOut, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/stores/auth'

export function PendingPage() {
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  const pendingDetails = useAuth((s) => s.pendingDetails)
  const adminEmail = useAuth((s) => s.adminEmail)
  const pendingMessage = useAuth((s) => s.pendingMessage)
  const navigate = useNavigate()

  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'pending') return <Navigate to="/" replace />

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-background px-4 py-10">
      <div className="mb-8 flex items-center gap-2.5">
        <img src="/pulpo-smiley.png" alt="Pulpo" className="size-10" />
        <span className="text-xl font-semibold tracking-tight">Pulpo</span>
      </div>

      <div className="w-full max-w-[440px] rounded-xl border bg-card p-6 shadow-xs sm:p-8">
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <Clock className="size-6" />
        </div>

        <h1 className="text-lg font-semibold">Account pending approval</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{pendingMessage}</p>

        {pendingDetails && adminEmail && (
          <div className="mt-5 rounded-lg border bg-muted/40 p-3">
            <div className="flex items-start gap-2.5 text-sm">
              <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <div className="font-medium">Need help?</div>
                <p className="mt-0.5 text-muted-foreground">
                  Contact your admin at{' '}
                  <a
                    href={`mailto:${adminEmail}`}
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {adminEmail}
                  </a>
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              logout()
              navigate('/login')
            }}
          >
            <LogOut />
            Sign out
          </Button>
          <Button
            className="flex-1"
            variant="secondary"
            onClick={() => window.location.reload()}
          >
            Refresh status
          </Button>
        </div>
      </div>
    </div>
  )
}
