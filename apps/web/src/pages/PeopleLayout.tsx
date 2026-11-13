import { ArrowLeft, ArrowRight, BarChart3, ChevronRight } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { usePendingSocialCount } from '@/lib/pending-social'
import { ownProfilePath, profileOrigin } from '@/lib/profile'
import { useAuth } from '@/stores/auth'
import { useTranslation } from '@/i18n/useAppTranslation'
import { ui, uit } from '@/i18n/ui'

/** Usage's header: your profile, Friends, and the friends leaderboard share one set of tabs. */
export function PeopleHeader() {
  const { t } = useTranslation()
  const username = useAuth((state) => state.user?.username)
  const pending = usePendingSocialCount()
  const tabs = [
    { to: ownProfilePath(username), label: ui("Profile"), badge: 0 },
    { to: '/friends', label: ui("Friends"), badge: pending },
    // Its own short key, so Spanish reads "Clasificación" here while the leaderboard page keeps its full title.
    { to: '/friends/leaderboard', label: t('people.leaderboardTab'), badge: 0 },
  ]
  // Phones give the tabs the whole header (less the drawer button's 3rem) and tighter padding, so
  // all three tabs fit at 320px in English and Spanish even with a 99+ badge; the heading stays for
  // screen readers there. tests/responsive-layout.browser.mjs measures this.
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b px-5 max-sm:pr-3">
      <h1 className="sr-only shrink-0 text-sm font-semibold sm:not-sr-only">{ui("Usage")}</h1>
      <nav aria-label={ui("Usage sections")} className="settings-section-nav flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end
            aria-label={tab.badge ? uit`${tab.label}, ${tab.badge} pending` : undefined}
            className={({ isActive }) =>
              cn(
                'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-1.5 text-sm transition-colors sm:px-2.5',
                isActive
                  ? 'bg-accent font-medium'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )
            }
          >
            {tab.label}
            {Boolean(tab.badge) && <span aria-hidden="true" className="grid min-w-3.5 place-items-center rounded-full bg-primary px-1 text-[9px] font-normal leading-3.5 text-primary-foreground">
              {tab.badge > 99 ? '99+' : tab.badge}
            </span>}
          </NavLink>
        ))}
      </nav>
    </header>
  )
}

/**
 * Someone else's profile drills down from the People tab it was opened from: `← Friends › Jordan`.
 * `compare` offers the friends leaderboard, which only ranks friends.
 */
export function PersonHeader({ name, compare }: { name: string; compare: boolean }) {
  const { t } = useTranslation()
  const origin = profileOrigin(useLocation().state)
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b px-5">
      <nav aria-label={ui("Breadcrumb")} className="min-w-0">
        <ol className="flex min-w-0 items-center gap-1 text-sm">
          <li className="shrink-0">
            <Button asChild size="sm" variant="ghost" className="-ml-2 text-muted-foreground">
              {/* The chevron and name show it's a breadcrumb; phones hide them, so the arrow marks it as a way back. */}
              <Link to={origin}><ArrowLeft className="sm:hidden" aria-hidden />{origin.startsWith('/friends/leaderboard') ? t('people.leaderboardTab') : ui("Friends")}</Link>
            </Button>
          </li>
          {/* Phones leave the name to the profile heading right below. */}
          <li className="flex min-w-0 items-center gap-1 max-sm:hidden">
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span aria-current="page" className="truncate font-medium">{name}</span>
          </li>
        </ol>
      </nav>
      {/* Phones keep the origin's name readable by collapsing Compare to a ranking icon. */}
      {compare && <Button asChild size="sm" variant="ghost" className="text-muted-foreground max-sm:w-8">
        <Link to="/friends/leaderboard">
          <BarChart3 className="sm:hidden" aria-hidden />
          <span className="max-sm:sr-only">{ui("Compare with friends")}</span>
          <ArrowRight className="max-sm:hidden" aria-hidden />
        </Link>
      </Button>}
    </header>
  )
}

/** People hub: Friends and the friends leaderboard render under the header your profile shares. */
export function PeopleLayout() {
  return (
    <div className="flex h-full flex-col">
      <PeopleHeader />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}
