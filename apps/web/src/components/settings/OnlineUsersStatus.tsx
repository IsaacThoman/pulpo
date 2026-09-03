import { useTranslation } from '@/i18n/useAppTranslation'
import { cn } from '@/lib/utils'

export function OnlineUsersStatus({
  onlineCount,
  onlineLoading,
  onlineError,
}: {
  onlineCount?: number
  onlineLoading: boolean
  onlineError: boolean
}) {
  const { t } = useTranslation()
  const label = onlineCount !== undefined
    ? t(onlineCount === 1 ? 'settings.about.userOnline' : 'settings.about.usersOnline', { count: onlineCount })
    : onlineLoading
      ? t('settings.about.checkingOnlineUsers')
      : onlineError
        ? t('settings.about.onlineUsersUnavailable')
        : t('settings.about.checkingOnlineUsers')

  return (
    <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
        <span className={cn(
          'size-2 rounded-full',
          onlineCount !== undefined ? 'bg-emerald-500' : 'bg-muted-foreground/50',
          onlineLoading && onlineCount === undefined && 'animate-pulse',
        )} />
      </span>
      <span>{label}</span>
    </div>
  )
}
