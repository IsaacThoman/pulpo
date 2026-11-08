import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ui } from '@/i18n/ui'
import { MenuEntries } from '../chrome/EditorMenuBar'
import type { MenuEntry } from '../chrome/menu'

/** The rows, built when the menu opens (Radix renders its content only then). */
function Rows({ entries, close }: { entries: () => MenuEntry[]; close: () => void }) {
  return <MenuEntries entries={entries()} close={close} />
}

export interface CellMenuRequest {
  key: string
  x: number
  y: number
}

/**
 * A cell's context menu, at the pointer (or at the cell, from the keyboard's menu key). Its rows
 * are built when it opens. Closing it calls `onClosed` once the menu is gone, to give the
 * keyboard back to the notebook.
 */
export function CellContextMenu({ request, open, entries, onOpenChange, onClosed }: {
  /** Where the menu is (or was, while it animates closed), and for which cell. */
  request: CellMenuRequest | null
  open: boolean
  entries: (key: string) => MenuEntry[]
  onOpenChange: (open: boolean) => void
  onClosed: () => void
}) {
  const at = request
  return (
    <DropdownMenu open={open && Boolean(request)} modal={false} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none fixed size-px" style={{ left: at?.x ?? 0, top: at?.y ?? 0 }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={2}
        className="min-w-56"
        aria-label={ui("Cell actions")}
        // Named by its label, not by the invisible spot it opens from (Radix's default).
        aria-labelledby={undefined}
        data-cell-menu=""
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onClosed()
        }}
      >
        {at && <Rows entries={() => entries(at.key)} close={() => onOpenChange(false)} />}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
