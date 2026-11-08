import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type KeyboardEvent } from 'react'
import { MemoryLiveAssetStore, type LiveAssetStore } from '@pulpo/client-core/office'
import {
  exportNotebookFile,
  notebookToHtml,
  notebookToScript,
  outputPlainText,
  parseNotebook,
  renderNotebookHtml,
  stripAnsi,
  type MimeBundle,
  type NotebookCellType,
  type NotebookOutput,
} from '@pulpo/client-core/office/notebook'
import {
  createCellEditor,
  NotebookController,
  NotebookSearch,
  readAttachments,
  readOutputs,
  type CellEditor,
  type NotebookCellState,
  type NotebookEditorState,
  type NotebookPeer,
  type NotebookSearchMatch,
} from '@pulpo/client-core/office/notebook/view'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronsDownUp,
  ClipboardPaste,
  Copy,
  Eraser,
  GripVertical,
  Keyboard,
  ListTree,
  Merge,
  Play,
  Plus,
  Redo2,
  Scissors,
  Search,
  SplitSquareVertical,
  Trash2,
  Undo2,
} from 'lucide-react'
import { HighlightedCode } from '@/components/chat/HighlightedCode'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { NotebookMarkdown, OutputBody, Prompt } from '@/components/viewers/NotebookViewer'
import { useDarkTheme } from '@/components/viewers/use-dark-theme'
import { activeLocale, ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { useFileToasts } from '../../browser/toasts'
import { sessionColor, sessionLabel } from '../../editor/presence'
import { ToolbarButton } from '../../editor/ToolbarButton'
import { EditorMenuBar } from '../chrome/EditorMenuBar'
import { fileEditorRoot } from '../chrome/editor-root'
import { fileMenuDefinition } from '../chrome/file-menu'
import { shortcutGroupsFromMenus, type MenuDefinition, type MenuEntry } from '../chrome/menu'
import { printHtmlDocument, saveFile } from '../chrome/output'
import { ShortcutsDialog } from '../chrome/ShortcutsDialog'
import { helpMenu } from '../chrome/standard-menus'
import { useEditorShortcuts } from '../chrome/use-editor-shortcuts'
import type { LiveEditorProps } from '../types'
import { cellContextEntries, notebookMenus, typeLabel, viewOptionEntries, type NotebookMenuContext } from './notebook-menus'
import { notebookShortcutGroups } from './notebook-shortcuts'
import { CellContextMenu, type CellMenuRequest } from './CellContextMenu'
import { CellToolbar } from './CellToolbar'
import { NotebookFindBar, type NotebookFindRequest } from './NotebookFindBar'
import { NotebookOutline } from './NotebookOutline'
import { NotebookPosition, OutputScroll } from './NotebookStatus'
import { NotebookViewMenu } from './NotebookViewMenu'
import { NOTEBOOK_PREFERENCES, useStoredFlag } from './preferences'
import { CursorStore, NotebookViewContext, useCurrentMatchIn, useNotebookView, type NotebookView } from './view-context'

/** The phrases CodeMirror shows in cells, in the app's language. */
function editorLabels(): Record<string, string> {
  return {
    Find: ui("Find"),
    Replace: ui("Replace"),
    next: ui("next"),
    previous: ui("previous"),
    all: ui("all"),
    'match case': ui("match case"),
    regexp: ui("regexp"),
    'by word': ui("by word"),
    replace: ui("replace"),
    'replace all': ui("replace all"),
    close: ui("close"),
    'Go to line': ui("Go to line"),
    go: ui("go"),
    'current match': ui("current match"),
    'on line': ui("on line"),
    'replaced match on line $': ui("replaced match on line $"),
    'replaced $ matches': ui("replaced $ matches"),
    'Control character': ui("Control character"),
  }
}

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = mac ? '⌘' : 'Ctrl+'

/** How long a cell inserted with text (Insert ▸ Heading) puts the caret after it when its editor mounts. */
const CARET_HINT_MS = 500

/** Waits this long before reading outputs again after their images failed to load (offline, say). */
const RETRY_MS = 15_000

function useResolved<T>(read: () => Promise<T>, deps: unknown[], empty: T): T {
  const [value, setValue] = useState<T>(empty)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    read().then((next) => { if (!cancelled) setValue(next) }).catch(() => {
      if (cancelled) return
      setValue(empty)
      timer = window.setTimeout(() => setAttempt((current) => current + 1), RETRY_MS)
    })
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // oxlint-disable-next-line react/exhaustive-deps -- `deps` names what the read depends on
  }, [...deps, attempt])
  return value
}

/** Mounts its children once they come near the viewport, so long notebooks start CodeMirror only where people look. */
function useNearViewport(ref: React.RefObject<HTMLElement | null>, force: boolean): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver !== 'function')
  // A cell mounted to be edited keeps its editor, so leaving edit mode does not drop focus.
  useEffect(() => { if (force) setNear(true) }, [force])
  useEffect(() => {
    if (near || force || !ref.current) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setNear(true)
    }, { rootMargin: '600px 0px' })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [near, force, ref])
  return near || force
}

interface CellProps {
  controller: NotebookController
  cell: NotebookCellState
  index: number
  active: boolean
  selected: boolean
  mode: NotebookEditorState['mode']
  peers: readonly NotebookPeer[]
  language: string
  editable: boolean
  dark: boolean
  assets: LiveAssetStore
  registerEditor: (key: string, editor: CellEditor | null) => void
  onDragStart: (key: string, event: DragEvent) => void
  onDrop: (key: string, edge: 'before' | 'after') => void
  dropEdge: 'before' | 'after' | null
  onDragOverCell: (key: string, edge: 'before' | 'after' | null) => void
}

