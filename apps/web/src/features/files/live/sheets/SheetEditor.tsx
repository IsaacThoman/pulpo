import { useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import type { LiveAssetStore } from '@pulpo/client-core/office'
import type { SheetValues } from '@pulpo/client-core/office/sheets'
import { SheetView, toHtml, toTsv, type FunctionDoc, type SheetViewOptions, type SheetViewState } from '@pulpo/client-core/office/sheets/view'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ui } from '@/i18n/ui'
import { FormulaBar } from './FormulaBar'
import { sheetViewLabels } from './labels'
import { FindDialog, NoteDialog } from './SheetDialogs'
import { SheetTabs } from './SheetTabs'
import { SheetToolbar } from './SheetToolbar'
import { useSheetState } from './use-sheet-view'

export interface SheetEditorProps {
  doc: Y.Doc
  awareness?: Awareness
  readOnly?: boolean
  assets: LiveAssetStore
  user: { name: string; color: string }
  values?: SheetValues
  functions?: readonly FunctionDoc[]
  renderChart?: SheetViewOptions['renderChart']
  /** Called once the view exists (tests and hosts that drive it directly). */
  onView?: (view: SheetView | undefined) => void
}

function useAppearance(): 'light' | 'dark' {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark ? 'dark' : 'light'
}

const formatNumber = (value: number) => Number(value.toPrecision(10)).toLocaleString(undefined, { maximumFractionDigits: 10 })

function Summary({ state }: { state: SheetViewState }) {
  const { summary } = state
  if (summary.count < 2) return null
  return (
    <div className="flex shrink-0 items-center gap-4 px-3 text-xs text-muted-foreground tabular-nums" aria-live="polite">
      {summary.numbers > 0 && <span>{ui("Sum: {{value}}", { value: formatNumber(summary.sum) })}</span>}
      {summary.average !== undefined && <span>{ui("Average: {{value}}", { value: formatNumber(summary.average) })}</span>}
      <span>{ui("Count: {{value}}", { value: summary.count })}</span>
    </div>
  )
}

/** Copies the selection to the system clipboard as text and HTML (menu Copy/Cut). */
async function writeClipboard(view: SheetView, cut: boolean): Promise<void> {
  const payload = view.clipboard.copyPayload(cut)
  if (!payload) return
  const html = toHtml(payload)
  const text = toTsv(payload.rows)
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })])
  } catch {
    await navigator.clipboard.writeText(text)
  }
  if (cut) view.clearContents()
}

async function readClipboard(): Promise<{ html?: string; text?: string }> {
  try {
    const items = await navigator.clipboard.read()
    for (const item of items) {
      const html = item.types.includes('text/html') ? await (await item.getType('text/html')).text() : undefined
      const text = item.types.includes('text/plain') ? await (await item.getType('text/plain')).text() : undefined
      if (html || text) return { ...(html ? { html } : {}), ...(text ? { text } : {}) }
    }
  } catch {
    return { text: await navigator.clipboard.readText() }
  }
  return {}
}

/** Prints the active sheet from a hidden frame (the browser's print dialog also saves PDFs). */
function printSheet(view: SheetView): void {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  // Our own HTML, with every text escaped; scripts can't run in it.
  frame.setAttribute('sandbox', 'allow-modals allow-same-origin')
  document.body.appendChild(frame)
  const document_ = frame.contentDocument!
  document_.open()
  document_.write(view.printHtml())
  document_.close()
  setTimeout(() => {
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 1000)
  }, 50)
}

