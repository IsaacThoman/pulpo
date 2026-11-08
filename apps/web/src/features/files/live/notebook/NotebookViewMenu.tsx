import { SlidersHorizontal } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ui } from '@/i18n/ui'
import { MenuEntries } from '../chrome/EditorMenuBar'
import type { MenuEntry } from '../chrome/menu'

const noop = () => {}

/** The rows, built when the menu opens (Radix renders its content only then). */
function Rows({ entries }: { entries: () => MenuEntry[] }) {
  return <MenuEntries entries={entries()} close={noop} />
}

/**
 * How the notebook shows (JupyterLab's View menu), on the toolbar: line numbers and wrapping,
 * which are this person's preference, and collapsing or expanding every cell's code or outputs,
 * which the notebook records (JupyterLab and VS Code read it), each one undo step. Its rows are
 * the menu bar's (`viewOptionEntries`), built when it opens.
 */
export function NotebookViewMenu({ entries, focusNotebook }: {
  entries: () => MenuEntry[]
  focusNotebook: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ui("View options")}
          title={ui("View options")}
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <SlidersHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onCloseAutoFocus={(event) => {
          // Keys go on working in the notebook, not on this button.
          event.preventDefault()
          focusNotebook()
        }}
      >
        <Rows entries={entries} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
