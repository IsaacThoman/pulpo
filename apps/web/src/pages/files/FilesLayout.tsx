import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { isAppleShortcut } from '@/features/files/browser/shortcuts'
import { FilesTabStrip } from '@/features/files/tabs/FilesTabStrip'
import {
  FILES_TAB_PANEL_ID,
  filesLocationOf,
  filesTabElementId,
  useFilesTabActions,
  useFilesTabsOwner,
  useFollowFilesLocation,
  type FilesTabActions,
} from '@/features/files/tabs/routing'
import { canCloseTab } from '@/features/files/tabs/model'
import { filesTabsData, useFilesTabs } from '@/features/files/tabs/store'
import { useAuth } from '@/stores/auth'

/**
 * Browser-style tab keys in the desktop app, where the page receives them. In a web browser the
 * browser keeps them for its own tabs.
 */
function useDesktopTabKeys(actions: FilesTabActions, enabled: boolean): void {
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  // While Files shows, the menu offers New Tab, Close Tab (Cmd/Ctrl+W) and Reopen Closed Tab.
  useEffect(() => {
    const desktop = window.pulpoDesktop
    if (!desktop || !enabled) return
    void desktop.setFilesTabsMenu?.(true)
    const stopCommands = desktop.onCommand((command) => {
      const tabs = actionsRef.current
      if (command === 'files-new-tab') tabs.newTab()
      else if (command === 'files-reopen-tab') tabs.reopen()
      else if (command === 'files-close-tab') {
        const activeId = useFilesTabs.getState().activeId
        // With nothing to close, Cmd/Ctrl+W closes the window, as in browsers.
        if (canCloseTab(filesTabsData(), activeId)) tabs.close(activeId)
        else void desktop.windowControls.close()
      }
    })
    return () => {
      stopCommands()
      void desktop.setFilesTabsMenu?.(false)
    }
  }, [enabled])

  useEffect(() => {
    if (!window.pulpoDesktop || !enabled) return
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const apple = isAppleShortcut()
      const primary = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
      let step = 0
      // Ctrl+Tab and Ctrl+Shift+Tab, everywhere.
      if (event.key === 'Tab' && event.ctrlKey && !event.metaKey && !event.altKey) step = event.shiftKey ? -1 : 1
      // Ctrl+PageDown and Ctrl+PageUp.
      else if ((event.key === 'PageDown' || event.key === 'PageUp') && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) step = event.key === 'PageDown' ? 1 : -1
      // Cmd+Option+Arrow and Cmd+Shift+] / [ on a Mac.
      else if (apple && event.metaKey && event.altKey && !event.ctrlKey && !event.shiftKey && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) step = event.key === 'ArrowRight' ? 1 : -1
      else if (apple && event.metaKey && event.shiftKey && !event.altKey && !event.ctrlKey && (event.code === 'BracketRight' || event.code === 'BracketLeft')) step = event.code === 'BracketRight' ? 1 : -1
      if (step) {
        event.preventDefault()
        actionsRef.current.cycle(step)
        return
      }
      // Cmd/Ctrl+1–8 show those tabs, 9 the last. Option/Alt+digits stay with the editor's headings.
      const digit = /^Digit([1-9])$/.exec(event.code)
      if (digit && primary && !event.altKey && !event.shiftKey) {
        event.preventDefault()
        actionsRef.current.digit(Number(digit[1]))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}

/**
 * The Files views, under a strip of tabs. Each tab keeps its own place in Files (a folder, the
 * trash, or a file); the view below shows the active tab's, and follows the URL.
 */
export function FilesLayout() {
  const location = useLocation()
  // With Files turned off only the trash is left here, which needs no tabs.
  const filesEnabled = useAuth((state) => state.filesEnabled)
  const owner = useFilesTabsOwner(filesLocationOf(location.pathname))
  // The strip stays while the view does, even with no tabs: closing the last one leaves Files, and
  // the view below must not jump up for the moment before the new chat takes its place.
  const ready = useFilesTabs((state) => Boolean(owner) && state.owner === owner)
  const activeId = useFilesTabs((state) => state.activeId)
  const actions = useFilesTabActions()
  useFollowFilesLocation(filesEnabled ? owner : null)
  useDesktopTabKeys(actions, filesEnabled)

  if (!filesEnabled) return <Outlet />
  return (
    <div className="flex h-full min-h-0 flex-col">
      {ready && <FilesTabStrip actions={actions} />}
      <div
        id={FILES_TAB_PANEL_ID}
        role="tabpanel"
        aria-labelledby={ready && activeId ? filesTabElementId(activeId) : undefined}
        className="min-h-0 flex-1"
      >
        <Outlet />
      </div>
    </div>
  )
}
