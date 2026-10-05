import { useEffect, useState } from 'react'
import { DICTATION_STALLED_STATUS_DELAY_MS } from '@pulpo/client-core'

/**
 * True once `key` has stayed the same non-null value for `delayMs`. A different key,
 * including the same phase in a later session, starts the wait again.
 */
export function useStalled(key: string | null, delayMs = DICTATION_STALLED_STATUS_DELAY_MS): boolean {
  const [state, setState] = useState({ key, stalled: false })
  if (state.key !== key) setState({ key, stalled: false })
  useEffect(() => {
    if (key === null) return undefined
    const timer = setTimeout(() => setState((current) => current.key === key ? { key, stalled: true } : current), delayMs)
    return () => clearTimeout(timer)
  }, [key, delayMs])
  return key !== null && state.key === key && state.stalled
}