/** A cell's source in CodeMirror, bound to its Y.Text. */
function CellSource({ controller, cell, language, editable, dark, registerEditor, autoFocus }: Pick<CellProps, 'controller' | 'cell' | 'language' | 'editable' | 'dark' | 'registerEditor'> & { autoFocus: boolean }) {
  const view = useNotebookView()
  const container = useRef<HTMLDivElement>(null)
  const editor = useRef<CellEditor | null>(null)
  const latest = useRef({ cell, language, editable, dark, autoFocus, view })
  latest.current = { cell, language, editable, dark, autoFocus, view }
  const { key } = cell

  useEffect(() => {
    const text = controller.sourceOf(key)
    if (!text || !container.current) return
    const initial = latest.current
    // The caret, for the status bar's "Ln, Col".
    const report = () => {
      const state = editor.current?.view.state
      if (!state) return
      const head = state.selection.main.head
      const line = state.doc.lineAt(head)
      latest.current.view.cursor.report({ key, line: line.number, column: head - line.from + 1, selected: state.selection.ranges.reduce((total, range) => total + range.to - range.from, 0) })
    }
    const created = createCellEditor({
      container: container.current,
      text,
      awareness: controller.awareness,
      undoManager: controller.undoManager,
      type: initial.cell.type,
      language: initial.language,
      readOnly: !initial.editable,
      dark: initial.dark,
      labels: editorLabels(),
      label: uit`${typeLabel(initial.cell.type)} cell`,
      placeholder: initial.cell.type === 'markdown' ? ui("Write Markdown") : initial.cell.type === 'code' ? ui("Write code") : undefined,
      lineNumbers: initial.view.lineNumbers,
      wrap: initial.view.wrap || null,
      onFind: (command) => latest.current.view.onFind(key, command),
      // Colab's Ctrl+M chords work while typing too.
      onKeyDown: (event) => controller.handleChordKey(event),
      onSelection: report,
      onFocus: () => {
        controller.select(key, { mode: 'edit' })
        report()
      },
      onShiftEnter: () => controller.advance(),
      onModEnter: () => controller.setMode('command'),
      onAltEnter: () => controller.insert('below', 'code', { edit: true }),
      onEscape: () => controller.setMode('command'),
      onSplit: () => controller.split(),
      onLeave: (direction) => { controller.step(direction, { mode: 'edit' }) },
    })
    editor.current = created
    registerEditor(key, created)
    if (initial.autoFocus) created.focus('keep')
    return () => {
      registerEditor(key, null)
      created.destroy()
      editor.current = null
    }
  }, [controller, key, registerEditor])

  useEffect(() => { editor.current?.setReadOnly(!editable) }, [editable])
  useEffect(() => { editor.current?.setDark(dark) }, [dark])
  useEffect(() => { editor.current?.setType(cell.type, language) }, [cell.type, language])
  useEffect(() => { editor.current?.setLineNumbers(view.lineNumbers) }, [view.lineNumbers])
  useEffect(() => { editor.current?.setWrap(view.wrap || null) }, [view.wrap])
  // The find bar's matches in this cell; moving to one selects it here.
  useEffect(() => {
    const { search } = view
    let shown: { matches: unknown; current: number } | null = null
    let revealed = -1
    const apply = () => {
      const target = editor.current
      if (!target) return
      const { matches, current } = search.matchesIn(key)
      if (shown?.matches !== matches || shown.current !== current) {
        shown = { matches, current }
        target.setSearchMatches(matches, current)
      }
      const { revealed: revision } = search.getState()
      if (current >= 0 && revision !== revealed) target.select(matches[current]!.from, matches[current]!.to)
      revealed = revision
    }
    apply()
    return search.subscribe(apply)
  }, [view.search, key])

  return <div ref={container} className="min-w-0 flex-1" data-cell-source />
}

/** The source as highlighted text, until the cell comes into view. */
function StaticSource({ controller, cellKey, language, lineNumbers }: { controller: NotebookController; cellKey: string; language: string | null; lineNumbers: boolean }) {
  const text = controller.sourceOf(cellKey)?.toString() ?? ''
  const source = (
    <pre className="code-highlight min-w-0 flex-1 overflow-hidden px-2.5 py-1.5 font-mono text-[13px] leading-[1.6]" data-static-source>
      <HighlightedCode code={text} language={language} />
    </pre>
  )
  if (!lineNumbers) return source
  // Numbered as the editor that replaces it will be, so mounting it does not shift the text.
  return (
    <div className="flex min-w-0 flex-1">
      <pre aria-hidden className="min-w-8 shrink-0 py-1.5 pr-0.5 pl-2 text-right font-mono text-[13px] leading-[1.6] text-muted-foreground opacity-70 select-none">
        {text.split('\n').map((_, index) => index + 1).join('\n')}
      </pre>
      {source}
    </div>
  )
}

function useSourceText(controller: NotebookController, key: string): string {
  const text = controller.sourceOf(key)
  return useSyncExternalStore(
    (listener) => {
      text?.observe(listener)
      return () => text?.unobserve(listener)
    },
    () => text?.toString() ?? '',
  )
}

function RenderedMarkdown({ controller, cell, assets }: { controller: NotebookController; cell: NotebookCellState; assets: LiveAssetStore }) {
  const source = useSourceText(controller, cell.key)
  const attachments = useResolved<Record<string, MimeBundle>>(() => readAttachments(cell.attachments, assets), [cell.attachments, assets], {})
  if (!source.trim()) return <p className="px-2.5 py-2 text-sm text-muted-foreground italic">{ui("Empty Markdown cell. Double-click to edit.")}</p>
  return <div className="min-w-0 px-2.5 py-1 text-sm"><NotebookMarkdown source={source} attachments={attachments} /></div>
}

function outputKey(output: NotebookOutput, index: number): string {
  const content = JSON.stringify(output)
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index += 1) hash = Math.imul(hash ^ content.charCodeAt(index), 0x01000193)
  return `${index}:${hash >>> 0}`
}

