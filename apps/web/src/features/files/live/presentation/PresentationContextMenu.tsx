import { useState } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { MenuEntries } from '../chrome/EditorMenuBar'
import type { MenuEntry } from '../chrome/menu'

/** A right-click menu to show: where, its rows (built as it opens), and where focus goes after. */
export interface ContextMenuRequest {
  /** Changes for every menu opened, so a menu opened over another starts fresh where it was asked for. */
  id: number
  x: number
  y: number
  entries: () => MenuEntry[]
  /** The slide, the strip, or the sorter the menu was opened on. */
  returnFocus: () => void
}

/**
 * The slide's, a thumbnail's, and a section header's right-click menu: a menu anchored at the
 * pointer through a 1px trigger (as the spreadsheet's is), with the same rows the menu bar uses.
 * Closing it hands focus back to where it was opened unless a command moved focus on (a dialog).
 */
export function PresentationContextMenu({ menu, onClose }: { menu?: ContextMenuRequest; onClose: () => void }) {
  // The menu closing keeps its place and focus target until it is gone.
  const [shown, setShown] = useState(menu)
  if (menu && menu !== shown) setShown(menu)
  const current = menu ?? shown
  return (
    <DropdownMenu
      key={current?.id ?? 0}
      open={menu !== undefined}
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DropdownMenuTrigger asChild>
        <span aria-hidden style={{ position: 'fixed', left: current?.x ?? 0, top: current?.y ?? 0, width: 1, height: 1, pointerEvents: 'none' }} />
      </DropdownMenuTrigger>
      {/* Beside the pointer, moved up or left to fit, as the system's own context menus open. */}
      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={2}
        className="min-w-56"
        data-presentation-context-menu=""
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          // A command that opened a dialog (Link, Add section) keeps focus there.
          const active = document.activeElement
          if (active && active !== document.body && active.closest('[role="dialog"]')) return
          current?.returnFocus()
        }}
      >
        {current && <MenuEntries entries={current.entries()} close={onClose} />}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
