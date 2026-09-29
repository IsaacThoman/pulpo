import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { clampPanelWidth, readPanelWidth, useSidePanel, writePanelWidth } from './store'
import { panelContentPath, useMainNavigate } from './use-panel-actions'

// Panel views are heavy (editor, chat); load each only once something of that kind opens.
const FilePanelView = lazy(() => import('@/pages/files/FileDocPage').then((module) => ({ default: module.FilePanelView })))
const FolderPanelView = lazy(() => import('@/pages/files/FilesPage').then((module) => ({ default: module.FolderPanelView })))

export type SidePanelMode = 'docked' | 'drawer' | 'sheet'

const loading = <div className="grid h-full place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>

/**
 * A file or chat shown beside the main view. Docked on wide windows (drag its edge to resize), a
 * slide-over drawer on medium ones, and a full-screen sheet on phones. Maximizing fills the
 * content area while the main view stays mounted, so restoring returns to the same split.
 */
export function SidePanel({ mode }: { mode: SidePanelMode }) {
  const panel = useSidePanel((state) => state.content)
  const close = useSidePanel((state) => state.close)
  const [width, setWidth] = useState(() => clampPanelWidth(readPanelWidth(), window.innerWidth))
  const [resizing, setResizing] = useState(false)

  useEffect(() => {
    const fit = () => setWidth((current) => clampPanelWidth(current, window.innerWidth))
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  const go = useMainNavigate()
  const goRef = useRef(go)
  goRef.current = go

  // Cmd/Ctrl+\\ shows or hides the panel, Cmd/Ctrl+J asks the agent about the files in view, and
  // Cmd/Ctrl+Shift+Enter opens the panel's content in the main view.
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
        const target = panelContentPath(state.content)
        state.close()
        goRef.current(target)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Overlays close with Escape, unless the key belongs to something inside the panel.
  useEffect(() => {
    if (!panel || mode === 'docked') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"], [role="dialog"], [role="menu"]')) return
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, mode, panel])

  if (!panel) return null

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    setResizing(true)
    const move = (moveEvent: globalThis.PointerEvent) => setWidth(clampPanelWidth(window.innerWidth - moveEvent.clientX, window.innerWidth))
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      setResizing(false)
      setWidth((current) => { writePanelWidth(current); return current })
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  const content = (
    <Suspense fallback={loading}>
      {panel.kind === 'file' ? <FilePanelView fileId={panel.id} /> : <FolderPanelView folderId={panel.id} />}
    </Suspense>
  )

  if (mode === 'docked') {
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
          onDoubleClick={() => { setWidth(clampPanelWidth(520, window.innerWidth)); writePanelWidth(520) }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            const next = clampPanelWidth(width + (event.key === 'ArrowLeft' ? 32 : -32), window.innerWidth)
            setWidth(next)
            writePanelWidth(next)
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

  return (
    <>
      {mode === 'drawer' && (
        <button type="button" aria-label={ui("Close side panel")} className="fixed inset-0 z-40 cursor-default bg-black/30" onClick={close} />
      )}
      <aside
        data-side-panel
        aria-label={ui("Side panel")}
        className={cn(
          'fixed z-40 flex flex-col bg-background',
          mode === 'drawer' ? 'inset-y-0 right-0 w-[min(34rem,92vw)] border-l shadow-2xl' : 'inset-0',
        )}
      >
        {content}
      </aside>
    </>
  )
}
