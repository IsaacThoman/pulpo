import { useQuery } from '@tanstack/react-query'
import { useTranslation } from '@/i18n/useAppTranslation'
import { apiRequest } from '@/lib/api'
import { isDesktopRuntime, runtimeAccountKey } from '@/lib/runtime'
import { useAuth } from '@/stores/auth'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function OnlineUserCount({ visible }: { visible: boolean }) {
  const { t } = useTranslation()
  const user = useAuth((state) => state.user)
  const instanceReady = useAuth((state) => state.instanceReady)
  const enabled = visible && (!isDesktopRuntime() || instanceReady) && Boolean(user && user.role !== 'pending')
  const { data, isError } = useQuery({
    queryKey: ['instance-online-count', user ? runtimeAccountKey(user.id) : null],
    queryFn: () => apiRequest<{ count: number }>('/api/instance/online-count'),
    enabled,
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: 'always',
  })

  if (!enabled || !data || isError) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="min-w-0 truncate text-xs font-normal text-muted-foreground tabular-nums">
          {t('sidebar.onlineCount', { count: data.count })}
        </span>
      </TooltipTrigger>
      <TooltipContent>{t('sidebar.onlineCountDescription')}</TooltipContent>
    </Tooltip>
  )
}
