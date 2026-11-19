import type { Ref } from 'react'
import { COMPUTER_ACCESS_MODES, FILE_ACCESS_MODES, type ComputerAccess, type ComputerFolder, type FileAccessMode } from '@pulpo/contracts'
import { Bot, BotOff, Check, ChevronDown, Cloud, Folder, FolderLock, FolderOpen, FolderX, Laptop, SquareTerminal, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/useAppTranslation'
import { ui } from '@/i18n/ui'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ACCESS_ICONS, accessModeCopy } from '@/features/files/access-modes'
import { useMenuTriggerFocus } from './use-menu-trigger-focus'

/** The Files part of the menu: what the agent may change, and the chat's Files access. */
export interface AgentFilesControls {
  mode: FileAccessMode
  onModeChange: (mode: FileAccessMode) => void
  /** Shows what the agent can use in this chat; saved chats only. */
  onOpenAccess?: () => void
}

/** The Workspace part of the menu: Cloud, or This computer with its folder and access. Desktop app only. */
export interface AgentComputerControls {
  /** This computer is the chosen workspace. */
  active: boolean
  /** The remembered access and folder, kept while Cloud is chosen. */
  access: ComputerAccess
  folder: ComputerFolder | null
  /** Other folders the user already allowed on this computer, most recent first; picked without the folder dialog. */
  recentFolders?: ComputerFolder[]
  onCloud: () => void
  onAccess: (access: ComputerAccess) => void
  onChooseFolder: () => void
  onFolder: (folder: ComputerFolder | null) => void
}

const COMPUTER_ACCESS_ICONS: Record<ComputerAccess, LucideIcon> = { full: SquareTerminal, ...ACCESS_ICONS }

function computerAccessCopy(access: ComputerAccess): { label: string; description: string } {
  if (access === 'full') return { label: ui("Full access"), description: ui("Can run commands anywhere on this computer") }
  // Changes on the computer are not undone the way Files changes are.
  if (access === 'write') return { label: accessModeCopy(access).label, description: ui("Changes apply right away") }
  return accessModeCopy(access)
}

/** A choice with an icon, an optional description, and a check when chosen. */
function ChoiceRow({ icon: Icon, label, description, checked }: { icon: LucideIcon; label: string; description?: string; checked: boolean }) {
  return (
    <>
      <span className="flex min-w-0 items-start gap-1.5">
        <Icon className="mt-0.5 size-4 opacity-70" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{label}</span>
          {description && <span className="text-xs text-muted-foreground">{description}</span>}
        </span>
      </span>
      {checked && <Check className="mt-0.5 size-3.5 shrink-0" />}
    </>
  )
}

export function AgentMenu({ ref, enabled, disabled, compact = false, files, computer, onSelect, onSelectClose }: {
  ref?: Ref<HTMLButtonElement>
  enabled: boolean
  disabled: boolean
  /** Shows only the icon, for narrow composers. */
  compact?: boolean
  /** Offered where the agent can work with Files. */
  files?: AgentFilesControls
  /** Offered in the desktop app where the agent may use this computer. */
  computer?: AgentComputerControls
  onSelect: (enabled: boolean) => void
  onSelectClose?: () => void
}) {
  const { t } = useTranslation()
  const menuFocus = useMenuTriggerFocus(onSelectClose)
  const active = enabled && !disabled
  const onComputer = active && Boolean(computer?.active)
  const label = onComputer ? ui("This computer") : active ? 'Pulpo Agent' : t('chat.agentDisabled')
  const Icon = onComputer ? Laptop : active ? Bot : BotOff
  // With Full access the computer replaces the cloud workspace, and Files with it.
  const filesShown = files && !(computer?.active && computer.access === 'full')
  const choose = (action: () => void) => () => {
    menuFocus.onSelect()
    action()
  }
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
      <DropdownMenuContent {...menuFocus.contentProps} align="start" side="top" className={files || computer ? 'w-64' : 'w-48'}>
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
        {computer && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup aria-label={ui("Workspace")}>
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{ui("Workspace")}</DropdownMenuLabel>
              <DropdownMenuItem
                role="menuitemradio"
                aria-checked={!computer.active}
                disabled={disabled}
                onSelect={choose(() => { if (computer.active) computer.onCloud() })}
                className="items-start justify-between"
              >
                <ChoiceRow icon={Cloud} label={ui("Cloud")} checked={!computer.active} />
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={disabled} className="items-start">
                  <span className="flex min-w-0 flex-1 items-start justify-between gap-1.5">
                    <ChoiceRow icon={Laptop} label={ui("This computer")} checked={computer.active} />
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-72">
                  <DropdownMenuGroup aria-label={ui("Folder")}>
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{ui("Folder")}</DropdownMenuLabel>
                    {computer.folder && (
                      <DropdownMenuItem
                        role="menuitemradio"
                        aria-checked
                        title={computer.folder.path}
                        onSelect={choose(() => computer.onFolder(computer.folder))}
                        className="items-start justify-between"
                      >
                        <ChoiceRow icon={Folder} label={computer.folder.name} checked />
                      </DropdownMenuItem>
                    )}
                    {computer.recentFolders?.map((folder) => (
                      <DropdownMenuItem
                        key={folder.path}
                        role="menuitemradio"
                        aria-checked={false}
                        title={folder.path}
                        onSelect={choose(() => computer.onFolder(folder))}
                        className="items-start justify-between"
                      >
                        <ChoiceRow icon={Folder} label={folder.name} checked={false} />
                      </DropdownMenuItem>
                    ))}
                    {computer.access === 'full' && (
                      <DropdownMenuItem
                        role="menuitemradio"
                        aria-checked={!computer.folder}
                        onSelect={choose(() => { if (computer.folder) computer.onFolder(null) })}
                        className="items-start justify-between"
                      >
                        <ChoiceRow icon={FolderX} label={ui("No folder")} checked={!computer.folder} />
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={choose(computer.onChooseFolder)}>
                      <FolderOpen className="size-4 opacity-70" />
                      {ui("Choose folder…")}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup aria-label={ui("Access")}>
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{ui("Access")}</DropdownMenuLabel>
                    {COMPUTER_ACCESS_MODES.map((access) => {
                      const copy = computerAccessCopy(access)
                      const checked = computer.active && computer.access === access
                      return (
                        <DropdownMenuItem
                          key={access}
                          role="menuitemradio"
                          aria-checked={checked}
                          onSelect={choose(() => { if (!checked) computer.onAccess(access) })}
                          className="items-start justify-between"
                        >
                          <ChoiceRow icon={COMPUTER_ACCESS_ICONS[access]} label={copy.label} description={copy.description} checked={checked} />
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>
          </>
        )}
        {files && filesShown && (
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