function CellOutputs({ cell, assets, dark, controller, editable }: { cell: NotebookCellState; assets: LiveAssetStore; dark: boolean; controller: NotebookController; editable: boolean }) {
  const view = useNotebookView()
  const outputs = useResolved<NotebookOutput[]>(() => (cell.outputs ? readOutputs(cell.outputs, assets) : Promise.resolve([])), [cell.outputs, assets], [])
  // Sandboxed outputs render once per mount, so changed content needs a new frame.
  const keys = useMemo(() => outputs.map(outputKey), [outputs])
  if (!outputs.length) return null
  if (cell.outputsCollapsed && !view.revealed.has(`${cell.key}:outputs`)) {
    return (
      <div className="flex min-w-0 gap-2">
        <div className="w-10 shrink-0 sm:w-14" />
        <button
          type="button"
          onClick={() => {
            // Editors show them for everyone; viewers only for themselves.
            if (!editable) return view.reveal(`${cell.key}:outputs`)
            controller.select(cell.key)
            controller.toggleOutputs()
            view.focusNotebook()
          }}
          className="h-6 flex-1 cursor-pointer rounded border border-dashed text-left text-xs text-muted-foreground hover:bg-accent"
        >
          <span className="px-2">{outputs.length === 1 ? ui("1 output hidden") : uit`${outputs.length} outputs hidden`}</span>
        </button>
      </div>
    )
  }
  return (
    <div className="min-w-0" data-cell-outputs>
      <OutputScroll cellKey={cell.key}>
        {outputs.map((output, index) => (
          <div key={keys[index]} className="flex min-w-0 gap-2">
            <Prompt kind="out" count={output.type === 'execute_result' ? output.executionCount : null} />
            <div className="min-w-0 flex-1 overflow-x-auto">
              <OutputBody output={output} dark={dark} />
            </div>
          </div>
        ))}
      </OutputScroll>
    </div>
  )
}

function PeerBadges({ peers }: { peers: readonly NotebookPeer[] }) {
  if (!peers.length) return null
  return (
    <div className="pointer-events-none absolute -top-2.5 right-2 z-10 flex gap-1">
      {peers.map((peer) => (
        <span key={peer.clientId} className="rounded px-1.5 py-px text-[10px] leading-4 font-semibold text-white shadow-sm" style={{ backgroundColor: peer.color }}>
          {peer.name}
        </span>
      ))}
    </div>
  )
}

const NotebookCell = memo(function NotebookCell(props: CellProps) {
  const { controller, cell, index, active, selected, mode, peers, language, editable, dark, assets, registerEditor, dropEdge } = props
  const ref = useRef<HTMLElement>(null)
  const view = useNotebookView()
  const editing = active && mode === 'edit'
  // A find match here shows the source (rendered Markdown too), with the match marked.
  const found = useCurrentMatchIn(view.search, cell.key)
  const near = useNearViewport(ref, editing || found)
  const showEditor = cell.type !== 'markdown' || editing || found
  const sourceHidden = cell.sourceCollapsed && !editing && !found && !view.revealed.has(`${cell.key}:source`)
  const highlight = cell.type === 'code' ? language : cell.type === 'markdown' ? 'markdown' : null

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <section
      ref={ref}
      aria-label={uit`Cell ${index + 1}, ${typeLabel(cell.type)}`}
      aria-current={active ? 'true' : undefined}
      data-cell={cell.type}
      data-cell-key={cell.key}
      data-active={active || undefined}
      data-selected={selected || undefined}
      data-mode={active ? mode : undefined}
      className={cn('group/cell relative flex flex-col gap-1.5 rounded-lg py-1.5 pr-2', selected && !editing && 'bg-primary/[0.06]')}
      onMouseDown={(event) => {
        // Clicking a cell selects it (Shift extends); clicks inside its editor enter edit mode on focus.
        if ((event.target as HTMLElement).closest('[data-cell-source], button, a, iframe')) return
        // A right-click (or a Mac's Control-click) on a selected cell keeps the selection, for its context menu to act on.
        if ((event.button === 2 || (mac && event.ctrlKey)) && selected) return
        controller.select(cell.key, { extend: event.shiftKey })
      }}
      onDoubleClick={(event) => {
        if (cell.type === 'markdown' && editable && !(event.target as HTMLElement).closest('a, button')) controller.select(cell.key, { mode: 'edit' })
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('application/x-pulpo-notebook-cell')) return
        event.preventDefault()
        const box = event.currentTarget.getBoundingClientRect()
        props.onDragOverCell(cell.key, event.clientY < box.top + box.height / 2 ? 'before' : 'after')
      }}
      onDragLeave={() => props.onDragOverCell(cell.key, null)}
      onDrop={(event) => {
        event.preventDefault()
        if (dropEdge) props.onDrop(cell.key, dropEdge)
      }}
    >
      {dropEdge && <div className={cn('pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded bg-primary', dropEdge === 'before' ? '-top-1' : '-bottom-1')} />}
      <div className={cn('absolute inset-y-1 left-0 w-1 rounded-full', active ? (editing ? 'bg-emerald-500' : 'bg-primary') : peers[0] ? '' : 'bg-transparent')} style={!active && peers[0] ? { backgroundColor: peers[0].color } : undefined} />
      <PeerBadges peers={peers} />
      <div className="flex min-w-0 gap-2 pl-2">
        <div className="relative flex w-10 shrink-0 flex-col items-end sm:w-12">
          {cell.type === 'code' ? <Prompt kind="in" count={cell.executionCount} /> : <div className="pt-2 text-[11px] text-muted-foreground/0">·</div>}
          {editable && (
            <span
              draggable
              role="button"
              tabIndex={-1}
              aria-label={ui("Drag to move")}
              title={ui("Drag to move")}
              onDragStart={(event) => props.onDragStart(cell.key, event)}
              className="mt-1 cursor-grab text-muted-foreground opacity-0 group-hover/cell:opacity-60 hover:opacity-100 active:cursor-grabbing"
            >
              <GripVertical className="size-4" />
            </span>
          )}
        </div>
        <div className={cn('flex min-w-0 flex-1 flex-col rounded-md', cell.type !== 'markdown' || editing ? 'border bg-code' : '', editing && 'ring-1 ring-emerald-500/50')}>
          {sourceHidden ? (
            <button
              type="button"
              onClick={() => {
                // Editors show it for everyone; viewers only for themselves.
                if (!editable) return view.reveal(`${cell.key}:source`)
                controller.select(cell.key)
                controller.toggleSource()
                view.focusNotebook()
              }}
              className="h-7 cursor-pointer px-2.5 text-left text-xs text-muted-foreground"
            >
              {ui("Source hidden")}
            </button>
          ) : showEditor ? (
            near
              ? <CellSource controller={controller} cell={cell} language={language} editable={editable} dark={dark} registerEditor={registerEditor} autoFocus={editing} />
              : <StaticSource controller={controller} cellKey={cell.key} language={highlight} lineNumbers={view.lineNumbers} />
          ) : (
            <RenderedMarkdown controller={controller} cell={cell} assets={assets} />
          )}
        </div>
        {active && editable && <CellToolbar controller={controller} cell={cell} mode={mode} focusNotebook={view.focusNotebook} />}
      </div>
      {cell.type === 'code' && <CellOutputs cell={cell} assets={assets} dark={dark} controller={controller} editable={editable} />}
    </section>
  )
})

