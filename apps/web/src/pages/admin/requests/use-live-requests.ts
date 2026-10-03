import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { io, type Socket } from 'socket.io-client'
import type { AdminRequestPage, AdminRequestRow, AdminRequestSort, AdminUsageEvent, ClientToServerEvents, ServerToClientEvents } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { isDesktopRuntime, runtimeInstanceUrl, runtimeSessionToken } from '@/lib/runtime'
import { handleSessionConnectionError } from '@/lib/session-revocation'
import { isTerminalStatus } from './filters'
import { requestsKeys, requestsPageUrl, type RequestPages } from './queries'

/** Minimum spacing between live refetches, however busy the event stream is. */
export const LIVE_REFETCH_INTERVAL_MS = 5_000
/** Short settle delay so a burst of new requests causes one refetch. */
export const LIVE_SETTLE_MS = 1_000

export interface AppliedEvent {
  data: RequestPages | undefined
  /** The event's request is already in the loaded pages. */
  known: boolean
  /** The request just moved from in flight to a final status. */
  finished: boolean
}

function patchRow(row: AdminRequestRow, event: AdminUsageEvent): AdminRequestRow {
  const inFlight = !isTerminalStatus(event.status)
  return {
    ...row,
    status: event.status,
    retryCount: event.retryCount,
    fallbackUsed: event.fallbackUsed,
    actualModelId: event.currentModelId ?? row.actualModelId,
    ocrStatus: event.ocrStatus,
    inputTokens: event.inputTokens,
    cachedInputTokens: event.cachedInputTokens,
    outputTokens: event.outputTokens,
    durationMs: inFlight ? event.elapsedMs : (row.durationMs ?? event.elapsedMs),
  }
}

/** Patches a loaded row in place from a live usage event; unknown requests are left alone. */
export function applyUsageEvent(data: RequestPages | undefined, event: AdminUsageEvent): AppliedEvent {
  if (!data) return { data, known: false, finished: false }
  let known = false
  let finished = false
  const pages = data.pages.map((page) => {
    const index = page.data.findIndex((row) => row.id === event.requestId)
    if (index < 0) return page
    known = true
    const row = page.data[index]!
    // Final rows only change through a refetch (cost, error, timing are settled server-side).
    if (isTerminalStatus(row.status)) return page
    finished = isTerminalStatus(event.status)
    const rows = [...page.data]
    rows[index] = patchRow(row, event)
    return { ...page, data: rows }
  })
  return { data: known ? { ...data, pages } : data, known, finished }
}

/**
 * Replaces the first page with a fresh copy while keeping pages loaded through
 * "Load more". Rows that slid out of the fresh first page stay where they were.
 */
export function mergeFirstPage(data: RequestPages, fresh: AdminRequestPage, sort: AdminRequestSort): RequestPages {
  const freshIds = new Set(fresh.data.map((row) => row.id))
  const [first, ...rest] = data.pages
  const carried = (first?.data ?? []).filter((row) => !freshIds.has(row.id))
  const firstRows = [...fresh.data, ...carried]
  if (sort === 'newest') firstRows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const seen = new Set(firstRows.map((row) => row.id))
  return {
    ...data,
    pages: [
      { data: firstRows, nextCursor: first?.nextCursor ?? fresh.nextCursor },
      ...rest.map((page) => ({ ...page, data: page.data.filter((row) => !seen.has(row.id)) })),
    ],
  }
}

/**
 * Live mode: patches loaded rows from `admin.usage.upsert` events and, for new
 * or newly finished requests, refetches the first page and overview at most
 * once every LIVE_REFETCH_INTERVAL_MS. No socket and no timers when disabled.
 */
export function useLiveRequests({ enabled, query, sort }: { enabled: boolean; query: string; sort: AdminRequestSort }) {
  const queryClient = useQueryClient()
  const latest = useRef({ query, sort })
  latest.current = { query, sort }

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastRefetchAt = 0

    const refetch = async () => {
      timer = null
      lastRefetchAt = Date.now()
      const { query: currentQuery, sort: currentSort } = latest.current
      const listKey = requestsKeys.list(currentQuery, currentSort)
      void queryClient.invalidateQueries({ queryKey: requestsKeys.overview(currentQuery) })
      const data = queryClient.getQueryData<RequestPages>(listKey)
      if (!data || data.pages.length <= 1) {
        void queryClient.invalidateQueries({ queryKey: listKey })
        return
      }
      try {
        const fresh = await apiRequest<AdminRequestPage>(requestsPageUrl(currentQuery, currentSort, null))
        queryClient.setQueryData<RequestPages>(listKey, (current) => current && mergeFirstPage(current, fresh, currentSort))
      } catch {
        // Live refresh is best effort; the next event or a manual refresh retries.
      }
    }

    const schedule = () => {
      if (timer !== null) return
      const delay = Math.max(LIVE_SETTLE_MS, lastRefetchAt + LIVE_REFETCH_INTERVAL_MS - Date.now())
      timer = setTimeout(() => void refetch(), delay)
    }

    const onEvent = (event: AdminUsageEvent) => {
      const listKey = requestsKeys.list(latest.current.query, latest.current.sort)
      const result = applyUsageEvent(queryClient.getQueryData<RequestPages>(listKey), event)
      if (result.known && result.data) queryClient.setQueryData(listKey, result.data)
      if (!result.known || result.finished) schedule()
    }

    const desktop = isDesktopRuntime()
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(desktop ? runtimeInstanceUrl() : undefined, {
      path: '/socket.io',
      withCredentials: !desktop,
      auth: desktop ? { sessionToken: runtimeSessionToken() } : undefined,
    })
    socket.on('connect_error', (error) => { void handleSessionConnectionError(error) })
    let connections = 0
    socket.on('connect', () => {
      socket.emit('admin.usage.subscribe')
      // After a reconnect, events may have been missed while offline.
      if (connections++ > 0) schedule()
    })
    socket.on('admin.usage.upsert', onEvent)
    return () => {
      if (timer !== null) clearTimeout(timer)
      socket.emit('admin.usage.unsubscribe')
      socket.disconnect()
    }
  }, [enabled, queryClient])
}
