import { useState } from 'react'
import { ChevronDown, Menu as MenuIcon, Plus } from 'lucide-react'
import type { SheetView, SheetViewState } from '@pulpo/client-core/office/sheets/view'
import { validateSheetName } from '@pulpo/client-core/office/sheets'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { focusIsIdle } from './dialog-focus'

const TAB_COLORS = ['FFC00000', 'FFFF0000', 'FFFFC000', 'FFFFFF00', 'FF92D050', 'FF00B050', 'FF00B0F0', 'FF0070C0', 'FF002060', 'FF7030A0']

/** Excel's English error messages from the model, translated for display. */
function nameError(message: string): string {
  switch (message) {
    case 'Sheet names cannot be blank':
      return ui("Sheet names can't be blank.")
    case 'Sheet names can have at most 31 characters':
      return ui("Sheet names can have at most 31 characters.")
    case 'That name is already taken':
      return ui("Another sheet already has that name.")
    default:
      return ui("Sheet names can't contain \\ / ? * [ ] : or start or end with an apostrophe.")
  }
}

/**
 * The sheet tabs at the bottom, as Google Sheets has them: Add sheet (+), All sheets (≡, hidden
 * ones too), the tabs (click, double-click to rename, drag to reorder, right-click or the arrow for
 * the tab's menu), and the status bar's figures and zoom at the right.
 */
