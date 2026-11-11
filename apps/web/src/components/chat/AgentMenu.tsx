import type { Ref } from 'react'
import { FILE_ACCESS_MODES, type FileAccessMode } from '@pulpo/contracts'
import { Bot, BotOff, Check, ChevronDown, FolderLock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/useAppTranslation'
import { ui } from '@/i18n/ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ACCESS_ICONS, accessModeCopy } from '@/features/files/access-modes'
import { useMenuTriggerFocus } from './use-menu-trigger-focus'

/** The Files part of the menu: what the agent may change, and the chat's Files access. */
export interface AgentFilesControls {
  mode: FileAccessMode
  onModeChange: (mode: FileAccessMode) => void
  /** Shows what the agent can use in this chat; saved chats only. */
  onOpenAccess?: () => void
}

export function AgentMenu({ ref, enabled, disabled, compact = false, files, onSelect, onSelectClose }: {
  ref?: Ref<HTMLButtonElement>
  enabled: boolean
  disabled: boolean
  /** Shows only the icon, for narrow composers. */
  compact?: boolean
  /** Offered where the agent can work with Files. */
  files?: AgentFilesControls
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
            'group/agent-options flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-ring focus-visible:ring-2 data-[pointer-focus]:focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-40',
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
      <DropdownMenuContent {...menuFocus.contentProps} align="start" side="top" className={files ? 'w-64' : 'w-48'}>
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
        {files && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup aria-label={ui("Changes to Files")}>
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{ui("Changes to Files")}</DropdownMenuLabel>
              {FILE_ACCESS_MODES.map((mode) => {
                const ModeIcon = ACCESS_ICONS[mode]
                const copy = accessModeCopy(mode)
                return (
                  <DropdownMenuItem
                    key={mode}
                    role="menuitemradio"
                    aria-checked={files.mode === mode}
                    disabled={disabled}
                    onSelect={() => {
                      menuFocus.onSelect()
                      if (mode !== files.mode) files.onModeChange(mode)
                    }}
                    className="items-start justify-between"
                  >
                    <span className="flex min-w-0 items-start gap-1.5">
                      <ModeIcon className="mt-0.5 size-4 opacity-70" />
                      <span className="flex min-w-0 flex-col">
                        <span>{copy.label}</span>
                        <span className="text-xs text-muted-foreground">{copy.description}</span>
                      </span>
                    </span>
                    {files.mode === mode && <Check className="mt-0.5 size-3.5 shrink-0" />}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuGroup>
            {files.onOpenAccess && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => files.onOpenAccess?.()}>
                  <FolderLock className="size-4 opacity-70" />
                  {ui("Files access…")}
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
