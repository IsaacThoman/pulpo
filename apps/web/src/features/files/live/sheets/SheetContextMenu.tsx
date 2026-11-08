import { Fragment } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ui } from '@/i18n/ui'
import { normalizeEntries, type MenuEntry } from '../chrome/menu'
import { ariaKeyShortcuts, formatShortcut } from '../chrome/shortcuts'

/** Where the menu opened, from the grid's `sheetcontextmenu` event (or the keyboard's menu key). */
export interface SheetMenuPoint {
  x: number
  y: number
  area: string
}

/** A context menu's rows; rows without an icon line up with those that have one. */
function ContextMenuEntries({ entries }: { entries: readonly MenuEntry[] }) {
  const rows = normalizeEntries(entries)
  const aligned = rows.some((entry) => (entry.type === 'item' || entry.type === 'submenu') && entry.icon)
  return rows.map((entry, index) => {
    switch (entry.type) {
      case 'separator':
        return <DropdownMenuSeparator key={`separator-${index}`} />
      case 'label':
        return <DropdownMenuLabel key={`label-${index}`} inset={aligned || undefined} className="text-xs font-normal text-muted-foreground">{entry.label}</DropdownMenuLabel>
      case 'custom':
        return <Fragment key={entry.id}>{entry.render(() => {})}</Fragment>
      case 'submenu':
        return (
          <DropdownMenuSub key={entry.id}>
            <DropdownMenuSubTrigger disabled={entry.disabled} inset={(aligned && !entry.icon) || undefined} data-menu-item={entry.id}>
              {entry.icon && <entry.icon />}
              {entry.label}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-w-(--radix-dropdown-menu-content-available-width)">
              <ContextMenuEntries entries={entry.items} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )
      case 'item':
        return (
          <DropdownMenuItem
            key={entry.id}
            disabled={entry.disabled}
            variant={entry.destructive ? 'destructive' : 'default'}
            inset={(aligned && !entry.icon) || undefined}
            aria-keyshortcuts={entry.shortcut ? ariaKeyShortcuts(entry.shortcut) : undefined}
            data-menu-item={entry.id}
            onSelect={entry.onSelect}
          >
            {entry.icon && <entry.icon />}
            <span className="min-w-0 flex-1">{entry.label}</span>
            {entry.shortcut && <DropdownMenuShortcut className="pl-6 tracking-normal">{formatShortcut(entry.shortcut)}</DropdownMenuShortcut>}
          </DropdownMenuItem>
        )
    }
  })
}

/**
 * The grid's right-click menu (see `cellMenuEntries`) at the pointer: an invisible trigger there
 * gives it the dropdown's styling, keyboard handling and collision avoidance. Focus goes back to
 * the grid when it closes, unless a command opened a dialog that took it.
 */
export function SheetContextMenu({ point, entries, onClose, returnFocus }: {
  point: SheetMenuPoint | undefined
  /** Built when the menu opens, so labels show the selection's counts. */
  entries: () => MenuEntry[]
  onClose: () => void
  returnFocus: () => void
}) {
  return (
    <DropdownMenu open={!!point} modal={false} onOpenChange={(open) => { if (!open) onClose() }}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none fixed size-px" style={{ left: point?.x ?? 0, top: point?.y ?? 0 }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-56"
        aria-label={ui("Cell actions")}
        data-sheet-context-menu=""
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const active = document.activeElement
          // A dialog the command opened keeps the focus it took.
          if (!active || active === document.body || !active.closest('[role="dialog"], [role="alertdialog"]')) returnFocus()
        }}
      >
        {point && <ContextMenuEntries entries={entries()} />}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
