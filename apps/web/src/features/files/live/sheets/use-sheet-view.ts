import { useEffect, useState } from 'react'
import type { SheetView, SheetViewState } from '@pulpo/client-core/office/sheets/view'

/** The view's state for toolbars; the view batches its change reports to one per frame. */
export function useSheetState(view: SheetView | undefined): SheetViewState | undefined {
  const [state, setState] = useState<SheetViewState | undefined>(() => view?.getState())
  useEffect(() => {
    if (!view) return undefined
    setState(view.getState())
    return view.subscribe(() => setState(view.getState()))
  }, [view])
  return state
}
