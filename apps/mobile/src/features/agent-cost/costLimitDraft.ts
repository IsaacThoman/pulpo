import { useCallback, useEffect, useRef, useState } from 'react'
import { parseAgentCostLimit } from '@pulpo/contracts'

/** The editable dollar amount for a limit in USD micros, as the web input shows it ("1", "2.5"). */
export function costLimitDollars(micros: number): string {
  return String(micros / 1_000_000)
}

/**
 * Keeps a typed threshold as a draft and saves it, parsed and clamped, when editing ends: on
 * submit, on blur, or when the screen closes mid-edit. Unparseable text restores the saved amount.
 */
export function useCostLimitDraft(value: number, onChange: (value: number) => void) {
  const [draft, setDraftState] = useState(() => costLimitDollars(value))
  const latest = useRef({ draft, value, onChange, dirty: false })
  latest.current.value = value
  latest.current.onChange = onChange
  useEffect(() => {
    latest.current.draft = costLimitDollars(value)
    latest.current.dirty = false
    setDraftState(costLimitDollars(value))
  }, [value])
  const setDraft = useCallback((next: string) => {
    latest.current.draft = next
    latest.current.dirty = true
    setDraftState(next)
  }, [])
  const commit = useCallback((): string => {
    const current = latest.current
    const next = parseAgentCostLimit(current.draft) ?? current.value
    const formatted = costLimitDollars(next)
    current.draft = formatted
    current.dirty = false
    setDraftState(formatted)
    if (next !== current.value) current.onChange(next)
    return formatted
  }, [])
  useEffect(() => () => {
    const current = latest.current
    if (!current.dirty) return
    const next = parseAgentCostLimit(current.draft)
    if (next !== undefined && next !== current.value) current.onChange(next)
  }, [])
  return { draft, setDraft, commit }
}