export function SheetTabs({ view, state, summary }: { view: SheetView; state: SheetViewState; summary?: React.ReactNode }) {
  const [renaming, setRenaming] = useState<string>()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string>()
  const [dragged, setDragged] = useState<string>()
  const [menuFor, setMenuFor] = useState<string>()
  const visible = state.sheets.filter((sheet) => sheet.state === 'visible')
  const hidden = state.sheets.filter((sheet) => sheet.state === 'hidden')
  const editable = !state.readOnly && !state.valuesOnly

  const startRename = (id: string, name: string) => {
    setRenaming(id)
    setDraft(name)
    setError(undefined)
  }
  const finishRename = () => {
    if (!renaming) return
    const problem = validateSheetName(draft, view.workbook, renaming)
    if (problem) {
      setError(nameError(problem))
      return
    }
    view.renameSheet(renaming, draft)
    setRenaming(undefined)
    view.focus()
  }
  const showSheet = (id: string) => {
    view.setSheetHidden(id, false)
    view.setActiveSheet(id)
  }
  // Commands go back to the grid, except Rename, whose box takes the focus.
  const closeFocus = (event: Event) => {
    event.preventDefault()
    if (focusIsIdle()) view.focus()
  }

  return (
    <div className="@container flex h-9 shrink-0 items-stretch border-t border-border bg-muted/40 text-sm">
      {editable && (
        <button type="button" aria-label={ui("Add sheet")} title={ui("Add sheet")} onClick={() => view.addSheet()} className="grid w-9 shrink-0 cursor-pointer place-items-center text-muted-foreground hover:bg-accent hover:text-foreground">
          <Plus className="size-4" />
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={ui("All sheets")} title={ui("All sheets")} className="grid w-9 shrink-0 cursor-pointer place-items-center text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent">
            <MenuIcon className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="max-h-80 min-w-48" onCloseAutoFocus={closeFocus} data-sheet-list="">
          {state.sheets.filter((sheet) => sheet.state !== 'veryHidden').map((sheet) => (
            <DropdownMenuCheckboxItem
              key={sheet.id}
              role="menuitemradio"
              checked={sheet.id === state.sheetId}
              disabled={sheet.state === 'hidden' && !editable}
              onSelect={() => (sheet.state === 'hidden' ? showSheet(sheet.id) : view.setActiveSheet(sheet.id))}
              className={cn(sheet.state === 'hidden' && 'text-muted-foreground')}
            >
              {sheet.color && <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: sheet.color }} />}
              <span className="min-w-0 flex-1 truncate">{sheet.state === 'hidden' ? ui("{{name}} (hidden)", { name: sheet.name }) : sheet.name}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div role="tablist" aria-label={ui("Sheets")} className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {visible.map((sheet, at) => {
          const active = sheet.id === state.sheetId
          const indexOf = (id: string) => state.sheets.findIndex((entry) => entry.id === id)
          const position = indexOf(sheet.id)
          // Moving goes past the neighbouring tab people see, never just past a hidden sheet.
          const before = visible[at - 1]
          const after = visible[at + 1]
          if (renaming === sheet.id) {
            return (
              <div key={sheet.id} className="relative flex items-center px-1">
                <input
                  autoFocus
                  aria-label={ui("Sheet name")}
                  aria-invalid={!!error}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value)
                    setError(undefined)
                  }}
                  onBlur={finishRename}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') finishRename()
                    if (event.key === 'Escape') {
                      setRenaming(undefined)
                      view.focus()
                    }
                  }}
                  className="h-7 w-36 rounded border border-primary bg-background px-2 text-sm outline-none"
                />
                {error && <div role="alert" className="absolute bottom-full left-0 z-10 mb-1 w-64 rounded-md border border-destructive bg-popover p-2 text-xs text-destructive shadow-md">{error}</div>}
              </div>
            )
          }
          return (
            <DropdownMenu key={sheet.id} open={menuFor === sheet.id} onOpenChange={(open) => setMenuFor(open ? sheet.id : undefined)}>
              <div
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                draggable={editable}
                onDragStart={() => setDragged(sheet.id)}
                onDragOver={(event) => dragged && event.preventDefault()}
                onDrop={() => {
                  if (dragged && dragged !== sheet.id) view.moveSheet(dragged, position)
                  setDragged(undefined)
                }}
                onClick={() => view.setActiveSheet(sheet.id)}
                onDoubleClick={() => editable && startRename(sheet.id, sheet.name)}
                // Right-click opens the tab's menu, as in Google Sheets and Excel.
                onContextMenu={(event) => {
                  event.preventDefault()
                  if (!active) view.setActiveSheet(sheet.id)
                  setMenuFor(sheet.id)
                }}
                data-sheet-tab={sheet.id}
                className={cn(
                  'group relative flex max-w-48 shrink-0 cursor-pointer items-center gap-1 border-r border-border px-3 text-muted-foreground hover:bg-accent/60',
                  active && 'bg-background font-medium text-foreground shadow-[inset_0_2px_0_var(--color-primary)]',
                )}
              >
                {sheet.color && <span aria-hidden className="absolute inset-x-2 bottom-0 h-[3px] rounded-t" style={{ backgroundColor: sheet.color }} />}
                <span className="truncate">{sheet.name}</span>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label={ui("{{name}} options", { name: sheet.name })} onClick={(event) => event.stopPropagation()} className="grid size-5 cursor-pointer place-items-center rounded opacity-60 hover:bg-accent hover:opacity-100">
                    <ChevronDown className="size-3" />
                  </button>
                </DropdownMenuTrigger>
              </div>
              <DropdownMenuContent align="start" side="top" onCloseAutoFocus={closeFocus} data-sheet-tab-menu={sheet.id}>
                <DropdownMenuItem disabled={!editable || visible.length < 2} onSelect={() => view.deleteSheet(sheet.id)}>{ui("Delete")}</DropdownMenuItem>
                <DropdownMenuItem disabled={!editable} onSelect={() => view.duplicateSheet(sheet.id)}>{ui("Duplicate")}</DropdownMenuItem>
                <DropdownMenuItem disabled={!editable} onSelect={() => startRename(sheet.id, sheet.name)}>{ui("Rename")}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger disabled={!editable}>{ui("Change color")}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onSelect={() => view.setTabColor(sheet.id, undefined)}>{ui("No color")}</DropdownMenuItem>
                    <div className="grid grid-cols-5 gap-1 p-1">
                      {TAB_COLORS.map((rgb) => (
                        <button key={rgb} type="button" aria-label={`#${rgb.slice(2)}`} onClick={() => { view.setTabColor(sheet.id, { rgb }); setMenuFor(undefined) }} className="size-5 cursor-pointer rounded-[3px] border border-black/10" style={{ backgroundColor: `#${rgb.slice(2)}` }} />
                      ))}
                    </div>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem disabled={!editable || visible.length < 2} onSelect={() => view.setSheetHidden(sheet.id, true)}>{ui("Hide sheet")}</DropdownMenuItem>
                {hidden.length > 0 && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger disabled={!editable}>{ui("Unhide sheet")}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {hidden.map((entry) => (
                        <DropdownMenuItem key={entry.id} onSelect={() => showSheet(entry.id)}>{entry.name}</DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!editable || !before} onSelect={() => { if (before) view.moveSheet(sheet.id, indexOf(before.id)) }}>{ui("Move left")}</DropdownMenuItem>
                <DropdownMenuItem disabled={!editable || !after} onSelect={() => { if (after) view.moveSheet(sheet.id, indexOf(after.id)) }}>{ui("Move right")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        })}
      </div>
      {summary}
    </div>
  )
}