/** "+ Code" and "+ Markdown" between cells, as Colab offers them. */
function InsertBar({ onInsert, always }: { onInsert: (type: NotebookCellType) => void; always?: boolean }) {
  return (
    <div className={cn('group/insert flex h-4 items-center justify-center gap-2', always && 'h-auto py-3')}>
      <div className={cn('flex gap-2 transition-opacity', always ? 'opacity-100' : 'opacity-0 group-hover/insert:opacity-100 focus-within:opacity-100')}>
        <Button type="button" variant="outline" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => onInsert('code')}><Plus className="size-3" /> {ui("Code")}</Button>
        <Button type="button" variant="outline" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => onInsert('markdown')}><Plus className="size-3" /> {ui("Markdown")}</Button>
      </div>
    </div>
  )
}

function writeClipboard(text: string) {
  if (text) void navigator.clipboard?.writeText(text).catch(() => undefined)
}

/** What a cell's outputs print, as plain text (tracebacks without their colors). */
function outputsText(outputs: readonly NotebookOutput[]): string {
  return outputs.map((output) => stripAnsi(outputPlainText(output)).replace(/\n+$/, '')).filter(Boolean).join('\n')
}

/** A name without its notebook extension, for files exported from it ("analysis.ipynb" gives "analysis"). */
function baseName(name: string): string {
  return name.replace(/\.ipynb$/i, '') || 'notebook'
}

/**
 * The right-clicked cell, or null to leave the browser's own menu: in a cell's text (as in any
 * editor), on links, pictures, frames, and fields, over selected text, and with Shift held.
 */
function contextCell(event: React.MouseEvent, list: HTMLElement): string | null {
  if (event.shiftKey || !(event.target instanceof Element)) return null
  const target = event.target
  const cell = target.closest<HTMLElement>('[data-cell-key]')
  if (!cell || !list.contains(cell)) return null
  if (target.closest('.cm-content, .cm-panels, [data-static-source], a[href], img, iframe, input, textarea, select')) return null
  if (textSelectedIn(cell)) return null
  return cell.dataset.cellKey ?? null
}

/**
 * Whether text is selected in an output or rendered Markdown inside an element. A cell editor's
 * selection does not count: it stays on the page after Escape, when C copies the cell.
 */
function textSelectedIn(element: HTMLElement): boolean {
  const selection = window.getSelection()
  const anchor = selection?.anchorNode
  const node = anchor instanceof Element ? anchor : anchor?.parentElement
  return Boolean(selection && !selection.isCollapsed && selection.toString() && node && element.contains(node) && !node.closest('.cm-editor'))
}

/**
 * Jupyter notebooks, edited collaboratively: cells in CodeMirror (code highlighted in the kernel's
 * language, Markdown rendered when not editing), outputs as the notebook viewer shows them (HTML
 * and scripts only in the sandbox), Jupyter's command and edit modes and keys, and other sessions'
 * cursors and cells. Cells don't run in the browser; agents run notebooks in their sandbox.
 */
