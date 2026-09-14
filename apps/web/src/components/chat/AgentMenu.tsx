import { Bot, BotOff, Check, ChevronDown, Cloud, Laptop, Lock, Settings2 } from 'lucide-react'
import { computerOsLabel, type AgentComputer, type WorkspaceSelection } from '@pulpo/contracts'
import { workspaceMenuLabel } from '@/lib/computers'
import { useTranslation } from '@/i18n/useAppTranslation'
import { ui } from '@/i18n/ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useMenuTriggerFocus } from './use-menu-trigger-focus'

export interface AgentMenuWorkspaceProps {
  /** Current workspace choice for the next agent message. */
  selection: WorkspaceSelection
  computers: readonly AgentComputer[]
  /** The chat already committed to a workspace; show it but do not allow switching. */
  lockedComputerId?: string | null
  locked?: boolean
  onSelectWorkspace: (selection: WorkspaceSelection) => void
  onManageComputers?: () => void
}

export function AgentMenu({ enabled, disabled, onSelect, onSelectClose, workspace }: {
  enabled: boolean
  disabled: boolean
  onSelect: (enabled: boolean) => void
  onSelectClose?: () => void
  workspace?: AgentMenuWorkspaceProps
}) {
  const { t } = useTranslation()
  const menuFocus = useMenuTriggerFocus(onSelectClose)
  const active = enabled && !disabled
  const computers = workspace?.computers ?? []
  const selection: WorkspaceSelection = workspace?.selection ?? { kind: 'sandbox' }
  const onComputer = active && selection.kind === 'computer'
  const label = active ? workspaceMenuLabel(selection, computers) : t('chat.agentDisabled')
  const Icon = active ? (onComputer ? Laptop : Bot) : BotOff
  const showWorkspaces = Boolean(workspace) && (computers.length > 0 || Boolean(workspace?.lockedComputerId))
  const lockedComputer = workspace?.lockedComputerId ? computers.find((entry) => entry.id === workspace.lockedComputerId) : undefined
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          {...menuFocus.triggerProps}
          type="button"
          disabled={disabled}
          aria-label={t('chat.agentOptions', { selection: label })}
          className="group/agent-options flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 focus-visible:ring-[3px] data-[pointer-focus]:focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon className="size-4" />
          <span className="max-w-48 truncate">{label}</span>
          <ChevronDown className="size-3 shrink-0 rotate-180 opacity-60 transition-transform duration-200 group-data-[state=open]/agent-options:rotate-0 motion-reduce:transition-none" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent {...menuFocus.contentProps} align="start" side="top" className={showWorkspaces ? 'w-72' : 'w-48'}>
        {showWorkspaces ? (
          <>
            <DropdownMenuItem
              role="menuitemradio"
              aria-checked={!active}
              disabled={disabled}
              onSelect={() => {
                if (disabled) return
                menuFocus.onSelect()
                if (active) onSelect(false)
              }}
              className="justify-between"
            >
              <span className="flex items-center gap-1.5"><BotOff className="size-4 opacity-70" />{t('chat.agentDisabled')}</span>
              {!active && <Check className="size-3.5" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{ui('Agent workspace')}</DropdownMenuLabel>
            <DropdownMenuItem
              role="menuitemradio"
              aria-checked={active && selection.kind === 'sandbox'}
              disabled={disabled || (workspace?.locked && Boolean(workspace.lockedComputerId))}
              onSelect={() => {
                if (disabled) return
                menuFocus.onSelect()
                if (!active) onSelect(true)
                workspace?.onSelectWorkspace({ kind: 'sandbox' })
              }}
              className="justify-between"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <Cloud className="size-4 shrink-0 opacity-70" />
                <span className="min-w-0">
                  <span className="block truncate">{ui('Cloud sandbox')}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{ui('Disposable Linux workspace')}</span>
                </span>
              </span>
              {active && selection.kind === 'sandbox' && <Check className="size-3.5 shrink-0" />}
            </DropdownMenuItem>
            {(lockedComputer && !computers.some((entry) => entry.id === lockedComputer.id) ? [...computers, lockedComputer] : computers).map((computer) => {
              const chosen = active && selection.kind === 'computer' && selection.computerId === computer.id
              const lockedHere = workspace?.locked && workspace.lockedComputerId === computer.id
              const unavailable = !computer.selectable && !lockedHere
              const hint = !computer.enabled ? ui('Turned off')
                : !computer.online ? ui('Offline')
                : computer.isOwnedByThisDevice ? (computer.accessMode === 'folder' ? ui('This device · folder access') : ui('This device · full access'))
                : computer.pairing?.status === 'approved' ? (computer.accessMode === 'folder' ? ui('Paired · folder access') : ui('Paired · full access'))
                : computer.pairing?.status === 'pending' ? ui('Pairing requested…')
                : computer.allowRemote ? ui('Pair this device to use it') : ui('Remote devices not allowed')
              return (
                <DropdownMenuItem
                  key={computer.id}
                  role="menuitemradio"
                  aria-checked={chosen}
                  disabled={disabled || unavailable || (workspace?.locked && !lockedHere)}
                  onSelect={() => {
                    if (disabled || unavailable) return
                    menuFocus.onSelect()
                    if (!active) onSelect(true)
                    workspace?.onSelectWorkspace({ kind: 'computer', computerId: computer.id })
                  }}
                  className="justify-between"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Laptop className="size-4 shrink-0 opacity-70" />
                    <span className="min-w-0">
                      <span className="block truncate">{computer.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{computerOsLabel(computer.os)} · {hint}</span>
                    </span>
                  </span>
                  {chosen && <Check className="size-3.5 shrink-0" />}
                  {lockedHere && !chosen && <Lock className="size-3.5 shrink-0 opacity-60" />}
                </DropdownMenuItem>
              )
            })}
            {workspace?.locked && (
              <div className="px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">{ui('This chat stays on the workspace it started with. Start a new chat to switch.')}</div>
            )}
            {workspace?.onManageComputers && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => { menuFocus.onSelect(); workspace.onManageComputers?.() }}>
                  <Settings2 className="size-4 opacity-70" />{ui('Manage computers…')}
                </DropdownMenuItem>
              </>
            )}
          </>
        ) : [true, false].map((value) => {
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
