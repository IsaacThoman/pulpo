import { lazy, memo, Suspense, useEffect, useRef, useState, type PointerEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { PANEL_TAB_PANEL_ID, panelTabElementId, PanelStripContext } from './panel-strip'
import { PanelTabStrip } from './PanelTabStrip'
import { clampPanelWidth, DEFAULT_PANEL_WIDTH, readPanelWidth, splitFits, useSidePanel, writePanelWidth, type PanelContent } from './store'
import { moveToMain, useMainNavigate } from './use-panel-actions'

// Panel views are heavy (editor, chat); load each only once something of that kind opens.
const FilePanelView = lazy(() => import('@/pages/files/FileDocPage').then((module) => ({ default: module.FilePanelView })))
const FolderPanelView = lazy(() => import('@/pages/files/FilesPage').then((module) => ({ default: module.FolderPanelView })))
const AttachmentPanelView = lazy(() => import('@/pages/AttachmentPage').then((module) => ({ default: module.AttachmentPanelView })))

const loading = <div className="grid h-full place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>

// Shell measurements must not propagate renders into the file browser/editor.
const PanelView = memo(function PanelView({ panel }: { panel: PanelContent }) {
  return (
    <Suspense fallback={loading}>
      {panel.kind === 'file' ? <FilePanelView fileId={panel.id} />
        : panel.kind === 'attachment' ? <AttachmentPanelView attachmentId={panel.id} />
        : <FolderPanelView folderId={panel.id} />}
    </Suspense>
  )
})

/**
 * A folder or file docked beside the main view (drag its edge to resize), within `available`,
 * the room the two share. It is never laid over the main view: without room for both it hides,
 * or, where two views can never fit (`full`, e.g. phones), it takes the main view's place.
 * With Files on it has tabs, at the top; the view below shows the active one.
 */
export function SidePanel({ available, full = false }: { available: number; full?: boolean }) {
  const panel = useSidePanel((state) => state.content)
  const activeId = useSidePanel((state) => state.activeId)
  const hasTabs = useSidePanel((state) => state.tabs.length > 0)
  const strip = useAuth((state) => state.filesEnabled) && hasTabs
  // The preferred width is kept as set; what shows is clamped to the room there is now.
  const [preferred, setPreferred] = useState(readPanelWidth)
  const [resizing, setResizing] = useState(false)
  const width = clampPanelWidth(preferred, available)

  const go = useMainNavigate()
  const goRef = useRef(go)
  goRef.current = go

  // Cmd/Ctrl+\\ shows or hides the panel (with its tabs), Cmd/Ctrl+J asks the agent about the
  // files in view, and Cmd/Ctrl+Shift+Enter moves the panel's tab that shows to the main view.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod || event.altKey) return
      const state = useSidePanel.getState()
      if (event.key === '\\' && !event.shiftKey) {
        event.preventDefault()
        state.toggle()
      } else if (event.key.toLowerCase() === 'j' && !event.shiftKey) {
        event.preventDefault()
        // Loaded on use: the agent helpers bring in the chat store.
        void import('./agent').then((agent) => agent.runAgentShortcut(goRef.current))
      } else if (event.key === 'Enter' && event.shiftKey && state.content) {
        event.preventDefault()
        moveToMain(state.content, goRef.current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // No room for two views: the panel stays hidden (its URL is kept) until there is.
  if (!panel || (!full && !splitFits(available))) return null

  const choose = (next: number) => {
    const clamped = clampPanelWidth(next, available)
    setPreferred(clamped)
    return clamped
  }

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    const right = handle.parentElement!.getBoundingClientRect().right
    handle.setPointerCapture(event.pointerId)
    setResizing(true)
    let latest = width
    const move = (moveEvent: globalThis.PointerEvent) => { latest = choose(right - moveEvent.clientX) }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      setResizing(false)
      writePanelWidth(latest)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  const content = (
    <PanelStripContext.Provider value={strip}>
      {strip && <PanelTabStrip />}
      <div
        id={PANEL_TAB_PANEL_ID}
        role={strip ? 'tabpanel' : undefined}
        aria-labelledby={strip ? panelTabElementId(activeId) : undefined}
        className="min-h-0 flex-1"
      >
        <PanelView panel={panel} />
      </div>
    </PanelStripContext.Provider>
  )

  if (full) {
    return (
      <aside data-side-panel data-full aria-label={ui("Side panel")} className="app-side-panel relative flex h-full min-w-0 flex-1 flex-col bg-background">
        {content}
      </aside>
    )
  }

  return (
    <aside
      data-side-panel
      aria-label={ui("Side panel")}
      className={cn('app-side-panel relative flex h-full min-w-0 shrink-0 flex-col border-l bg-background', resizing && 'select-none')}
      style={{ width }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={ui("Resize side panel")}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={startResize}
        onDoubleClick={() => writePanelWidth(choose(DEFAULT_PANEL_WIDTH))}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          writePanelWidth(choose(width + (event.key === 'ArrowLeft' ? 32 : -32)))
        }}
        className={cn(
          'absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize outline-none',
          'after:absolute after:inset-y-0 after:left-[3px] after:w-0.5 after:transition-colors hover:after:bg-sky-500/60 focus-visible:after:bg-sky-500',
          resizing && 'after:bg-sky-500',
        )}
      />
      {content}
    </aside>
  )
}