export function NotebookDocEditor({ session, name, editable, width, toolbarSlot, assets: givenAssets, onRunWithAgent, fileMenu, onSaveShortcut }: LiveEditorProps) {
  const [fallbackAssets] = useState(() => new MemoryLiveAssetStore())
  const assets = givenAssets ?? fallbackAssets
  const [controller, setController] = useState<NotebookController | null>(null)
  const editors = useRef(new Map<string, CellEditor>())
  const shell = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const dark = useDarkTheme()
  const [shortcuts, setShortcuts] = useState(false)
  const [search, setSearch] = useState<NotebookSearch | null>(null)
  const [find, setFind] = useState<NotebookFindRequest | null>(null)
  const [lineNumbers, setLineNumbers] = useStoredFlag(NOTEBOOK_PREFERENCES.lineNumbers)
  const [wrap, setWrap] = useStoredFlag(NOTEBOOK_PREFERENCES.wrap)
  const [outlinePinned, setOutlinePinned] = useStoredFlag(NOTEBOOK_PREFERENCES.outline)
  // In the side panel the outline floats over the cells, so it opens only when asked there.
  const [outlineFloating, setOutlineFloating] = useState(false)
  const outline = width === 'fill' ? outlineFloating : outlinePinned
  const setOutline = width === 'fill' ? setOutlineFloating : setOutlinePinned
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [cursor] = useState(() => new CursorStore())
  const findOpen = useRef(false)
  findOpen.current = Boolean(find)
  const pasteFallback = useRef<number | undefined>(undefined)
  const [drag, setDrag] = useState<{ keys: string[]; over: { key: string; edge: 'before' | 'after' } | null } | null>(null)
  const [cellMenu, setCellMenu] = useState<{ request: CellMenuRequest; open: boolean } | null>(null)
  // The right-clicked cell's output text, read as its menu opens so Copy output text copies at once.
  const menuOutputs = useRef<{ key: string; text: string | null } | null>(null)
  // A cell inserted with text to type after (Insert ▸ Heading) puts the caret at its end.
  const caretAtEnd = useRef<string | null>(null)
  const caretAtEndTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(caretAtEndTimer.current), [])
  const latestEditable = useRef(editable)
  latestEditable.current = editable

  useEffect(() => {
    const created = new NotebookController({
      doc: session.doc,
      awareness: session.provider.awareness,
      assets,
      readOnly: !latestEditable.current,
      user: { name: sessionLabel(), color: sessionColor(session.doc.clientID) },
    })
    created.setCursorProvider((key) => editors.current.get(key)?.cursor() ?? null)
    const finder = new NotebookSearch(created)
    setController(created)
    setSearch(finder)
    return () => {
      finder.destroy()
      created.destroy()
    }
  }, [session, assets])
  useEffect(() => () => cursor.destroy(), [cursor])

  useEffect(() => { controller?.setReadOnly(!editable) }, [controller, editable])

  const noState = useMemo(() => () => () => {}, [])
  const state = useSyncExternalStore(controller?.subscribe ?? noState, () => controller?.getState() ?? null)
  const registerEditor = useCallback((key: string, editor: CellEditor | null) => {
    if (editor) editors.current.set(key, editor)
    else editors.current.delete(key)
    if (editor && caretAtEnd.current === key) editor.focus('end')
  }, [])

  /** Gives the keyboard back to the notebook after a menu or button: the active cell's editor while editing, else the cell list. */
  const focusNotebook = useCallback(() => {
    const current = controller?.getState()
    const editor = current?.mode === 'edit' && current.active ? editors.current.get(current.active) : undefined
    if (editor) editor.focus('keep')
    else root.current?.focus({ preventScroll: true })
  }, [controller])

  /** Opens (or focuses) the find bar, seeded with the cell's selected text when it is one line, as VS Code does. */
  const openFind = useCallback((mode: 'find' | 'replace', key?: string | null) => {
    const state = key ? editors.current.get(key)?.view.state : undefined
    const selected = state ? state.sliceDoc(state.selection.main.from, state.selection.main.to) : ''
    setFind((current) => ({ mode, text: selected.includes('\n') ? '' : selected, nonce: (current?.nonce ?? 0) + 1 }))
  }, [])

  // Cells are memoized, so what they read from the view changes only with what it holds, not on every render.
  const view = useMemo<NotebookView | null>(() => search && {
    lineNumbers,
    wrap,
    search,
    cursor,
    onFind: (key, command) => {
      if ((command === 'next' || command === 'previous') && findOpen.current) search.step(command === 'next' ? 1 : -1)
      else openFind(command === 'replace' ? 'replace' : 'find', key)
    },
    revealed,
    reveal: (id) => setRevealed((current) => new Set(current).add(id)),
    expanded,
    toggleExpanded: (key) => setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    }),
    focusNotebook,
  }, [lineNumbers, wrap, search, cursor, openFind, revealed, expanded, focusNotebook])

  /** Shift+O: the selected cells' long outputs show in full, or scroll again once all of them do. */
  const toggleOutputScroll = useCallback(() => {
    const keys = controller?.getState().selected ?? []
    setExpanded((current) => {
      const next = new Set(current)
      const all = keys.every((key) => current.has(key))
      for (const key of keys) {
        if (all) next.delete(key)
        else next.add(key)
      }
      return next
    })
  }, [controller])

  // Keys that change the view, not the notebook (find, line numbers, help, output scrolling).
  useEffect(() => {
    if (!controller) return
    controller.setViewCommandHandler((command) => {
      if (command === 'find' || command === 'replace') openFind(command, controller.getState().mode === 'edit' ? controller.getState().active : null)
      else if (command === 'lineNumbers') setLineNumbers((on) => !on)
      else if (command === 'shortcuts') setShortcuts(true)
      else toggleOutputScroll()
      return true
    })
    return () => controller.setViewCommandHandler(null)
  }, [controller, openFind, setLineNumbers, toggleOutputScroll])

  // Ctrl/Cmd+V in command mode: the system clipboard's text, which may be cells copied here (see onKeyDown).
  useEffect(() => {
    if (!controller) return
    const onPaste = (event: ClipboardEvent) => {
      const state = controller.getState()
      if (document.activeElement !== root.current || state.mode !== 'command' || state.readOnly) return
      event.preventDefault()
      window.clearTimeout(pasteFallback.current)
      void controller.pasteText(event.clipboardData?.getData('text/plain') ?? '')
    }
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('paste', onPaste)
      window.clearTimeout(pasteFallback.current)
    }
  }, [controller])

  // When the active cell or mode changes (never on others' edits, which must not pull focus back
  // from the chat or a menu), edit mode focuses the cell's editor and command mode keeps keys on
  // the notebook. A cell mounted to be edited focuses itself (CellSource's autoFocus).
  const active = state?.active ?? null
  const mode = state?.mode ?? 'command'
  useEffect(() => {
    if (!active) return
    if (mode === 'edit') {
      const editor = editors.current.get(active)
      if (editor && !editor.view.hasFocus) editor.focus('keep')
    } else if (root.current && document.activeElement !== root.current && (root.current.contains(document.activeElement) || document.activeElement === document.body)) {
      // A rendered Markdown cell's editor is gone, which leaves focus on the page: keys stay with the notebook.
      root.current.focus({ preventScroll: true })
    }
  }, [active, mode])

  /**
   * Prints the notebook as the viewer renders it, from the same export downloads use. An export
   * that fails (its images unavailable offline, say) prints nothing.
   */
  const htmlLabels = () => ({ empty: ui("This notebook has no cells."), widget: ui("Interactive widgets need a running kernel and are not shown."), unsupported: ui("This output type can’t be shown") })
  const printNotebook = () => {
    void exportNotebookFile(session.doc, { assets }).then((bytes) => {
      const model = parseNotebook(new TextDecoder().decode(bytes))
      printHtmlDocument(renderNotebookHtml(model, { title: name, labels: htmlLabels() }))
    }).catch(() => undefined)
  }

  useEditorShortcuts(shell, {
    print: printNotebook,
    save: onSaveShortcut,
    shortcuts: () => setShortcuts(true),
    focus: focusNotebook,
  })

  if (!controller || !state || !search || !view) return null
  const selected = new Set(state.selected)
  const canEdit = editable && !state.readOnly
  const run = (action: () => void) => () => {
    action()
    focusNotebook()
  }
  /** Opens a cell's context menu, selecting the cell unless it is part of the selection already. */
  const openCellMenu = (key: string, x: number, y: number) => {
    if (!controller.getState().selected.includes(key)) controller.select(key)
    const cell = controller.getState().cells.find((entry) => entry.key === key)
    menuOutputs.current = { key, text: null }
    if (cell?.type === 'code' && cell.outputs && cell.outputs.json !== '[]') {
      void readOutputs(cell.outputs, assets).then((outputs) => {
        if (menuOutputs.current?.key === key) menuOutputs.current = { key, text: outputsText(outputs) }
      }).catch(() => undefined)
    }
    setCellMenu({ request: { key, x, y }, open: true })
  }
  /** The active cell's menu, beside it (the keyboard's menu key, or Shift+F10). */
  const openActiveCellMenu = (): boolean => {
    const key = controller.getState().active
    const box = [...root.current?.querySelectorAll<HTMLElement>('[data-cell-key]') ?? []].find((element) => element.dataset.cellKey === key)?.getBoundingClientRect()
    if (!key || !box) return false
    openCellMenu(key, box.left + 56, box.top + 8)
    return true
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (state.mode !== 'command' || event.target !== root.current) return
    // A pending Ctrl+M chord takes the next key, whatever it is.
    if (controller.handleChordKey(event)) {
      event.preventDefault()
      return
    }
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey
    const primary = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
    // Ctrl/Cmd+C copies text selected in an output or rendered Markdown, as it does anywhere else.
    if (primary && (key === 'c' || key === 'x') && textSelectedIn(root.current)) return
    if ((plain || primary) && (key === 'c' || key === 'x')) {
      event.preventDefault()
      writeClipboard(key === 'c' ? controller.copy() : controller.cut())
      return
    }
    if (primary && key === 'v') {
      // The paste event that follows brings the system clipboard's text; where a browser sends
      // none to the cell list, cells copied on this page still paste.
      window.clearTimeout(pasteFallback.current)
      pasteFallback.current = window.setTimeout(() => { if (controller.getState().canPaste) void controller.paste('below') }, 0)
      return
    }
    // Shift+F10 and the menu key open the active cell's menu, as on any focused item in Windows and Linux.
    if (((key === 'F10' && event.shiftKey) || (key === 'ContextMenu' && !event.shiftKey)) && plain) {
      if (openActiveCellMenu()) event.preventDefault()
      return
    }
    // F3 and Ctrl/Cmd+G find the next match here too, as in a cell: stepping to another cell leaves the keyboard here.
    const findMod = mac ? event.metaKey : event.ctrlKey
    if (!event.altKey && ((key === 'F3' && !event.metaKey && !event.ctrlKey) || (findMod && key === 'g'))) {
      event.preventDefault()
      if (findOpen.current) search.step(event.shiftKey ? -1 : 1)
      else openFind('find')
      return
    }
    if (controller.handleCommandKey(event)) event.preventDefault()
  }
  const closeFind = (match: NotebookSearchMatch | null) => {
    setFind(null)
    const editor = match ? editors.current.get(match.key) : undefined
    if (!match || !editor || !canEdit) return focusNotebook()
    // As after finding in a browser or Word, the match stays selected, ready to type over.
    controller.select(match.key, { mode: 'edit' })
    editor.select(match.from, match.to)
    editor.focus('keep')
  }
  const activeIndex = state.cells.findIndex((cell) => cell.key === state.active)
  const activeCell = state.cells.find((cell) => cell.key === state.active)
  const locale = activeLocale()

  // File > Download: the notebook as a script (Colab's .py) or as a static web page (nbconvert's HTML).
  const downloadScript = () => {
    const script = notebookToScript(session.doc)
    saveFile(new TextEncoder().encode(script.text), `${baseName(name)}${script.extension}`, script.mimeType)
  }
  const downloadHtml = () => {
    void (async () => {
      const { default: katex } = await import('katex')
      const html = await notebookToHtml(session.doc, { assets }, {
        title: name,
        labels: htmlLabels(),
        // MathML needs no style sheet, so the page shows its formulas anywhere.
        renderMath: (tex, display) => katex.renderToString(tex, { displayMode: display, output: 'mathml', throwOnError: false }),
      })
      saveFile(new TextEncoder().encode(html), `${baseName(name)}.html`, 'text/html')
    })().catch(() => {
      useFileToasts.getState().show({ message: ui("Couldn't download the notebook as a web page"), tone: 'error' })
    })
  }
  const downloads = (): MenuEntry[] => {
    const { extension } = notebookToScript(session.doc)
    return [
      { type: 'item', id: 'download-script', label: extension === '.py' ? ui("Python (.py)") : ui("Script ({{extension}})", { extension }), onSelect: downloadScript },
      { type: 'item', id: 'download-html', label: ui("Web page (.html)"), onSelect: downloadHtml },
    ]
  }

  const menuContext: NotebookMenuContext = {
    controller,
    editable,
    copy: () => writeClipboard(controller.copy()),
    cut: () => writeClipboard(controller.cut()),
    find: (findMode) => openFind(findMode, controller.getState().mode === 'edit' ? controller.getState().active : null),
    outline,
    toggleOutline: () => setOutline((open) => !open),
    lineNumbers,
    setLineNumbers,
    wrap,
    setWrap,
    outputsScroll: () => !controller.getState().selected.every((key) => expanded.has(key)),
    toggleOutputScroll,
    revealed: (key, part) => revealed.has(`${key}:${part}`),
    reveal: (keys, part) => setRevealed((current) => {
      const next = new Set(current)
      for (const key of keys) next.add(`${key}:${part}`)
      return next
    }),
    insertHeading: (level) => {
      const key = controller.insert('below', 'markdown', { edit: true, source: `${'#'.repeat(level)} ` })
      if (!key) return
      // The cell's editor mounts after this (twice under React's strict mode): each one it mounts
      // puts the caret after the #s, until the cell has settled.
      caretAtEnd.current = key
      editors.current.get(key)?.focus('end')
      window.clearTimeout(caretAtEndTimer.current)
      caretAtEndTimer.current = window.setTimeout(() => { caretAtEnd.current = null }, CARET_HINT_MS)
    },
    copyOutputText: (key) => {
      const read = menuOutputs.current
      if (read?.key === key && read.text !== null) return writeClipboard(read.text)
      const cell = controller.getState().cells.find((entry) => entry.key === key)
      if (cell?.outputs) void readOutputs(cell.outputs, assets).then((outputs) => writeClipboard(outputsText(outputs))).catch(() => undefined)
    },
    runWithAgent: onRunWithAgent,
  }
  const menus: MenuDefinition[] = [
    fileMenuDefinition(fileMenu, () => ({ print: printNotebook, downloads: downloads() })),
    ...notebookMenus(menuContext),
    helpMenu(() => setShortcuts(true)),
  ]

  const onContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    const list = root.current
    if (!list) return
    // The keyboard's menu key on the cell list, where the browser sends it: the active cell's menu.
    // Chrome marks it with an empty pointer type; other browsers send a plain mouse event with the
    // primary button, which a Mac's Control-click also does (with Control held).
    const pointer = (event.nativeEvent as Partial<PointerEvent>).pointerType
    const keyboard = pointer === '' || (pointer === undefined && event.button !== 2 && !event.ctrlKey)
    if (event.target === list && keyboard) {
      if (openActiveCellMenu()) event.preventDefault()
      return
    }
    const key = contextCell(event, list)
    if (!key) return
    event.preventDefault()
    openCellMenu(key, event.clientX, event.clientY)
  }

  return (
    <div ref={shell} className="flex h-full min-h-0 flex-col" data-notebook-editor {...fileEditorRoot('notebook')}>
      <EditorMenuBar menus={menus} onClose={focusNotebook} className="px-3 pt-0.5 sm:px-5" />
      <div className="flex flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-1.5 sm:px-6">
        <div role="toolbar" aria-label={ui("Notebook")} className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
          <ToolbarButton label={ui("Undo")} shortcut={{ label: `${mod}Z`, aria: `${mac ? 'Meta' : 'Control'}+z` }} disabled={!canEdit || !state.canUndo} onClick={run(() => controller.undo())}><Undo2 className="size-4" /></ToolbarButton>
          <ToolbarButton label={ui("Redo")} disabled={!canEdit || !state.canRedo} onClick={run(() => controller.redo())}><Redo2 className="size-4" /></ToolbarButton>
          <span className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton label={ui("Insert cell below")} shortcut={{ label: 'B', aria: 'b' }} disabled={!canEdit} onClick={() => controller.insert('below', 'code', { edit: true })}><Plus className="size-4" /></ToolbarButton>
          <ToolbarButton label={ui("Cut cells")} shortcut={{ label: 'X', aria: 'x' }} disabled={!canEdit || !state.active} onClick={run(() => writeClipboard(controller.cut()))}><Scissors className="size-4" /></ToolbarButton>
          <ToolbarButton label={ui("Copy cells")} shortcut={{ label: 'C', aria: 'c' }} disabled={!state.active} onClick={run(() => writeClipboard(controller.copy()))}><Copy className="size-4" /></ToolbarButton>
          <ToolbarButton label={ui("Paste cells below")} shortcut={{ label: 'V', aria: 'v' }} disabled={!canEdit || !state.canPaste} onClick={run(() => void controller.paste('below'))}><ClipboardPaste className="size-4" /></ToolbarButton>
          <span className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton label={ui("Move cell up")} disabled={!canEdit || !state.active} onClick={run(() => controller.move('up'))}><ArrowUp className="size-4" /></ToolbarButton>
          <ToolbarButton label={ui("Move cell down")} disabled={!canEdit || !state.active} onClick={run(() => controller.move('down'))}><ArrowDown className="size-4" /></ToolbarButton>
          <ToolbarButton label={ui("Delete cells")} shortcut={{ label: 'D, D', aria: 'd' }} disabled={!canEdit || !state.active} onClick={run(() => controller.deleteSelected())}><Trash2 className="size-4" /></ToolbarButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={!canEdit || !activeCell}
                aria-label={ui("Cell type")}
                className="flex h-8 cursor-pointer items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                {activeCell ? typeLabel(activeCell.type) : ui("Code")}
                <ChevronDown className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              onCloseAutoFocus={(event) => {
                // Keys go on working in the notebook, not on the menu's button.
                event.preventDefault()
                focusNotebook()
              }}
            >
              {(['code', 'markdown', 'raw'] as const).map((type) => (
                <DropdownMenuItem key={type} onSelect={() => controller.setType(type)}>
                  {typeLabel(type)}
                  <span className="ml-auto pl-4 text-xs text-muted-foreground">{type === 'code' ? 'Y' : type === 'markdown' ? 'M' : 'R'}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton label={ui("Split cell at the cursor")} disabled={!canEdit || state.mode !== 'edit'} onClick={() => controller.split()}><SplitSquareVertical className="size-4" /></ToolbarButton>
          <ToolbarButton label={ui("Merge cells")} shortcut={{ label: 'Shift+M', aria: 'Shift+m' }} disabled={!canEdit || !state.active} onClick={run(() => controller.merge())}><Merge className="size-4" /></ToolbarButton>
          <ToolbarButton label={ui("Hide or show outputs")} shortcut={{ label: 'O', aria: 'o' }} disabled={!canEdit || !state.active} onClick={run(() => controller.toggleOutputs())}><ChevronsDownUp className="size-4" /></ToolbarButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" disabled={!canEdit} aria-label={ui("Clear outputs")} title={ui("Clear outputs")} className="grid size-8 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40">
                <Eraser className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              onCloseAutoFocus={(event) => {
                event.preventDefault()
                focusNotebook()
              }}
            >
              <DropdownMenuItem disabled={!state.active} onSelect={() => controller.clearOutputs('selected')}>{ui("Clear outputs of selected cells")}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => controller.clearOutputs('all')}>{ui("Clear all outputs")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton label={ui("Find and replace")} shortcut={{ label: `${mod}F`, aria: `${mac ? 'Meta' : 'Control'}+f` }} onClick={() => openFind('find', state.mode === 'edit' ? state.active : null)}><Search className="size-4" /></ToolbarButton>
          <ToolbarButton label={ui("Table of contents")} active={outline} onClick={() => setOutline((open) => !open)}><ListTree className="size-4" /></ToolbarButton>
          <NotebookViewMenu entries={() => viewOptionEntries(menuContext)} focusNotebook={focusNotebook} />
          <ToolbarButton label={ui("Keyboard shortcuts")} onClick={() => setShortcuts(true)}><Keyboard className="size-4" /></ToolbarButton>
          {onRunWithAgent && (
            <>
              <span className="mx-1 h-5 w-px bg-border" />
              <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={onRunWithAgent} title={ui("Open a chat that asks an agent to run this notebook and save its outputs")}>
                <Play className="size-3.5" /> {ui("Run with agent")}
              </Button>
            </>
          )}
        </div>
        {toolbarSlot}
      </div>
      {find && <NotebookFindBar search={search} request={find} readOnly={!canEdit} onClose={closeFind} />}
      <div className="relative flex min-h-0 flex-1">
        {outline && (
          <NotebookOutline
            doc={session.doc}
            activeIndex={activeIndex}
            overlay={width === 'fill'}
            onJump={(key) => {
              root.current?.querySelector(`[data-cell-key="${key}"]`)?.scrollIntoView({ block: 'start' })
              controller.select(key)
              if (width === 'fill') setOutline(false)
              root.current?.focus({ preventScroll: true })
            }}
            onClose={() => {
              setOutline(false)
              focusNotebook()
            }}
          />
        )}
        <div
          ref={root}
          tabIndex={0}
          role="list"
          aria-label={ui("Notebook cells")}
          onKeyDown={onKeyDown}
          onContextMenu={onContextMenu}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto outline-none"
          onDragEnd={() => setDrag(null)}
        >
          <NotebookViewContext.Provider value={view}>
            <div className={cn('mx-auto flex w-full flex-col py-4 pr-3 pl-1 sm:pr-6', width === 'narrow' ? 'max-w-4xl' : width === 'wide' ? 'max-w-6xl' : '')}>
              {!state.cells.length && <p className="p-8 text-center text-sm text-muted-foreground">{ui("This notebook has no cells.")}</p>}
              {state.cells.map((cell, index) => (
                <div key={cell.key} role="listitem">
                  {index > 0 && canEdit && (
                    <InsertBar onInsert={(type) => {
                      controller.select(state.cells[index - 1]!.key)
                      controller.insert('below', type, { edit: true })
                    }} />
                  )}
                  <NotebookCell
                    controller={controller}
                    cell={cell}
                    index={index}
                    active={cell.key === state.active}
                    selected={selected.has(cell.key)}
                    mode={state.mode}
                    peers={state.peers[cell.key] ?? NO_PEERS}
                    language={state.language}
                    editable={canEdit}
                    dark={dark}
                    assets={assets}
                    registerEditor={registerEditor}
                    dropEdge={drag?.over?.key === cell.key ? drag.over.edge : null}
                    onDragStart={(key, event) => {
                      const keys = selected.has(key) ? state.selected : [key]
                      event.dataTransfer.setData('application/x-pulpo-notebook-cell', keys.join(','))
                      event.dataTransfer.effectAllowed = 'move'
                      const section = (event.target as HTMLElement).closest('section')
                      if (section) event.dataTransfer.setDragImage(section, 20, 20)
                      setDrag({ keys, over: null })
                    }}
                    onDragOverCell={(key, edge) => setDrag((current) => current && (edge ? { ...current, over: { key, edge } } : current.over?.key === key ? { ...current, over: null } : current))}
                    onDrop={(key, edge) => {
                      if (drag && !drag.keys.includes(key)) controller.moveTo(drag.keys, edge === 'before' ? { before: key } : { after: key })
                      setDrag(null)
                    }}
                  />
                </div>
              ))}
              {canEdit && <InsertBar always onInsert={(type) => {
                const last = state.cells[state.cells.length - 1]
                if (last) controller.select(last.key)
                controller.insert('below', type, { edit: true })
              }} />}
            </div>
          </NotebookViewContext.Provider>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 border-t px-4 py-1 text-[11px] text-muted-foreground tabular-nums sm:px-6" aria-live="off">
        <span>{state.mode === 'edit' ? ui("Edit mode") : ui("Command mode")}</span>
        <NotebookPosition cursor={cursor} state={state} />
        {state.selected.length > 1 && <span>{uit`${state.selected.length} cells selected`}</span>}
        <span className="flex-1" />
        {!editable && <span>{ui("Read-only")}</span>}
        <span>{state.kernel ?? state.language}</span>
        <span>{state.cells.length === 1 ? ui("1 cell") : uit`${state.cells.length.toLocaleString(locale)} cells`}</span>
      </div>
      <CellContextMenu
        request={cellMenu?.request ?? null}
        // It closes if someone else deletes the cell meanwhile.
        open={Boolean(cellMenu?.open && state.cells.some((cell) => cell.key === cellMenu.request.key))}
        entries={(key) => cellContextEntries(menuContext, key)}
        onOpenChange={(open) => setCellMenu((current) => current && { ...current, open })}
        onClosed={() => {
          // Back to the cells, unless the click that closed the menu put focus somewhere else (the chat).
          const focused = document.activeElement
          if (focused && focused !== document.body && !shell.current?.contains(focused)) return
          focusNotebook()
        }}
      />
      <ShortcutsDialog
        open={shortcuts}
        onOpenChange={setShortcuts}
        groups={() => shortcutGroupsFromMenus(menus, notebookShortcutGroups())}
        description={ui("Press Esc to leave a cell; these keys then work on the selected cells, as in Jupyter.")}
        returnFocus={focusNotebook}
      />
    </div>
  )
}

const NO_PEERS: readonly NotebookPeer[] = []

export default NotebookDocEditor

