import { useEffect, useRef, useState } from 'react'
import { apiRequest } from '@/lib/api'
import type { SensitiveRevealCredentials } from './SensitiveRevealDialog'

const emptyDraft = () => ({ value: '', changed: false, visible: false })

export function useSavedSecret(configured: boolean, revealPath: string) {
  const [draft, setDraft] = useState(emptyDraft)
  const [revealOpen, setRevealOpen] = useState(false)
  const revision = useRef(0)

  useEffect(() => () => { revision.current += 1 }, [])

  const reset = () => {
    revision.current += 1
    setDraft(emptyDraft())
    setRevealOpen(false)
  }

  const onChange = (value: string) => {
    revision.current += 1
    setDraft({ value, changed: true, visible: false })
  }

  const toggle = () => {
    if (draft.visible) {
      revision.current += 1
      setDraft(draft.changed ? { ...draft, visible: false } : emptyDraft())
    } else if (configured && !draft.changed) {
      setRevealOpen(true)
    } else {
      setDraft({ ...draft, visible: true })
    }
  }

  const onOpenChange = (open: boolean) => {
    if (!open) revision.current += 1
    setRevealOpen(open)
  }

  const reveal = async (credentials: SensitiveRevealCredentials) => {
    const requestedRevision = revision.current
    const { apiKey } = await apiRequest<{ apiKey: string }>(revealPath, {
      method: 'POST', body: credentials,
    })
    if (requestedRevision === revision.current) {
      setDraft({ value: apiKey, changed: false, visible: true })
    }
  }

  return {
    value: draft.value,
    replacement: draft.changed ? draft.value : '',
    reset,
    fieldProps: { value: draft.value, onChange, configured, show: draft.visible, onShowChange: toggle },
    dialogProps: { open: revealOpen, onOpenChange, onConfirm: reveal },
  }
}
