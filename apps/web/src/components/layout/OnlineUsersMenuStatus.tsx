import { useTranslation } from '@/i18n/useAppTranslation'
import { cn } from '@/lib/utils'

export function OnlineUsersMenuStatus({
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
    ? t(onlineCount === 1 ? 'sidebar.userOnline' : 'sidebar.usersOnline', { count: onlineCount })
    : onlineLoading
      ? t('sidebar.checkingOnlineUsers')
      : onlineError
        ? t('sidebar.onlineUsersUnavailable')
        : t('sidebar.checkingOnlineUsers')

  return (
    <div role="status" className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
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
