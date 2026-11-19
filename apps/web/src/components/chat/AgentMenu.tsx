import { useRef, useState, type ReactNode, type Ref } from 'react'
import { COMPUTER_ACCESS_MODES, FILE_ACCESS_MODES, type ComputerAccess, type ComputerFolder, type FileAccessMode } from '@pulpo/contracts'
import { Bot, BotOff, Check, ChevronDown, CircleOff, Folder, FolderLock, FolderOpen, FolderX, Laptop, SquareTerminal, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/useAppTranslation'
import { ui } from '@/i18n/ui'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ACCESS_ICONS, accessModeCopy } from '@/features/files/access-modes'
import { useMenuTriggerFocus } from './use-menu-trigger-focus'

/** Files in the menu: which of them the agent can reach, what it may change, and the chat's Files access. */
export interface AgentFilesControls {
  mode: FileAccessMode
  onModeChange: (mode: FileAccessMode) => void
  /** `all`: the agent may look through all of the user's Files here; otherwise only what the chat mentions. */
  reach?: 'mentioned' | 'all'
  /** Shows what the agent can use in this chat; saved chats only. */
  onOpenAccess?: () => void
}

/** This computer in the menu: off, or on with an access mode and a folder. Desktop app only. */
export interface AgentComputerControls {
  /** The agent uses this computer. */
  active: boolean
  /** The remembered access and folder, kept while it is off. */
  access: ComputerAccess
  folder: ComputerFolder | null
  /** Other folders the user already allowed on this computer, most recent first; picked without the folder dialog. */
  recentFolders?: ComputerFolder[]
  onOff: () => void
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

/** One thing the agent can reach, with what it can reach of it and what it may do there, said in one line. */
function AccessRow({ icon: Icon, label, summary }: { icon: LucideIcon; label: string; summary: string }) {
  return (
    <span className="flex min-w-0 flex-1 items-start gap-1.5">
      <Icon className="mt-0.5 size-4 opacity-70" />
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        <span className="text-xs text-muted-foreground">{summary}</span>
      </span>
    </span>
  )
}

const mutedLabel = 'text-xs font-normal text-muted-foreground'
/** A submenu is as wide as the menu (`w-72`) and scrolls rather than running past a short window. */
const SUBMENU_WIDTH = 288
const submenuClass = 'w-72 max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto'

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
  // A submenu opens beside the menu. Where the window is too narrow for both, it moves over the
  // menu instead of running off the edge.
  const menuRef = useRef<HTMLDivElement>(null)
  const [submenuOffset, setSubmenuOffset] = useState(0)
  const fitSubmenu = (open: boolean) => {
    const menu = menuRef.current
    if (!open || !menu) return
    const room = window.innerWidth - menu.getBoundingClientRect().right - SUBMENU_WIDTH - 8
    setSubmenuOffset(Math.min(0, Math.floor(room)))
  }
  const choose = (action: () => void) => () => {
    menuFocus.onSelect()
    action()
  }
  const radio = (key: string, checked: boolean, action: () => void, row: ReactNode, title?: string) => (
    <DropdownMenuItem key={key} role="menuitemradio" aria-checked={checked} disabled={disabled} title={title} onSelect={choose(action)} className="items-start justify-between">
      {row}
    </DropdownMenuItem>
  )
  /** What the agent may change in Files, under a line that says what the choice is about. */
  const fileModes = (files: AgentFilesControls, heading: string) => (
    <DropdownMenuGroup aria-label={ui("Changes to Files")}>
      <DropdownMenuLabel className={mutedLabel}>{heading}</DropdownMenuLabel>
      {FILE_ACCESS_MODES.map((mode) => {
        const copy = accessModeCopy(mode)
        const checked = files.mode === mode
        return radio(mode, checked, () => { if (!checked) files.onModeChange(mode) },
          <ChoiceRow icon={ACCESS_ICONS[mode]} label={copy.label} description={copy.description} checked={checked} />)
      })}
    </DropdownMenuGroup>
  )
  const filesAccess = (files: AgentFilesControls) => files.onOpenAccess && (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => files.onOpenAccess?.()} className="gap-1.5">
        <FolderLock className="size-4 opacity-70" />
        {ui("Files access…")}
      </DropdownMenuItem>
    </>
  )

  const filesSummary = files
    ? `${files.reach === 'all' ? ui("All files") : ui("Items you mention")} · ${accessModeCopy(files.mode).label}`
    : ''
  const computerSummary = !computer?.active
    ? t('chat.computerOff')
    : computer.access === 'full' || !computer.folder
      ? computerAccessCopy(computer.access).label
      : `${computer.folder.name} · ${computerAccessCopy(computer.access).label}`

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
      <DropdownMenuContent {...menuFocus.contentProps} ref={menuRef} align="start" side="top" className={files || computer ? 'w-72' : 'w-48'}>
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
        {/* Files alone are chosen right here. */}
        {files && !computer && (
          <>
            <DropdownMenuSeparator />
            {fileModes(files, ui("Changes to Files"))}
            {filesAccess(files)}
          </>
        )}
        {/* With a computer there are two things the agent can reach. Each row says what it can reach there and what it may do, and opens to change that. */}
        {computer && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup aria-label={ui("Access")}>
              <DropdownMenuLabel className={mutedLabel}>{ui("Access")}</DropdownMenuLabel>
              {files && (
                <DropdownMenuSub onOpenChange={fitSubmenu}>
                  <DropdownMenuSubTrigger disabled={disabled} className="items-start">
                    <AccessRow icon={Folder} label={ui("Files")} summary={filesSummary} />
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent sideOffset={submenuOffset} className={submenuClass}>
                    {fileModes(files, files.reach === 'all' ? ui("Can look through all of your Files") : ui("Can use the items you mention"))}
                    {filesAccess(files)}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              <DropdownMenuSub onOpenChange={fitSubmenu}>
                <DropdownMenuSubTrigger disabled={disabled} className="items-start">
                  <AccessRow icon={Laptop} label={ui("This computer")} summary={computerSummary} />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent sideOffset={submenuOffset} className={submenuClass}>
                  {/* One option is always chosen: Off, or what the agent may do on this computer. */}
                  <DropdownMenuGroup aria-label={ui("This computer")}>
                    {radio('off', !computer.active, () => { if (computer.active) computer.onOff() },
                      <ChoiceRow icon={CircleOff} label={t('chat.computerOff')} checked={!computer.active} />)}
                    {COMPUTER_ACCESS_MODES.map((access) => {
                      const copy = computerAccessCopy(access)
                      const checked = computer.active && computer.access === access
                      return radio(access, checked, () => { if (!checked) computer.onAccess(access) },
                        <ChoiceRow icon={COMPUTER_ACCESS_ICONS[access]} label={copy.label} description={copy.description} checked={checked} />)
                    })}
                  </DropdownMenuGroup>
                  {/* A folder only means something once the computer is in use, so it is offered then. */}
                  {computer.active && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup aria-label={ui("Folder")}>
                        {/* Full access only starts in its folder; the other modes stay inside theirs. */}
                        <DropdownMenuLabel className={mutedLabel}>{computer.access === 'full' ? ui("Starting folder") : ui("Folder")}</DropdownMenuLabel>
                        {computer.folder && radio(computer.folder.path, true, () => undefined,
                          <ChoiceRow icon={Folder} label={computer.folder.name} checked />, computer.folder.path)}
                        {computer.recentFolders?.map((folder) => radio(folder.path, false, () => computer.onFolder(folder),
                          <ChoiceRow icon={Folder} label={folder.name} checked={false} />, folder.path))}
                        {computer.access === 'full' && radio('none', !computer.folder, () => { if (computer.folder) computer.onFolder(null) },
                          <ChoiceRow icon={FolderX} label={ui("No folder")} checked={!computer.folder} />)}
                        <DropdownMenuItem onSelect={choose(computer.onChooseFolder)} className="gap-1.5">
                          <FolderOpen className="size-4 opacity-70" />
                          {ui("Choose folder…")}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
