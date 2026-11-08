import { useRef } from 'react'

/**
 * A number that changes whenever `snapshot` is a different object, to key a dialog's form so it
 * starts over from each new snapshot (the document as it was when the dialog opened).
 */
export function useSnapshotKey(snapshot: object | null): number {
  const current = useRef<{ snapshot: object | null; key: number }>({ snapshot: null, key: 0 })
  if (current.current.snapshot !== snapshot) current.current = { snapshot, key: current.current.key + 1 }
  return current.current.key
}
