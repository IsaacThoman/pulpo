import { useEffect, useState } from 'react'
import type { FilesPermissionItem } from '@pulpo/contracts'
import { ui } from '@/i18n/ui'

/** Whether the request can still be answered: the reply is running and it has not expired. */
export function useFilesPermissionPending(item: FilesPermissionItem | undefined, live: boolean): boolean {
  const awaiting = live && item?.status === 'awaiting_decision'
  const expiresAt = item ? Date.parse(item.expires_at) : Number.NaN
  const [expired, setExpired] = useState(() => awaiting && Date.now() >= expiresAt)
  useEffect(() => {
    if (!awaiting) return
    const remaining = expiresAt - Date.now()
    setExpired(remaining <= 0)
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setExpired(true), remaining)
    return () => window.clearTimeout(timer)
  }, [awaiting, expiresAt])
  return awaiting && !expired
}

export function filesPermissionStepLabel(item: FilesPermissionItem, pending: boolean): string {
  switch (item.status) {
    case 'awaiting_decision': return pending ? ui("Waiting for permission to look through your Files") : ui("Didn't get an answer about your Files")
    case 'allowed': return ui("Allowed to look through your Files in this chat")
    case 'always_allowed': return ui("Allowed to look through your Files")
    case 'denied': return ui("Not allowed to look through your Files")
    case 'expired': return ui("Didn't get an answer about your Files")
  }
}
