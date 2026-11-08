import { useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import type { LiveAssetStore } from '@pulpo/client-core/office'
import type { SheetValues } from '@pulpo/client-core/office/sheets'
import { SheetView, toHtml, toTsv, type FunctionDoc, type SheetRequest, type SheetViewOptions } from '@pulpo/client-core/office/sheets/view'
import { fileExtension } from '@pulpo/contracts'
import { ui } from '@/i18n/ui'
import { EditorMenuBar } from '../chrome/EditorMenuBar'
import { fileEditorRoot } from '../chrome/editor-root'
import { fileMenuDefinition, type FileMenuHost } from '../chrome/file-menu'
import { LinkDialog } from '../chrome/LinkDialog'
import { shortcutGroupsFromMenus, type MenuEntry } from '../chrome/menu'
import { printHtmlDocument, saveFile } from '../chrome/output'
import { ShortcutsDialog } from '../chrome/ShortcutsDialog'
import { useEditorShortcuts } from '../chrome/use-editor-shortcuts'
import { exportSheetAsText, registerSheetEditor } from './calculation'
import { ConditionalFormatDialog, type ConditionalTab } from './ConditionalFormatDialog'
import { FormulaBar } from './FormulaBar'
import { sheetViewLabels } from './labels'
import { NumberFormatDialog } from './NumberFormatDialog'
import { cellMenuEntries } from './cell-menu'
import { SheetContextMenu, type SheetMenuPoint } from './SheetContextMenu'
import { DeleteLinesDialog, FindDialog, NoteDialog, ResizeLinesDialog, ValidationPrompt, type ValidationRequest } from './SheetDialogs'
import { acceptWorkbookLocation, linkDialogUrl, linkFromDialog } from './sheet-links'
import { sheetMenus, type SheetMenuActions } from './sheet-menus'
import { menusForShortcuts, sheetShortcutGroups } from './sheet-shortcuts'
import { SheetStatus } from './SheetStatus'
import { SheetTabs } from './SheetTabs'
import { SheetToolbar } from './SheetToolbar'
import { SortRangeDialog } from './SortRangeDialog'
import { useSheetState } from './use-sheet-view'
import { ValidationDialog } from './ValidationDialog'

export interface SheetEditorProps {
  doc: Y.Doc
  awareness?: Awareness
  readOnly?: boolean
  fileFormat?: SheetViewOptions['fileFormat']
  assets: LiveAssetStore
  user: { name: string; color: string }
  values?: SheetValues | 'cached'
  functions?: readonly FunctionDoc[]
  renderChart?: SheetViewOptions['renderChart']
  /** Called once the view exists (tests and hosts that drive it directly). */
  onView?: (view: SheetView | undefined) => void
  /** Rendered at the end of the toolbar. */
  toolbarSlot?: React.ReactNode
  /** The file's name, for File ▸ Download of the current sheet as CSV or TSV. */
  name?: string
  /** The Files page's File menu entries (see LiveEditorProps). */
  fileMenu?: FileMenuHost
  onSaveShortcut?: () => void
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
  printHtmlDocument(view.printHtml())
}

/** A spreadsheet editor: menu bar, toolbar, formula bar, the canvas grid, and sheet tabs. */
export function SheetEditor({ doc, awareness, readOnly, fileFormat, assets, user, values, functions, renderChart, onView, toolbarSlot, name, fileMenu, onSaveShortcut }: SheetEditorProps) {
  const root = useRef<HTMLDivElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const nameBox = useRef<HTMLInputElement>(null)
  const [view, setView] = useState<SheetView>()
  const [findOpen, setFindOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [numberFormatOpen, setNumberFormatOpen] = useState(false)
  const [validationDialog, setValidationDialog] = useState<{ preset?: 'dropdown' }>()
  const [conditionalTab, setConditionalTab] = useState<ConditionalTab>()
  const [sortOpen, setSortOpen] = useState(false)
  const [deleteLinesOpen, setDeleteLinesOpen] = useState(false)
  const [resizeKind, setResizeKind] = useState<'row' | 'col'>()
  const [validationRequest, setValidationRequest] = useState<ValidationRequest>()
  const [exportFailed, setExportFailed] = useState(false)
  const [menu, setMenu] = useState<SheetMenuPoint>()
  const appearance = useAppearance()
  const state = useSheetState(view)

  useEffect(() => {
    const created = new SheetView({
      container: container.current!,
      doc,
      ...(awareness ? { awareness } : {}),
      readOnly: !!readOnly,
      fileFormat,
      assets,
      user,
      labels: sheetViewLabels(),
      ...(values ? { values } : {}),
      ...(functions ? { functions } : {}),
      ...(renderChart ? { renderChart } : {}),
      appearance,
    })
    const unregister = registerSheetEditor(doc, created)
    setView(created)
    onView?.(created)
    return () => {
      onView?.(undefined)
      created.destroy()
      unregister()
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
    view?.setFileFormat(fileFormat)
  }, [view, fileFormat])

  // Formats, notes and links don't survive in CSV: those commands stay off there.
  const canFormat = () => !!view && !view.readOnly && !view.valuesOnly

  const actions: SheetMenuActions | undefined = view && {
    cut: () => void writeClipboard(view, true),
    copy: () => void writeClipboard(view, false),
    paste: (mode) => void readClipboard().then((data) => view.clipboard.paste(data, mode === 'values' ? { values: true } : mode === 'formats' ? { formats: true } : undefined)),
    find: () => setFindOpen(true),
    link: () => { if (canFormat()) setLinkOpen(true) },
    note: () => { if (canFormat()) setNoteOpen(true) },
    image: () => imageInput.current?.click(),
    shortcuts: () => setShortcutsOpen(true),
    customNumberFormat: () => setNumberFormatOpen(true),
    validation: (preset) => setValidationDialog(preset ? { preset } : {}),
    conditional: (tab) => setConditionalTab(tab ?? 'single'),
    sortRange: () => setSortOpen(true),
    resize: (kind) => setResizeKind(kind),
  }

  /** What the grid's own keys ask for (Ctrl+K, Shift+F2, Ctrl+P, …): claiming one keeps the browser's shortcut away. */
  const onRequest = (detail: SheetRequest): boolean => {
    if (!view || !actions) return false
    switch (detail.request) {
      case 'link':
        if (!canFormat()) return false
        actions.link()
        return true
      case 'note':
        if (!canFormat()) return false
        actions.note()
        return true
      case 'print':
        printSheet(view)
        return true
      case 'save':
        onSaveShortcut?.()
        return true
      case 'replace':
        setFindOpen(true)
        return true
      case 'goto':
        nameBox.current?.focus()
        return true
      case 'shortcuts':
        setShortcutsOpen(true)
        return true
      case 'deleteLines':
        if (view.readOnly) return false
        setDeleteLinesOpen(true)
        return true
      case 'validation':
        setValidationRequest(detail)
        return true
    }
  }
  const latestRequest = useRef(onRequest)
  latestRequest.current = onRequest

  useEffect(() => {
    const element = container.current
    if (!element) return
    const onMenu = (event: Event) => {
      const detail = (event as CustomEvent<SheetMenuPoint>).detail
      // Open once the click that asked for it is over, so its release can't dismiss the menu.
      setTimeout(() => setMenu({ x: detail.x, y: detail.y, area: detail.area }), 0)
    }
    const onSheetRequest = (event: Event) => {
      if (latestRequest.current((event as CustomEvent<SheetRequest>).detail)) event.preventDefault()
    }
    element.addEventListener('sheetcontextmenu', onMenu)
    element.addEventListener('sheetrequest', onSheetRequest)
    return () => {
      element.removeEventListener('sheetcontextmenu', onMenu)
      element.removeEventListener('sheetrequest', onSheetRequest)
    }
  }, [])

  // The keyboard's menu key and Shift+F10 open the cell menu at the active cell (while editing, the
  // text field's own menu stays).
  useEffect(() => {
    const element = container.current
    if (!element || !view) return
    const fromGrid = (event: Event) => event.target === view.input && !view.editing
    const openAtActiveCell = () => {
      const { row, col } = view.selection.active
      const rect = view.cellRect(row, col)
      const bounds = view.root.getBoundingClientRect()
      const x = Math.min(Math.max(bounds.left + rect.x + Math.min(rect.width, 40), bounds.left), bounds.right - 8)
      const y = Math.min(Math.max(bounds.top + rect.y + rect.height, bounds.top), bounds.bottom - 8)
      setMenu({ x, y, area: 'cell' })
    }
    const onKeyboardMenu = (event: MouseEvent) => {
      if (!fromGrid(event)) return
      event.preventDefault()
      openAtActiveCell()
    }
    // Shift+F10 too where the browser has no menu event for it (a Mac).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'F10' || !event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented || !fromGrid(event)) return
      event.preventDefault()
      openAtActiveCell()
    }
    element.addEventListener('contextmenu', onKeyboardMenu)
    element.addEventListener('keydown', onKeyDown)
    return () => {
      element.removeEventListener('contextmenu', onKeyboardMenu)
      element.removeEventListener('keydown', onKeyDown)
    }
  }, [view])

  // Cmd/Ctrl+F anywhere in the editor (grid, formula bar, toolbar) opens find and replace.
  useEditorShortcuts(root, {
    print: () => { if (view) printSheet(view) },
    save: onSaveShortcut,
    shortcuts: () => setShortcutsOpen(true),
    find: () => setFindOpen(true),
    replace: () => setFindOpen(true),
    focus: () => view?.focus(),
  })

  const insertImage = async (file: File) => {
    if (!view) return
    const bitmap = await createImageBitmap(file)
    await view.insertImage(new Uint8Array(await file.arrayBuffer()), file.type || 'image/png', { width: bitmap.width, height: bitmap.height })
    bitmap.close()
  }

  /** File ▸ Download ▸ the sheet in view as CSV or TSV, named "Book - Sheet1.csv" as Sheets does. */
  const sheetDownloads = (current: SheetView): MenuEntry[] => {
    if (!name || fileFormat === 'csv' || fileFormat === 'tsv') return []
    const sheet = current.getState().sheets.find((entry) => entry.id === current.sheetId)
    const extension = fileExtension(name)
    const stem = (extension ? name.slice(0, -extension.length - 1) : name) || name
    const download = (extension: 'csv' | 'tsv') => () => {
      setExportFailed(false)
      const fileName = `${stem} - ${sheet?.name ?? ''}.${extension}`
      void exportSheetAsText(doc, current.sheetId, fileName, assets)
        .then((bytes) => saveFile(bytes, fileName, extension === 'csv' ? 'text/csv' : 'text/tab-separated-values'))
        .catch(() => setExportFailed(true))
    }
    return [
      { type: 'item', id: 'download-csv', label: ui("Comma-separated values (.csv, current sheet)"), onSelect: download('csv') },
      { type: 'item', id: 'download-tsv', label: ui("Tab-separated values (.tsv, current sheet)"), onSelect: download('tsv') },
    ]
  }

  const menus = view && actions ? sheetMenus(view, fileMenuDefinition(fileMenu, () => ({ print: () => printSheet(view), downloads: sheetDownloads(view) })), actions) : []
  const link = state?.activeLink
  const focusGrid = () => view?.focus()
  return (
    <div ref={root} className="pulpo-sheet-editor flex h-full min-h-0 w-full flex-col bg-background text-foreground" data-testid="sheet-editor" {...fileEditorRoot('sheet')}>
      {view && state && actions && (
        <>
          <EditorMenuBar menus={menus} onClose={focusGrid} className="px-1.5 pt-0.5" />
          <SheetToolbar
            view={view}
            state={state}
            onFind={actions.find}
            onNote={actions.note}
            onLink={actions.link}
            onInsertImage={actions.image}
            onPrint={() => printSheet(view)}
            onCustomNumberFormat={actions.customNumberFormat}
            slot={toolbarSlot}
          />
          {exportFailed && <p role="alert" className="border-b px-3 py-1 text-sm text-destructive">{ui("Couldn't export this sheet. Try again, or download the whole file.")}</p>}
          <FormulaBar view={view} state={state} nameBoxRef={nameBox} />
        </>
      )}
      <div ref={container} className="relative min-h-0 flex-1" />
      {view && state && <SheetTabs view={view} state={state} summary={<SheetStatus view={view} state={state} />} />}
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
      {view && actions && (
        <>
          <FindDialog view={view} open={findOpen} onOpenChange={(open) => { setFindOpen(open); if (!open) view.focus() }} />
          <NoteDialog view={view} open={noteOpen} onOpenChange={setNoteOpen} />
          <LinkDialog
            open={linkOpen}
            onOpenChange={setLinkOpen}
            url={linkDialogUrl(link)}
            // A link's text goes into an empty cell; a filled cell keeps its own.
            showText={!link && !state?.activeInput}
            editing={!!link}
            accept={acceptWorkbookLocation(view.workbook)}
            description={ui("A web address, an email address, or a cell in this spreadsheet, like Sheet1!A1.")}
            onApply={({ text, url }) => view.setLink(linkFromDialog(url, text))}
            onRemove={() => view.setLink(undefined)}
            returnFocus={focusGrid}
          />
          <NumberFormatDialog view={view} open={numberFormatOpen} onOpenChange={setNumberFormatOpen} />
          <ValidationDialog view={view} open={!!validationDialog} preset={validationDialog?.preset} onOpenChange={(open) => { if (!open) setValidationDialog(undefined) }} />
          <ConditionalFormatDialog view={view} open={!!conditionalTab} tab={conditionalTab} onOpenChange={(open) => { if (!open) setConditionalTab(undefined) }} />
          <SortRangeDialog view={view} open={sortOpen} onOpenChange={setSortOpen} />
          <DeleteLinesDialog view={view} open={deleteLinesOpen} onOpenChange={setDeleteLinesOpen} />
          <ResizeLinesDialog view={view} kind={resizeKind} onOpenChange={(open) => { if (!open) setResizeKind(undefined) }} />
          <ValidationPrompt request={validationRequest} onDone={() => setValidationRequest(undefined)} />
          <ShortcutsDialog
            open={shortcutsOpen}
            onOpenChange={setShortcutsOpen}
            groups={() => {
              const groups = sheetShortcutGroups()
              return shortcutGroupsFromMenus(menusForShortcuts(menus, groups), groups)
            }}
            returnFocus={focusGrid}
          />
          <SheetContextMenu point={menu} entries={() => cellMenuEntries(view, actions)} onClose={() => setMenu(undefined)} returnFocus={focusGrid} />
        </>
      )}
    </div>
  )
}
