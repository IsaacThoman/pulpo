import type { SearchAccountSummary } from '@pulpo/contracts/search'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type SearchApiError } from './api'
import { pulpoOrigin } from './auth'

export function pulpoUrl(path: string) {
  return new URL(path, pulpoOrigin).href
}

export function formatCredits(micros: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(micros / 1_000_000)
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || '?'
}

/** The account's Pulpo credits, refreshed when Search regains focus or asks for it. */
export function useAccountSummary(userId: string | undefined) {
  const [summary, setSummary] = useState<{ id: string; value: SearchAccountSummary }>()
  const pending = useRef<AbortController>(undefined)

  const refresh = useCallback(() => {
    if (!userId) return
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    api.account(controller.signal).then(value => {
      if (!controller.signal.aborted) setSummary({ id: userId, value })
    }).catch(() => {
      // Keep the last known balance through transient connection errors.
    })
  }, [userId])

  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      pending.current?.abort()
      window.removeEventListener('focus', refresh)
    }
  }, [refresh])

  return { account: summary && summary.id === userId ? summary.value : undefined, refreshAccount: refresh }
}

/** Where to go when a Search request is refused for credits or limits. */
export function limitDestination(error: Pick<SearchApiError, 'code'>, account: SearchAccountSummary | undefined) {
  if (account?.billing && error.code === 'insufficient_balance') return { href: pulpoUrl('/billing?topup=1'), label: 'Add credits in Pulpo' }
  if (account?.billing) return { href: pulpoUrl('/billing'), label: 'View limits in Pulpo' }
  return { href: pulpoOrigin, label: 'Open Pulpo' }
}