/** A spreadsheet editor: toolbar, formula bar, the canvas grid, and sheet tabs. */
export function SheetEditor({ doc, awareness, readOnly, assets, user, values, functions, renderChart, onView }: SheetEditorProps) {
  const container = useRef<HTMLDivElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const [view, setView] = useState<SheetView>()
  const [findOpen, setFindOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; area: string }>()
  const appearance = useAppearance()
  const state = useSheetState(view)

  useEffect(() => {
    const created = new SheetView({
      container: container.current!,
      doc,
      ...(awareness ? { awareness } : {}),
      readOnly: !!readOnly,
      assets,
      user,
      labels: sheetViewLabels(),
      ...(values ? { values } : {}),
      ...(functions ? { functions } : {}),
      ...(renderChart ? { renderChart } : {}),
      appearance,
    })
    setView(created)
    onView?.(created)
    return () => {
      onView?.(undefined)
      created.destroy()
    }
    // The view is rebuilt only for a different document; appearance and read-only update in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, awareness, assets])

  useEffect(() => {
    if (!view) return
    view.options.appearance = appearance
    view.readOnly = !!readOnly
    view.scheduleRender()
    view.notify()
  }, [view, appearance, readOnly])

  useEffect(() => {
    const element = container.current
    if (!element) return
    const onMenu = (event: Event) => {
      const detail = (event as CustomEvent<{ x: number; y: number; area: string }>).detail
      setMenu(detail)
    }
    element.addEventListener('sheetcontextmenu', onMenu)
    return () => element.removeEventListener('sheetcontextmenu', onMenu)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && container.current?.contains(document.activeElement)) {
        event.preventDefault()
        setFindOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const insertImage = async (file: File) => {
    if (!view) return
    const bitmap = await createImageBitmap(file)
    await view.insertImage(new Uint8Array(await file.arrayBuffer()), file.type || 'image/png', { width: bitmap.width, height: bitmap.height })
    bitmap.close()
  }

  const editable = !!state && !state.readOnly
  const area = menu?.area
  return (
    <div className="pulpo-sheet-editor flex h-full min-h-0 w-full flex-col bg-background text-foreground" data-testid="sheet-editor">
      {view && state && (
        <>
          <SheetToolbar view={view} state={state} onFind={() => setFindOpen(true)} onNote={() => setNoteOpen(true)} onInsertImage={() => imageInput.current?.click()} onPrint={() => printSheet(view)} />
          <FormulaBar view={view} state={state} />
        </>
      )}
      <div ref={container} className="relative min-h-0 flex-1" />
      {view && state && <SheetTabs view={view} state={state} summary={<Summary state={state} />} />}
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void insertImage(file)
          event.target.value = ''
        }}
      />
      {view && (
        <>
          <FindDialog view={view} open={findOpen} onOpenChange={(open) => { setFindOpen(open); if (!open) view.focus() }} />
          <NoteDialog view={view} open={noteOpen} onOpenChange={setNoteOpen} />
          <DropdownMenu open={!!menu} onOpenChange={(open) => !open && setMenu(undefined)}>
            <DropdownMenuTrigger asChild>
              <span aria-hidden style={{ position: 'fixed', left: menu?.x ?? 0, top: menu?.y ?? 0, width: 1, height: 1 }} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" onCloseAutoFocus={(event) => { event.preventDefault(); view.focus() }}>
              <DropdownMenuItem disabled={!editable} onSelect={() => void writeClipboard(view, true)}>{ui("Cut")}<DropdownMenuShortcut>⌘X</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void writeClipboard(view, false)}>{ui("Copy")}<DropdownMenuShortcut>⌘C</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem disabled={!editable} onSelect={() => void readClipboard().then((data) => view.clipboard.paste(data))}>{ui("Paste")}<DropdownMenuShortcut>⌘V</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem disabled={!editable} onSelect={() => void readClipboard().then((data) => view.clipboard.paste(data, { values: true }))}>{ui("Paste values only")}</DropdownMenuItem>
              <DropdownMenuItem disabled={!editable} onSelect={() => void readClipboard().then((data) => view.clipboard.paste(data, { formats: true }))}>{ui("Paste formatting only")}</DropdownMenuItem>
              <DropdownMenuSeparator />
              {area !== 'colHeader' && (
                <>
                  <DropdownMenuItem disabled={!editable} onSelect={() => view.insert('row', 'before')}>{ui("Insert row above")}</DropdownMenuItem>
                  <DropdownMenuItem disabled={!editable} onSelect={() => view.insert('row', 'after')}>{ui("Insert row below")}</DropdownMenuItem>
                </>
              )}
              {area !== 'rowHeader' && (
                <>
                  <DropdownMenuItem disabled={!editable} onSelect={() => view.insert('col', 'before')}>{ui("Insert column left")}</DropdownMenuItem>
                  <DropdownMenuItem disabled={!editable} onSelect={() => view.insert('col', 'after')}>{ui("Insert column right")}</DropdownMenuItem>
                </>
              )}
              {area !== 'colHeader' && <DropdownMenuItem disabled={!editable} onSelect={() => view.deleteLines('row')}>{ui("Delete row")}</DropdownMenuItem>}
              {area !== 'rowHeader' && <DropdownMenuItem disabled={!editable} onSelect={() => view.deleteLines('col')}>{ui("Delete column")}</DropdownMenuItem>}
              {area === 'rowHeader' && (
                <>
                  <DropdownMenuItem disabled={!editable} onSelect={() => view.hideLines('row', true)}>{ui("Hide row")}</DropdownMenuItem>
                  <DropdownMenuItem disabled={!editable} onSelect={() => view.hideLines('row', false)}>{ui("Unhide rows")}</DropdownMenuItem>
                  <DropdownMenuItem disabled={!editable} onSelect={() => view.autoFit('row')}>{ui("Fit to data")}</DropdownMenuItem>
                </>
              )}
              {area === 'colHeader' && (
                <>
                  <DropdownMenuItem disabled={!editable} onSelect={() => view.hideLines('col', true)}>{ui("Hide column")}</DropdownMenuItem>
                  <DropdownMenuItem disabled={!editable} onSelect={() => view.hideLines('col', false)}>{ui("Unhide columns")}</DropdownMenuItem>
                  <DropdownMenuItem disabled={!editable} onSelect={() => view.autoFit('col')}>{ui("Fit to data")}</DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!editable} onSelect={() => view.clearContents()}>{ui("Clear contents")}</DropdownMenuItem>
              <DropdownMenuItem disabled={!editable} onSelect={() => setNoteOpen(true)}>{state?.activeNote ? ui("Edit note") : ui("Insert note")}</DropdownMenuItem>
              {state?.activeNote && <DropdownMenuItem disabled={!editable} onSelect={() => view.setNote(undefined)}>{ui("Delete note")}</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  )
}
