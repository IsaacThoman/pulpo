import { Link, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ui } from '@/i18n/ui'

export function AccountDeletionPage() {
  const location = useLocation()

  return <div className="space-y-6 rounded-xl border bg-card p-6 shadow-xs sm:p-8">
    <div className="space-y-2">
      <h1 className="text-lg font-semibold">{ui('Account deletion in progress')}</h1>
      <p role="status" className="text-sm text-muted-foreground">{ui('Account deletion has started. Your access has ended and cleanup will continue automatically.')}</p>
    </div>
    {location.state?.accountDeletionCleanupFailed && <p role="alert" className="text-sm text-destructive">{ui('Some data on this device could not be removed. Clear this site’s local storage to remove it.')}</p>}
    <Button asChild variant="outline" className="w-full"><Link to="/login">{ui('Go to sign in')}</Link></Button>
  </div>
}
