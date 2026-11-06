import { Link, Outlet } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ui } from '@/i18n/ui'

export function UsageLayout() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b px-5">
        <h1 className="shrink-0 text-sm font-semibold">{ui("Usage")}</h1>
        <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
          <Link to="/friends/leaderboard">{ui("Compare with friends")}<ArrowRight /></Link>
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full min-w-0 max-w-5xl px-5 py-6">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
