import { useState, useSyncExternalStore } from 'react'
import type { NotebookCellState, NotebookController, NotebookEditorState } from '@pulpo/client-core/office/notebook/view'
import { ArrowDown, ArrowUp, BetweenHorizontalEnd, BetweenHorizontalStart, CopyPlus, Ellipsis, Trash2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { ToolbarButton } from '../../editor/ToolbarButton'
import { copyCells } from './clipboard'

/**
 * The active cell's own toolbar, as JupyterLab 4 and VS Code show one: duplicate, move, insert
 * above and below, delete, and a menu with the rest (hide code or outputs, clipboard, merge).
 */
export function CellToolbar({ controller, cell, mode, focusNotebook }: {
  controller: NotebookController
  cell: NotebookCellState
  mode: NotebookEditorState['mode']
  focusNotebook: () => void
}) {
  // The toolbar shows on hover or focus; it stays while its menu (which takes focus) is open.
  const [menu, setMenu] = useState(false)
  // Read here: its memoized cell does not re-render when something is copied.
  const canPaste = useSyncExternalStore(controller.subscribe, () => controller.getState().canPaste)
  const hasOutputs = cell.type === 'code' && Boolean(cell.outputs && cell.outputs.json !== '[]')
  const act = (action: () => void) => () => {
    action()
    focusNotebook()
  }
  return (
    <div
      className={cn('absolute -top-3 right-2 z-10 hidden items-center gap-0.5 rounded-md border bg-background px-0.5 shadow-sm group-hover/cell:flex group-focus-within/cell:flex', menu && 'flex')}
      data-cell-toolbar
    >
      <ToolbarButton label={ui("Duplicate cell")} shortcut={{ label: 'Shift+Alt+↓', aria: 'Shift+Alt+ArrowDown' }} onClick={act(() => controller.duplicate())}><CopyPlus className="size-3.5" /></ToolbarButton>
      <ToolbarButton label={ui("Move cell up")} onClick={() => controller.move('up')}><ArrowUp className="size-3.5" /></ToolbarButton>
      <ToolbarButton label={ui("Move cell down")} onClick={() => controller.move('down')}><ArrowDown className="size-3.5" /></ToolbarButton>
      <ToolbarButton label={ui("Insert cell above")} shortcut={{ label: 'A', aria: 'a' }} onClick={() => controller.insert('above', 'code', { edit: true })}><BetweenHorizontalStart className="size-3.5" /></ToolbarButton>
      <ToolbarButton label={ui("Insert cell below")} shortcut={{ label: 'B', aria: 'b' }} onClick={() => controller.insert('below', 'code', { edit: true })}><BetweenHorizontalEnd className="size-3.5" /></ToolbarButton>
      <ToolbarButton label={ui("Delete cell")} onClick={() => controller.deleteSelected()}><Trash2 className="size-3.5" /></ToolbarButton>
      <DropdownMenu open={menu} onOpenChange={setMenu}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={ui("More cell actions")}
            title={ui("More cell actions")}
            onMouseDown={(event) => event.preventDefault()}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Ellipsis className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            // Keys go on working in the notebook, not on this button.
            event.preventDefault()
            focusNotebook()
          }}
        >
          <DropdownMenuItem onSelect={() => controller.toggleSource()}>{cell.sourceCollapsed ? ui("Show code") : ui("Hide code")}</DropdownMenuItem>
          {hasOutputs && (
            <DropdownMenuItem onSelect={() => controller.toggleOutputs()}>
              {cell.outputsCollapsed ? ui("Show outputs") : ui("Hide outputs")}
              <DropdownMenuShortcut>{'O'}</DropdownMenuShortcut>
            </DropdownMenuItem>
          )}
          {hasOutputs && <DropdownMenuItem onSelect={() => controller.clearOutputs('selected')}>{ui("Clear outputs")}</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => copyCells(() => controller.cut())}>{ui("Cut cells")}<DropdownMenuShortcut>{'X'}</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem onSelect={() => copyCells(() => controller.copy())}>{ui("Copy cells")}<DropdownMenuShortcut>{'C'}</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem disabled={!canPaste} onSelect={() => void controller.paste('below')}>{ui("Paste cells below")}<DropdownMenuShortcut>{'V'}</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuSeparator />
          {mode === 'edit' && <DropdownMenuItem onSelect={() => controller.split()}>{ui("Split cell at the cursor")}</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => controller.merge()}>{ui("Merge with the cell below")}<DropdownMenuShortcut>{'Shift+M'}</DropdownMenuShortcut></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
