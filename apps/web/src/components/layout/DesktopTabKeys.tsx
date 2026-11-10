import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { isAppleShortcut } from '@/features/files/browser/shortcuts'
import { canCloseTab } from '@/features/files/tabs/model'
import { filesLocationOf, useFilesTabActions } from '@/features/files/tabs/routing'
import { filesTabsData, useFilesTabs } from '@/features/files/tabs/store'
import { panelTabActions, useSidePanel } from '@/features/side-panel/store'
import { lastPointerDownInPanel } from '@/lib/last-pointer-down'
import { useAuth } from '@/stores/auth'

const PANEL = '[data-side-panel]'

/** The side panel, when its tabs are on screen; a panel without room beside the main view stays hidden, with its tabs. */
function panelWithTabs(): Element | null {
  const { content, tabs } = useSidePanel.getState()
  return content !== null && tabs.length > 0 ? document.querySelector(PANEL) : null
}

/**
 * Which view's tabs a key or menu command acts on: the side panel's when it has tabs showing and
 * is where the user is (focus is in it, or, with focus nowhere in particular, it was clicked
 * last), takes the main view's place, or the main view is not showing Files; otherwise the main
 * view's.
 */
function targetView(mainShowsTabs: boolean): 'main' | 'panel' | null {
  const panel = panelWithTabs()
  if (!panel) return mainShowsTabs ? 'main' : null
  // Where two views never fit, the panel is shown in place of the main view (which stays mounted).
  if (!mainShowsTabs || panel.hasAttribute('data-full')) return 'panel'
  const focused = document.activeElement
  if (focused && focused !== document.body && focused !== document.documentElement) return focused.closest(PANEL) ? 'panel' : 'main'
  return lastPointerDownInPanel() ? 'panel' : 'main'
}

/**
 * Browser-style tab keys in the desktop app, where the page receives them, for the tabs of the
 * view in use: the main view's Files tabs or the side panel's. While either shows, the File menu
 * offers New Tab, Close Tab (Cmd/Ctrl+W) and Reopen Closed Tab. In a web browser the browser
 * keeps these keys for its own tabs.
 */
export function DesktopTabKeys({ panelFull = false }: { panelFull?: boolean }) {
  const filesEnabled = useAuth((state) => state.filesEnabled)
  const { pathname } = useLocation()
  // The main view's tabs show with every Files view (see FilesLayout).
  const mainShowsTabs = filesEnabled && filesLocationOf(pathname) !== null
  // The panel's strip shows whenever it has tabs and is on screen: beside the main view when there
  // is room, or in its place (`panelFull`); see SidePanel.
  const panelShowsTabs = useSidePanel((state) => filesEnabled && state.enabled && state.content !== null && state.tabs.length > 0
    && (state.splitAvailable || panelFull))
  const enabled = mainShowsTabs || panelShowsTabs
  const main = useFilesTabActions()
  // Refs keep the menu's listener in place while moving around, and read the latest view.
  const mainRef = useRef(main)
  mainRef.current = main
  const mainShowsTabsRef = useRef(mainShowsTabs)
  mainShowsTabsRef.current = mainShowsTabs

  useEffect(() => {
    const desktop = window.pulpoDesktop
    if (!desktop || !enabled) return
    void desktop.setFilesTabsMenu?.(true)
    const stopCommands = desktop.onCommand((command) => {
      if (command !== 'files-new-tab' && command !== 'files-reopen-tab' && command !== 'files-close-tab') return
      const view = targetView(mainShowsTabsRef.current)
      if (view === 'panel') {
        const { activeId } = useSidePanel.getState()
        if (command === 'files-new-tab') panelTabActions.newTab()
        else if (command === 'files-reopen-tab') panelTabActions.reopen()
        // Closing the panel's last tab hides the panel.
        else panelTabActions.close(activeId)
        return
      }
      const tabs = mainRef.current
      const activeId = useFilesTabs.getState().activeId
      if (view === 'main' && command === 'files-new-tab') tabs.newTab()
      else if (view === 'main' && command === 'files-reopen-tab') tabs.reopen()
      else if (view === 'main' && canCloseTab(filesTabsData(), activeId, true)) tabs.close(activeId)
      // Closing the main view's last tab goes back to My files, so a lone My files tab has nothing
      // to close: the side panel's tabs close next, then the window, which browsers close with
      // their last tab. A panel hidden for lack of room keeps its tabs.
      else if (view === 'main' && command === 'files-close-tab' && panelWithTabs()) panelTabActions.close(useSidePanel.getState().activeId)
      else if (command === 'files-close-tab') void desktop.windowControls.close()
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
      // Cmd/Ctrl+1–8 show those tabs, 9 the last. Option/Alt+digits stay with the editor's headings.
      const digit = /^Digit([1-9])$/.exec(event.code)
      const position = digit && primary && !event.altKey && !event.shiftKey ? Number(digit[1]) : 0
      if (!step && !position) return
      const view = targetView(mainShowsTabsRef.current)
      if (!view) return
      event.preventDefault()
      const tabs = view === 'panel' ? panelTabActions : mainRef.current
      if (step) tabs.cycle(step)
      else tabs.digit(position)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])

  return null
}
