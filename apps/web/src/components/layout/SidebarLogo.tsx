import { useState } from 'react'
import { PanelLeftOpen } from 'lucide-react'
import { useTranslation } from '@/i18n/useAppTranslation'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function SidebarLogo({
  collapsed,
  collapsedTooltipOpen,
  onlineCount,
  onlineLoading,
  onlineError,
  onCollapsedTooltipOpenChange,
  onPresenceIntent,
  onClick,
}: {
  collapsed: boolean
  collapsedTooltipOpen: boolean
  onlineCount?: number
  onlineLoading: boolean
  onlineError: boolean
  onCollapsedTooltipOpenChange: (open: boolean) => void
  onPresenceIntent: () => void
  onClick: () => void
}) {
  const { t } = useTranslation()
  const [expandedTooltipOpen, setExpandedTooltipOpen] = useState(false)
  const openSidebarLabel = t('sidebar.expand')
  const presenceLabel = onlineCount !== undefined
    ? t(onlineCount === 1 ? 'sidebar.userOnline' : 'sidebar.usersOnline', { count: onlineCount })
    : onlineLoading
      ? t('sidebar.checkingOnlineUsers')
      : onlineError
        ? t('sidebar.onlineUsersUnavailable')
        : t('sidebar.checkingOnlineUsers')

  return (
    <Tooltip
      open={collapsed ? collapsedTooltipOpen : expandedTooltipOpen}
      onOpenChange={(open) => {
        if (collapsed) onCollapsedTooltipOpenChange(open)
        else setExpandedTooltipOpen(open)
      }}
    >
      <TooltipTrigger asChild>
        <button
          className="group/logo flex size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-sidebar-accent"
          onClick={onClick}
          onPointerEnter={() => {
            if (!collapsed) onPresenceIntent()
          }}
          onFocus={() => {
            if (!collapsed) onPresenceIntent()
          }}
          aria-label={collapsed ? openSidebarLabel : t('sidebar.home')}
        >
          <img
            src="/pulpo-smiley.png"
            alt="Pulpo"
            className={cn('size-6', collapsed && 'group-hover/logo:hidden')}
          />
          {collapsed && <PanelLeftOpen className="hidden size-4 group-hover/logo:block" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {collapsed ? openSidebarLabel : presenceLabel}
      </TooltipContent>
    </Tooltip>
  )
}
