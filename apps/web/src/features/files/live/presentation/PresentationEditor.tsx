import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { LiveAssetStore } from '@pulpo/client-core/office'
import { NotesEditor, Presenter, printSlides, SlideCanvas, SlideList, type PresentationController, type PresentationUser } from '@pulpo/client-core/office/presentation/view'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { LayoutGrid, PanelRight, Play, StickyNote } from 'lucide-react'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { EditorMenuBar } from '../chrome/EditorMenuBar'
import { fileEditorRoot } from '../chrome/editor-root'
import { fileMenuDefinition, type FileMenuHost } from '../chrome/file-menu'
import { separator, shortcutGroupsFromMenus, type MenuDefinition } from '../chrome/menu'
import { ShortcutsDialog } from '../chrome/ShortcutsDialog'
import { helpMenu, undoRedoEntries } from '../chrome/standard-menus'
import { useEditorShortcuts } from '../chrome/use-editor-shortcuts'
import { FormatPanel } from './FormatPanel'
import { presentationShortcutGroups } from './presentation-shortcuts'
import { PresentationToolbar } from './PresentationToolbar'
import { useControllerRevision, usePresentationController } from './use-presentation'

/**
 * The presentation editor: toolbar, thumbnail strip, slide canvas, speaker notes, format panel,
 * slide sorter, and present mode, around the framework-agnostic view core in client-core.
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
  const [printing, setPrinting] = useState(false)
  const [printError, setPrintError] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const presenter = useRef<Presenter | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const [stripHost] = useMounted(controller, (element) => new SlideList(element, controller, { layout: 'strip' }))
  const [canvasHost, canvas] = useMounted(controller, (element) => new SlideCanvas(element, controller, { onOpenLink: openLink }))
  const [notesHost] = useMounted(controller, (element) => new NotesEditor(element, controller))
  const sorterHost = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (view !== 'sorter' || !sorterHost.current) return
    const sorter = new SlideList(sorterHost.current, controller, {
      layout: 'grid',
      onOpen: (key) => {
        controller.goToSlide(key)
        setView('editor')
      },
    })
    return () => sorter.destroy()
  }, [controller, view])

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
      if (event.key === 'F5') {
        event.preventDefault()
        present(event.shiftKey ? 'current' : 'start')
      } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        present(event.shiftKey ? 'start' : 'current')
      }
    }
    // Capturing, so the app's own Cmd/Ctrl+Shift+Enter (the side panel's) sees the key handled.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  useEditorShortcuts(root, {
    print: () => { void print() },
    save: onSaveShortcut,
    shortcuts: () => setShortcutsOpen(true),
    focus: () => canvas.current?.focus(),
  })

  const readOnly = controller.readOnly
  const menus: MenuDefinition[] = [
    fileMenuDefinition(fileMenu, () => ({ print: () => { void print() } })),
    {
      id: 'edit',
      label: ui("Edit"),
      items: () => undoRedoEntries({ undo: () => controller.undo(), redo: () => controller.redo(), canUndo: !controller.readOnly && controller.canUndo(), canRedo: !controller.readOnly && controller.canRedo() }),
    },
    {
      id: 'view',
      label: ui("View"),
      items: () => [
        { type: 'item', id: 'present', label: ui("Present from the beginning"), icon: Play, shortcut: { key: 'F5' }, onSelect: () => present('start') },
        { type: 'item', id: 'present-current', label: ui("Present from the current slide"), shortcut: { key: 'F5', shift: true }, onSelect: () => present('current') },
        { type: 'item', id: 'presenter-view', label: ui("Presenter view"), onSelect: () => present('presenter') },
        separator,
        { type: 'item', id: 'sorter', label: ui("Slide sorter"), icon: LayoutGrid, checked: view === 'sorter', onSelect: () => setView(view === 'sorter' ? 'editor' : 'sorter') },
        { type: 'item', id: 'notes', label: ui("Speaker notes"), icon: StickyNote, checked: notesOpen, disabled: view === 'sorter', onSelect: () => setNotesOpen(!notesOpen) },
        ...(readOnly ? [] : [{ type: 'item', id: 'format-panel', label: ui("Format panel"), icon: PanelRight, checked: formatPanel, disabled: view === 'sorter', onSelect: () => setFormatPanel(!formatPanel) } as const]),
      ],
    },
    helpMenu(() => setShortcutsOpen(true)),
  ]

  return (
    <div ref={root} className={cn('flex h-full min-h-0 flex-col bg-background [--pp-canvas-bg:var(--muted)] [--pp-muted:var(--muted-foreground)]', className)} data-presentation-editor="" {...fileEditorRoot('presentation')}>
      <div className="border-b px-2 pt-0.5 pb-1">
        <EditorMenuBar menus={menus} onClose={() => canvas.current?.focus()} className="-mx-0.5" />
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
          />
          {toolbarSlot}
        </div>
      </div>
      {printError && <p role="alert" className="px-3 py-1 text-sm text-destructive">{ui("Unable to prepare the presentation for printing. Check that its images are available and try again.")}</p>}
      <div className={cn('grid min-h-0 flex-1', formatPanel && view === 'editor' ? 'grid-cols-[minmax(7rem,12rem)_1fr_16rem]' : 'grid-cols-[minmax(7rem,12rem)_1fr]', view === 'sorter' && 'hidden')}>
        <nav aria-label={ui("Slides")} className="min-h-0 border-r bg-muted/30" ref={stripHost} />
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="relative min-h-0 flex-1" ref={canvasHost} data-testid="presentation-canvas" />
          <div className="border-t">
            <button type="button" className="w-full px-3 py-1 text-left text-xs text-muted-foreground hover:bg-accent" aria-expanded={notesOpen} onClick={() => setNotesOpen(!notesOpen)}>
              {ui("Speaker notes")}
            </button>
            <div className={cn('h-28 border-t', !notesOpen && 'hidden')} ref={notesHost} data-testid="presentation-notes" />
          </div>
        </div>
        {formatPanel && view === 'editor' && (
          <aside className="min-h-0 overflow-y-auto border-l" aria-label={ui("Format panel")}>
            <FormatPanel controller={controller} />
          </aside>
        )}
      </div>
      {view === 'sorter' && <div className="min-h-0 flex-1" ref={sorterHost} data-testid="presentation-sorter" />}
      <ShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        groups={() => shortcutGroupsFromMenus(menus, presentationShortcutGroups())}
        returnFocus={() => canvas.current?.focus()}
      />
    </div>
  )
}
