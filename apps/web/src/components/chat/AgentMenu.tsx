import { Bot, BotOff, Check, ChevronDown } from 'lucide-react'
import { useTranslation } from '@/i18n/useAppTranslation'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

export function AgentMenu({ enabled, disabled, onSelect }: {
  enabled: boolean
  disabled: boolean
  onSelect: (enabled: boolean) => void
}) {
  const { t } = useTranslation()
  const active = enabled && !disabled
  const label = active ? 'Pulpo Small' : t('chat.agentDisabled')
  const Icon = active ? Bot : BotOff
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={t('chat.agentOptions', { selection: label })}
          className="group/agent-options flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon className="size-4" />
          <span>{label}</span>
          <ChevronDown className="size-3 shrink-0 rotate-180 opacity-60 transition-transform duration-200 group-data-[state=open]/agent-options:rotate-0 motion-reduce:transition-none" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-48">
        {[true, false].map((value) => {
          const ChoiceIcon = value ? Bot : BotOff
          return (
            <DropdownMenuItem
              key={String(value)}
              role="menuitemradio"
              aria-checked={active === value}
              disabled={disabled}
              onSelect={() => { if (!disabled && value !== active) onSelect(value) }}
              className="justify-between"
            >
              <span className="flex items-center gap-1.5">
                <ChoiceIcon className="size-4 opacity-70" />
                {value ? 'Pulpo Small' : t('chat.agentDisabled')}
              </span>
              {active === value && <Check className="size-3.5" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
