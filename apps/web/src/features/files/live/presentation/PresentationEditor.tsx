import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { LiveAssetStore } from '@pulpo/client-core/office'
import { imageSize, NotesEditor, Presenter, printSlides, SlideCanvas, SlideList, type FindMatch, type PresentationController, type PresentationUser } from '@pulpo/client-core/office/presentation/view'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { Play, ZoomIn, ZoomOut } from 'lucide-react'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { EditorMenuBar } from '../chrome/EditorMenuBar'
import { fileEditorRoot } from '../chrome/editor-root'
import { fileMenuDefinition, type FileMenuHost } from '../chrome/file-menu'
import { LinkDialog } from '../chrome/LinkDialog'
import { separator, shortcutGroupsFromMenus, type MenuDefinition, type MenuEntry } from '../chrome/menu'
import { ShortcutsDialog } from '../chrome/ShortcutsDialog'
import { helpMenu } from '../chrome/standard-menus'
import { useEditorShortcuts } from '../chrome/use-editor-shortcuts'
import { zoomMenu } from '../chrome/zoom'
import { FormatPanel } from './FormatPanel'
import { PresentationContextMenu, type ContextMenuRequest } from './PresentationContextMenu'
import { PresentationFindBar } from './PresentationFindBar'
import {
  arrangeMenuEntries,
  asUndoSteps,
  canvasContextEntries,
  editMenuEntries,
  formatMenuEntries,
  insertMenuEntries,
  sectionEntries,
  shapeContextEntries,
  slideContextEntries,
  slideMenuEntries,
  type PresentationMenuHost,
} from './presentation-menus'
import { PRESENTATION_ZOOM_PRESETS, presentationShortcutGroups, ZOOM_FIT_SHORTCUT, ZOOM_IN_SHORTCUT, ZOOM_OUT_SHORTCUT } from './presentation-shortcuts'
import { PresentationStatusBar } from './PresentationStatusBar'
import { PresentationToolbar } from './PresentationToolbar'
import { SectionDialog } from './SectionDialog'
import { useControllerRevision, usePresentationController } from './use-presentation'

/**
 * The presentation editor: menu bar, toolbar, thumbnail strip, slide canvas, speaker notes,
 * status bar, format panel, slide sorter, find and replace, right-click menus, and present mode,
 * around the framework-agnostic view core in client-core.
 */
export interface PresentationEditorProps {
  doc: Y.Doc
  awareness?: Awareness
  readOnly: boolean
  assets: LiveAssetStore
  user: PresentationUser
  /** `.ppsx` decks open straight into the slide show. */
  startInShow?: boolean
  /** Rendered at the end of the toolbar (presence, sync status). */
  toolbarSlot?: ReactNode
  className?: string
  /** Hands the controller to the host (integration code and tests drive it directly). */
  onReady?(controller: PresentationController): void
  /** The Files page's File menu entries (see LiveEditorProps). */
  fileMenu?: FileMenuHost
  onSaveShortcut?: () => void
}

type Cell = { row: string; column: string }

/** What the view-core components call back into, read at call time (they live as long as the controller). */
interface ViewHandlers {
  canvasMenu(event: MouseEvent, shape: string | undefined, cell?: Cell): void
  slideMenu(event: MouseEvent, slide: string, from: 'strip' | 'sorter'): void
  sectionMenu(event: MouseEvent, section: string): void
  zoom(zoom: number, fit: boolean): void
  openSlide(slide: string): void
}

type SectionRequest = { mode: 'add'; firstSlide: string } | { mode: 'rename'; key: string; name: string }

const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/svg+xml,image/webp'

