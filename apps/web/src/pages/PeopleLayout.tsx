import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { usePendingSocialCount } from '@/lib/pending-social'
import { ownProfilePath } from '@/lib/profile'
import { useAuth } from '@/stores/auth'
import { useTranslation } from '@/i18n/useAppTranslation'
import { ui, uit } from '@/i18n/ui'

/** People's header: your profile, Friends, and the friends leaderboard share one set of tabs. */
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
      <h1 className="sr-only shrink-0 text-sm font-semibold sm:not-sr-only">{ui("People")}</h1>
      <nav aria-label={ui("People sections")} className="settings-section-nav flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
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
