import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { useProfiles } from '@/stores/profiles'
import { useAuth } from '@/stores/auth'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { ui, uit } from '@/i18n/ui'
import { useTranslation } from '@/i18n/useAppTranslation'

export function ProfileSwitcher({ collapsed = false, textTransition, notificationCount = 0, children }: {
  collapsed?: boolean
  textTransition?: string
  notificationCount?: number
  children?: ReactNode
}) {
  const { profiles, activeId, select } = useProfiles()
  const user = useAuth((state) => state.user)
  const { t } = useTranslation()
  const active = profiles.find((profile) => profile.id === activeId)
  if (!active) return null
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button title={user?.name} className="relative flex h-10 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-lg text-left hover:bg-sidebar-accent">
        <span className="flex size-8 shrink-0 items-center justify-center"><ProfileAvatar name={user?.name ?? 'Pulpo user'} avatarUrl={user?.avatarUrl} className="size-7" fallbackClassName="text-[11px]" /></span>
        <span className={cn(
          'min-w-0 flex-1 whitespace-nowrap transition-[opacity,transform] ease-[cubic-bezier(0.4,0,0.2,1)]',
          notificationCount ? 'pr-8' : 'pr-2',
          textTransition,
        )}>
          <span className="block truncate text-sm font-medium">{user?.name ?? t('sidebar.signedOut')}</span>
          <span className="block truncate text-xs text-muted-foreground">{user?.username ? uit`@${user.username}` : ''}</span>
        </span>
        {notificationCount > 0 && <span className={cn(
          'absolute grid min-w-3.5 place-items-center rounded-full bg-primary px-1 text-[9px] leading-3.5 text-primary-foreground',
          collapsed ? 'right-0 top-0' : 'right-2 top-1/2 -translate-y-1/2',
        )}>{notificationCount > 99 ? '99+' : notificationCount}</span>}
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="start" className="w-64">
      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{ui('Profiles')}</div>
      <div className="max-h-72 overflow-y-auto">{profiles.map((profile) => <DropdownMenuItem key={profile.id} onSelect={() => void select(profile.id)} className="gap-3 py-2"><span className="flex-1 truncate">{profile.name}</span>{profile.id === activeId && <Check className="size-4" />}</DropdownMenuItem>)}</div>
      {children && <><DropdownMenuSeparator />{children}</>}
    </DropdownMenuContent>
  </DropdownMenu>
}