function openLink(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** Mounts a view-core component into a div for the lifetime of `controller`. */
function useMounted<T extends { destroy(): void }>(controller: PresentationController, create: (element: HTMLElement) => T): [React.RefObject<HTMLDivElement | null>, React.RefObject<T | null>] {
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<T | null>(null)
  useEffect(() => {
    if (!host.current) return
    const mounted = create(host.current)
    instance.current = mounted
    return () => {
      mounted.destroy()
      instance.current = null
    }
    // `create` closes over values that only change with the controller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller])
  return [host, instance]
}

export function PresentationEditor({ doc, awareness, readOnly, assets, user, ...props }: PresentationEditorProps) {
  const controller = usePresentationController({ doc, ...(awareness ? { awareness } : {}), readOnly, assets, user })
  if (!controller) return <div className={cn('h-full bg-background', props.className)} />
  return <PresentationEditorView controller={controller} {...props} />
}

function PresentationEditorView({ controller, startInShow, toolbarSlot, className, onReady, fileMenu, onSaveShortcut }: Pick<PresentationEditorProps, 'startInShow' | 'toolbarSlot' | 'className' | 'onReady' | 'fileMenu' | 'onSaveShortcut'> & { controller: PresentationController }) {
  useControllerRevision(controller)
  useEffect(() => {
    onReady?.(controller)
  }, [controller, onReady])
  const [view, setView] = useState<'editor' | 'sorter'>('editor')
  const [formatPanel, setFormatPanel] = useState(false)
  const [notesOpen, setNotesOpen] = useState(true)
  const [filmstrip, setFilmstrip] = useState(true)
  const [printing, setPrinting] = useState(false)
  const [printError, setPrintError] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [find, setFind] = useState<{ replace: boolean; request: number } | null>(null)
  // Dialogs keep what they were opened with while they fade out, so their titles do not change as they close.
  const [linkDialog, setLinkDialog] = useState<{ open: boolean; url?: string; showText: boolean }>({ open: false, showText: false })
  const [sectionDialog, setSectionDialog] = useState<{ open: boolean; request: SectionRequest }>({ open: false, request: { mode: 'add', firstSlide: '' } })
  const [contextMenu, setContextMenu] = useState<ContextMenuRequest>()
  const [zoom, setZoom] = useState({ zoom: 1, fit: true })
  const [alignTo, setAlignTo] = useState<'auto' | 'slide'>('auto')
  const presenter = useRef<Presenter | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const menuCount = useRef(0)
  const handlers = useRef<ViewHandlers>(null!)
  const [stripHost, strip] = useMounted(controller, (element) => new SlideList(element, controller, {
    layout: 'strip',
    onContextMenu: (event, key) => handlers.current.slideMenu(event, key, 'strip'),
    onSectionContextMenu: (event, key) => handlers.current.sectionMenu(event, key),
  }))
  const [canvasHost, canvas] = useMounted(controller, (element) => new SlideCanvas(element, controller, {
    onOpenLink: openLink,
    onContextMenu: (event, key, cell) => handlers.current.canvasMenu(event, key, cell),
    onZoomChange: (value, fit) => handlers.current.zoom(value, fit),
  }))
  const [notesHost, notes] = useMounted(controller, (element) => new NotesEditor(element, controller))
  const sorterHost = useRef<HTMLDivElement>(null)
  const sorter = useRef<SlideList | null>(null)

  useEffect(() => {
    if (view !== 'sorter' || !sorterHost.current) return
    // The sorter shows no shapes: a selection left behind would let Format and Arrange change
    // shapes nobody can see (PowerPoint's Slide Sorter selects only slides).
    if (controller.state.shapes.length || controller.state.editing) controller.selectShapes([])
    const mounted = new SlideList(sorterHost.current, controller, {
      layout: 'grid',
      onOpen: (key) => handlers.current.openSlide(key),
      onContextMenu: (event, key) => handlers.current.slideMenu(event, key, 'sorter'),
    })
    sorter.current = mounted
    return () => {
      mounted.destroy()
      sorter.current = null
    }
  }, [controller, view])

  /** Focus back in the document: the speaker notes while they take the formatting, else the slide (or its open text). */
  const focusDocument = () => {
    if (view === 'sorter') {
      sorter.current?.element.focus()
      return
    }
    if (controller.notesFocused) {
      const text = notes.current?.element.querySelector<HTMLElement>('[contenteditable]')
      if (text) {
        text.focus({ preventScroll: true })
        return
      }
    }
    canvas.current?.focus()
  }

  /** Where slide and section commands hand focus back: the list the slides are in. */
  const focusSlides = () => {
    if (view === 'sorter') sorter.current?.element.focus()
    else if (filmstrip) strip.current?.element.focus()
    else canvas.current?.focus()
  }

  const present = (mode: 'start' | 'current' | 'presenter') => {
    presenter.current?.exit()
    presenter.current = new Presenter(controller, {
      ...(mode !== 'start' && controller.state.slide ? { startAt: controller.state.slide } : {}),
      presenterView: mode === 'presenter',
      onExit: () => {
        presenter.current = null
        canvas.current?.focus()
      },
    })
  }

  const print = async () => {
    setPrinting(true)
    setPrintError(false)
    try {
      await printSlides(controller)
    } catch {
      setPrintError(true)
    } finally {
      setPrinting(false)
    }
  }

  const insertImage = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const size = await imageSize(file)
    await controller.insertImage(bytes, file.type || 'image/png', size, file.name.replace(/\.[^.]+$/, ''))
  }

  const openFind = (replace: boolean) => setFind((current) => ({ replace: replace || (current?.replace ?? false), request: (current?.request ?? 0) + 1 }))
  const closeFind = (shown?: FindMatch) => {
    setFind(null)
    // Nothing shown (no match, or the sorter still open): back to wherever the document was.
    if (!shown) {
      focusDocument()
      return
    }
    // Back to the text of the match shown, with it selected, as Docs and Slides do.
    if (shown.notes) {
      const text = notes.current?.element.querySelector<HTMLElement>('[contenteditable]')
      if (text) {
        text.focus({ preventScroll: true })
        return
      }
    }
    canvas.current?.focus()
  }

  /** Insert ▸ Link, Cmd/Ctrl+K: the dialog, filled in with the link at the selection. */
  const openLinkDialog = () => {
    if (controller.readOnly) return
    const format = controller.formatState()
    if (!format.canFormatText) return
    const editor = controller.state.editing && !controller.notesFocused ? controller.activeEditor : undefined
    // A caret outside a link can insert the link with text of its own.
    const caret = editor !== undefined && !editor.view.isDestroyed && editor.view.state.selection.empty
    setLinkDialog({ open: true, ...(format.link ? { url: format.link } : {}), showText: caret && !format.link })
  }

  const showContextMenu = (event: MouseEvent, entries: () => MenuEntry[], returnFocus: () => void) => {
    const request: ContextMenuRequest = { id: ++menuCount.current, x: event.clientX, y: event.clientY, entries: () => asUndoSteps(controller, entries()), returnFocus }
    // Open once the click that asked for it is over, so its release cannot dismiss the menu.
    setTimeout(() => setContextMenu(request), 0)
  }

  const host: PresentationMenuHost = {
    controller,
    view,
    openFind: (mode) => openFind(mode === 'replace'),
    openLink: openLinkDialog,
    openFormatPanel: () => {
      setView('editor')
      setFormatPanel(true)
    },
    openBackground: () => {
      controller.selectShapes([])
      setView('editor')
      setFormatPanel(true)
    },
    insertImage: () => imageInput.current?.click(),
    addSection: (firstSlide) => setSectionDialog({ open: true, request: { mode: 'add', firstSlide } }),
    renameSection: (key) => setSectionDialog({ open: true, request: { mode: 'rename', key, name: controller.sections().find((section) => section.key === key)?.name ?? '' } }),
    alignTo,
    setAlignTo,
  }
  // Menus read the host when they build their rows, so a menu left open sees the latest state.
  const hostRef = useRef(host)
  hostRef.current = host
  handlers.current = {
    canvasMenu: (event, shape, cell) => {
      // A right-click beside the shapes is about the slide: the selection (and text editing) ends.
      if (!shape && (controller.state.shapes.length || controller.state.editing)) controller.selectShapes([])
      showContextMenu(event, () => (shape ? shapeContextEntries(hostRef.current, shape, cell) : canvasContextEntries(hostRef.current)), () => canvas.current?.focus())
    },
    slideMenu: (event, slide, from) => {
      showContextMenu(event, () => slideContextEntries(hostRef.current, slide), () => (from === 'sorter' ? sorter.current : strip.current)?.element.focus())
    },
    sectionMenu: (event, section) => {
      showContextMenu(event, () => sectionEntries(hostRef.current, section), () => strip.current?.element.focus())
    },
    zoom: (value, fit) => setZoom((current) => (current.zoom === value && current.fit === fit ? current : { zoom: value, fit })),
    openSlide: (slide) => {
      controller.goToSlide(slide)
      setView('editor')
    },
  }

  // The view core asks for the find bar (Cmd/Ctrl+F, Ctrl+H or Cmd+Shift+H) and the link dialog (Cmd/Ctrl+K).
  useEffect(() => controller.onRequest((request) => {
    if (request === 'link') hostRef.current.openLink()
    else hostRef.current.openFind(request)
  }), [controller])

  useEffect(() => {
    if (startInShow) present('start')
    return () => presenter.current?.exit()
    // Only on first mount: a slideshow file opens in the show once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Only for this editor, and never from text fields (slide text, notes, or the rest of the page).
      const target = event.target instanceof Element ? event.target : null
      const inEditor = !target || target === document.body || root.current?.contains(target) === true
      const editable = target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
      // A running show takes its own keys (focus may still be on the menu that started it).
      if (!inEditor || editable || presenter.current) return
      // PowerPoint for Windows: F5 from the beginning, Shift+F5 from the current slide. Google Slides
      // and PowerPoint for Mac: Cmd/Ctrl+Enter from the current slide, with Shift from the beginning.
      const mode = event.key === 'F5' ? (event.shiftKey ? 'current' : 'start')
        : (event.metaKey || event.ctrlKey) && event.key === 'Enter' ? (event.shiftKey ? 'start' : 'current')
          : undefined
      if (!mode) return
      event.preventDefault()
      present(mode)
      // The key goes no further: the show now listens on the document, which this key has yet to
      // reach, and would take its Enter as "next slide".
      event.stopPropagation()
    }
    // Capturing, so this runs before the app's own Cmd/Ctrl+Shift+Enter (the side panel's).
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const readOnly = controller.readOnly
  useEditorShortcuts(root, {
    print: () => { void print() },
    save: onSaveShortcut,
    shortcuts: () => setShortcutsOpen(true),
    // Keys the slide, the strip, and the notes leave alone: from the toolbar, the find bar, a panel.
    find: () => openFind(false),
    ...(readOnly ? {} : { replace: () => openFind(true) }),
    focus: focusDocument,
  })

  const editorView = view === 'editor'
  const zoomEntry = zoomMenu({
    zoom: zoom.zoom,
    onZoom: (value) => canvas.current?.setZoom(value),
    presets: PRESENTATION_ZOOM_PRESETS,
    fitted: zoom.fit,
    onFit: () => canvas.current?.setZoom('fit'),
  })
  const zoomItems: MenuEntry[] = [
    { type: 'item', id: 'zoom-in', label: ui("Zoom in"), icon: ZoomIn, shortcut: ZOOM_IN_SHORTCUT, onSelect: () => canvas.current?.zoomIn() },
    { type: 'item', id: 'zoom-out', label: ui("Zoom out"), icon: ZoomOut, shortcut: ZOOM_OUT_SHORTCUT, onSelect: () => canvas.current?.zoomOut() },
    separator,
    ...(zoomEntry.type === 'submenu' ? zoomEntry.items.map((entry) => (entry.type === 'item' && entry.id === 'zoom-fit' ? { ...entry, shortcut: ZOOM_FIT_SHORTCUT } : entry)) : []),
  ]
  const menus: MenuDefinition[] = [
    fileMenuDefinition(fileMenu, () => ({ print: () => { void print() } })),
    { id: 'edit', label: ui("Edit"), items: () => asUndoSteps(controller, editMenuEntries(hostRef.current)) },
    {
      id: 'view',
      label: ui("View"),
      items: () => [
        { type: 'item', id: 'present', label: ui("Present from the beginning"), icon: Play, shortcut: { key: 'F5' }, onSelect: () => present('start') },
        { type: 'item', id: 'present-current', label: ui("Present from the current slide"), shortcut: { key: 'F5', shift: true }, onSelect: () => present('current') },
        { type: 'item', id: 'presenter-view', label: ui("Presenter view"), onSelect: () => present('presenter') },
        separator,
        { type: 'item', id: 'sorter', label: ui("Slide sorter"), checked: view === 'sorter', onSelect: () => setView(view === 'sorter' ? 'editor' : 'sorter') },
        { type: 'item', id: 'filmstrip', label: ui("Show filmstrip"), checked: filmstrip, disabled: !editorView, onSelect: () => setFilmstrip(!filmstrip) },
        { type: 'item', id: 'notes', label: ui("Speaker notes"), checked: notesOpen, disabled: !editorView, onSelect: () => setNotesOpen(!notesOpen) },
        ...(readOnly ? [] : [{ type: 'item', id: 'format-panel', label: ui("Format panel"), checked: formatPanel, disabled: !editorView, onSelect: () => setFormatPanel(!formatPanel) } as const]),
        separator,
        { type: 'submenu', id: 'zoom', label: ui("Zoom"), disabled: !editorView, items: zoomItems },
      ],
    },
    // Viewers get File, Edit, View, and Help, as in Docs and Slides.
    ...(readOnly ? [] : [
      { id: 'insert', label: ui("Insert"), items: () => asUndoSteps(controller, insertMenuEntries(hostRef.current)) },
      { id: 'format', label: ui("Format"), items: () => asUndoSteps(controller, formatMenuEntries(hostRef.current)) },
      { id: 'slide', label: ui("Slide"), items: () => asUndoSteps(controller, slideMenuEntries(hostRef.current)) },
      { id: 'arrange', label: ui("Arrange"), items: () => asUndoSteps(controller, arrangeMenuEntries(hostRef.current)) },
    ] satisfies MenuDefinition[]),
    helpMenu(() => setShortcutsOpen(true)),
  ]

  const panelOpen = formatPanel && editorView
  // The filmstrip narrows in the side panel and at phone width; the format panel sits beside the
  // slide only where there is room for both.
  const columns = filmstrip
    ? panelOpen ? 'grid-cols-[var(--pp-strip)_minmax(0,1fr)] @2xl:grid-cols-[var(--pp-strip)_minmax(0,1fr)_16rem]' : 'grid-cols-[var(--pp-strip)_minmax(0,1fr)]'
    : panelOpen ? 'grid-cols-[minmax(0,1fr)] @2xl:grid-cols-[minmax(0,1fr)_16rem]' : 'grid-cols-[minmax(0,1fr)]'

  return (
    <div ref={root} className={cn('@container flex h-full min-h-0 flex-col bg-background [--pp-canvas-bg:var(--muted)] [--pp-muted:var(--muted-foreground)]', className)} data-presentation-editor="" {...fileEditorRoot('presentation')}>
      <div className="border-b px-2 pt-0.5 pb-1">
        <EditorMenuBar menus={menus} onClose={focusDocument} className="-mx-0.5" />
        <div className="flex items-center gap-2">
          <PresentationToolbar
            controller={controller}
            view={view}
            onViewChange={setView}
            formatPanel={formatPanel}
            onFormatPanelChange={setFormatPanel}
            onPresent={present}
            printing={printing}
            onPrint={() => { void print() }}
            onInsertImage={() => imageInput.current?.click()}
            onLink={openLinkDialog}
            onDone={focusDocument}
          />
          {toolbarSlot}
        </div>
        {!readOnly && (
          <input
            ref={imageInput}
            type="file"
            accept={IMAGE_TYPES}
            className="hidden"
            data-testid="presentation-image-input"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void insertImage(file).catch(() => {})
            }}
          />
        )}
      </div>
      {find && (
        <PresentationFindBar
          controller={controller}
          replace={find.replace}
          focusRequest={find.request}
          onReveal={(match) => {
            // Show where the match is: the editor's slide, and the speaker notes for a match in them.
            if (view === 'sorter') setView('editor')
            if (match.notes) setNotesOpen(true)
          }}
          onClose={closeFind}
        />
      )}
      {printError && <p role="alert" className="px-3 py-1 text-sm text-destructive">{ui("Unable to prepare the presentation for printing. Check that its images are available and try again.")}</p>}
      <div className={cn('relative grid min-h-0 flex-1 [--pp-strip:minmax(5.5rem,7rem)] @xl:[--pp-strip:minmax(7rem,12rem)]', columns, view === 'sorter' && 'hidden')}>
        <nav aria-label={ui("Slides")} className={cn('min-h-0 border-r bg-muted/30', !filmstrip && 'hidden')} ref={stripHost} />
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="relative min-h-0 flex-1" ref={canvasHost} data-testid="presentation-canvas" />
          <div className="border-t">
            <button type="button" className="w-full px-3 py-1 text-left text-xs text-muted-foreground hover:bg-accent" aria-expanded={notesOpen} onClick={() => setNotesOpen(!notesOpen)}>
              {ui("Speaker notes")}
            </button>
            <div className={cn('h-28 border-t', !notesOpen && 'hidden')} ref={notesHost} data-testid="presentation-notes" />
          </div>
        </div>
        {panelOpen && (
          // Beside the slide where there is room; over it in a narrow window or the side panel.
          <aside className="absolute inset-y-0 right-0 z-10 w-64 max-w-full min-h-0 overflow-y-auto border-l bg-background shadow-lg @2xl:static @2xl:w-auto @2xl:shadow-none" aria-label={ui("Format panel")}>
            <FormatPanel controller={controller} onClose={() => {
              setFormatPanel(false)
              canvas.current?.focus()
            }} />
          </aside>
        )}
      </div>
      {view === 'sorter' && <div className="min-h-0 flex-1" ref={sorterHost} data-testid="presentation-sorter" />}
      <PresentationStatusBar
        controller={controller}
        view={view}
        notesOpen={notesOpen}
        onNotesChange={setNotesOpen}
        zoom={zoom}
        onZoom={(value) => canvas.current?.setZoom(value)}
        onDone={focusDocument}
      />
      <ShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        groups={() => shortcutGroupsFromMenus(menus, presentationShortcutGroups())}
        returnFocus={focusDocument}
      />
      <LinkDialog
        open={linkDialog.open}
        onOpenChange={(open) => { if (!open) setLinkDialog((current) => ({ ...current, open: false })) }}
        {...(linkDialog.url ? { url: linkDialog.url } : {})}
        showText={linkDialog.showText}
        editing={Boolean(linkDialog.url)}
        description={ui("A web address or an email address.")}
        onApply={({ text, url }) => { controller.setLink(url, text || undefined) }}
        onRemove={() => { controller.setLink(undefined) }}
        returnFocus={focusDocument}
      />
      <SectionDialog
        open={sectionDialog.open}
        onOpenChange={(open) => { if (!open) setSectionDialog((current) => ({ ...current, open: false })) }}
        mode={sectionDialog.request.mode}
        {...(sectionDialog.request.mode === 'rename' ? { name: sectionDialog.request.name } : {})}
        onApply={(name) => {
          const { request } = sectionDialog
          if (request.mode === 'add') controller.addSection(name, request.firstSlide)
          else controller.renameSection(request.key, name)
        }}
        returnFocus={focusSlides}
      />
      <PresentationContextMenu menu={contextMenu} onClose={() => setContextMenu(undefined)} />
    </div>
  )
}
