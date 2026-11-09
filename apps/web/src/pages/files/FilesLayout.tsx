import { Outlet, useLocation } from 'react-router-dom'
import { FilesTabStrip } from '@/features/files/tabs/FilesTabStrip'
import {
  FILES_TAB_PANEL_ID,
  filesLocationOf,
  filesTabElementId,
  useFilesTabActions,
  useFilesTabsOwner,
  useFollowFilesLocation,
} from '@/features/files/tabs/routing'
import { useFilesTabs } from '@/features/files/tabs/store'
import { useAuth } from '@/stores/auth'

/**
 * The Files views, under a strip of tabs. Each tab keeps its own place in Files (a folder, the
 * trash, or a file); the view below shows the active tab's, and follows the URL. The desktop
 * app's tab keys are taken for the whole app (see DesktopTabKeys), as the side panel has tabs too.
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
