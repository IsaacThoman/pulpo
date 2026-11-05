import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { LiveAssetStore } from '@pulpo/client-core/office'
import { PresentationController, type PresentationUser } from '@pulpo/client-core/office/presentation/view'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { presentationLabels } from './labels'

/**
 * One controller per document while the editor is mounted. It is created in an effect (not a
 * memo) so React's mount, unmount, and remount in development gets a fresh, live controller.
 */
export function usePresentationController(options: { doc: Y.Doc; awareness?: Awareness; readOnly: boolean; assets: LiveAssetStore; user: PresentationUser }): PresentationController | null {
  const { doc, awareness, readOnly, assets, user } = options
  const [controller, setController] = useState<PresentationController | null>(null)
  const initialReadOnly = useRef(readOnly)
  initialReadOnly.current = readOnly
  useEffect(() => {
    const created = new PresentationController({ doc, ...(awareness ? { awareness } : {}), readOnly: initialReadOnly.current, assets, user, labels: presentationLabels() })
    setController(created)
    return () => {
      created.destroy()
      setController(null)
    }
    // The user's name and color only seed presence; changing them should not remount the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, awareness, assets])
  // Access changes (sync state, trash) switch the same editor between viewing and editing.
  useEffect(() => controller?.setReadOnly(readOnly), [controller, readOnly])
  return controller
}

/** Re-renders on every change the controller reports (selection, model, presence). */
export function useControllerRevision(controller: PresentationController): number {
  const store = useMemo(() => {
    let revision = 0
    return {
      subscribe: (listener: () => void) =>
        controller.subscribe(() => {
          revision++
          listener()
        }),
      get: () => revision,
    }
  }, [controller])
  return useSyncExternalStore(store.subscribe, store.get)
}
