import { useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import type { SheetView, SheetViewState } from '@pulpo/client-core/office/sheets/view'
import { validateSheetName } from '@pulpo/client-core/office/sheets'
import {
  DropdownMenu,
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

export function SheetTabs({ view, state, summary }: { view: SheetView; state: SheetViewState; summary?: React.ReactNode }) {
  const [renaming, setRenaming] = useState<string>()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string>()
  const [dragged, setDragged] = useState<string>()
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

  return (
    <div className="flex h-9 shrink-0 items-stretch border-t border-border bg-muted/40 text-sm">
      {editable && (
        <button type="button" aria-label={ui("Add sheet")} title={ui("Add sheet")} onClick={() => view.addSheet()} className="grid w-9 shrink-0 cursor-pointer place-items-center text-muted-foreground hover:bg-accent hover:text-foreground">
          <Plus className="size-4" />
        </button>
      )}
      <div role="tablist" aria-label={ui("Sheets")} className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {visible.map((sheet) => {
          const active = sheet.id === state.sheetId
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
            <DropdownMenu key={sheet.id}>
              <div
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                draggable={editable}
                onDragStart={() => setDragged(sheet.id)}
                onDragOver={(event) => dragged && event.preventDefault()}
                onDrop={() => {
                  if (dragged && dragged !== sheet.id) view.moveSheet(dragged, state.sheets.findIndex((entry) => entry.id === sheet.id))
                  setDragged(undefined)
                }}
                onClick={() => view.setActiveSheet(sheet.id)}
                onDoubleClick={() => editable && startRename(sheet.id, sheet.name)}
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
              <DropdownMenuContent align="start" side="top" onCloseAutoFocus={(event) => event.preventDefault()}>
                <DropdownMenuItem disabled={!editable} onSelect={() => startRename(sheet.id, sheet.name)}>{ui("Rename")}</DropdownMenuItem>
                <DropdownMenuItem disabled={!editable} onSelect={() => view.duplicateSheet(sheet.id)}>{ui("Duplicate")}</DropdownMenuItem>
                <DropdownMenuItem disabled={!editable || visible.length < 2} onSelect={() => view.deleteSheet(sheet.id)}>{ui("Delete")}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger disabled={!editable}>{ui("Change color")}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onSelect={() => view.setTabColor(sheet.id, undefined)}>{ui("No color")}</DropdownMenuItem>
                    <div className="grid grid-cols-5 gap-1 p-1">
                      {TAB_COLORS.map((rgb) => (
                        <button key={rgb} type="button" aria-label={`#${rgb.slice(2)}`} onClick={() => view.setTabColor(sheet.id, { rgb })} className="size-5 cursor-pointer rounded-[3px] border border-black/10" style={{ backgroundColor: `#${rgb.slice(2)}` }} />
                      ))}
                    </div>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem disabled={!editable || visible.length < 2} onSelect={() => view.setSheetHidden(sheet.id, true)}>{ui("Hide sheet")}</DropdownMenuItem>
                <DropdownMenuItem disabled={!editable || state.sheets[0]?.id === sheet.id} onSelect={() => view.moveSheet(sheet.id, Math.max(0, state.sheets.findIndex((entry) => entry.id === sheet.id) - 1))}>{ui("Move left")}</DropdownMenuItem>
                <DropdownMenuItem disabled={!editable || state.sheets[state.sheets.length - 1]?.id === sheet.id} onSelect={() => view.moveSheet(sheet.id, state.sheets.findIndex((entry) => entry.id === sheet.id) + 1)}>{ui("Move right")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        })}
        {editable && hidden.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="shrink-0 cursor-pointer px-3 text-xs text-muted-foreground hover:bg-accent">{ui("{{count}} hidden", { count: hidden.length })}</button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start">
              {hidden.map((sheet) => (
                <DropdownMenuItem key={sheet.id} onSelect={() => view.setSheetHidden(sheet.id, false)}>
                  {ui("Unhide {{name}}", { name: sheet.name })}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {summary}
    </div>
  )
}
