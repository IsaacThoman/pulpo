import type { Ref } from 'react'
import { Bot, BotOff, Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/useAppTranslation'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useMenuTriggerFocus } from './use-menu-trigger-focus'

export function AgentMenu({ ref, enabled, disabled, compact = false, onSelect, onSelectClose }: {
  ref?: Ref<HTMLButtonElement>
  enabled: boolean
  disabled: boolean
  /** Shows only the icon, for narrow composers. */
  compact?: boolean
  onSelect: (enabled: boolean) => void
  onSelectClose?: () => void
}) {
  const { t } = useTranslation()
  const menuFocus = useMenuTriggerFocus(onSelectClose)
  const active = enabled && !disabled
  const label = active ? 'Pulpo Agent' : t('chat.agentDisabled')
  const Icon = active ? Bot : BotOff
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          {...menuFocus.triggerProps}
          ref={ref}
          type="button"
          disabled={disabled}
          aria-label={t('chat.agentOptions', { selection: label })}
          className={cn(
            'group/agent-options flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 focus-visible:ring-[3px] data-[pointer-focus]:focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-40',
            compact && 'px-2',
          )}
        >
          <Icon className="size-4" />
          {!compact && <>
            <span>{label}</span>
            <ChevronDown className="size-3 shrink-0 rotate-180 opacity-60 transition-transform duration-200 group-data-[state=open]/agent-options:rotate-0 motion-reduce:transition-none" />
          </>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent {...menuFocus.contentProps} align="start" side="top" className="w-48">
        {[true, false].map((value) => {
          const ChoiceIcon = value ? Bot : BotOff
          return (
            <DropdownMenuItem
              key={String(value)}
              role="menuitemradio"
              aria-checked={active === value}
              disabled={disabled}
              onSelect={() => {
                if (disabled) return
                menuFocus.onSelect()
                if (value !== active) onSelect(value)
              }}
              className="justify-between"
            >
              <span className="flex items-center gap-1.5">
                <ChoiceIcon className="size-4 opacity-70" />
                {value ? 'Pulpo Agent' : t('chat.agentDisabled')}
              </span>
              {active === value && <Check className="size-3.5" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
