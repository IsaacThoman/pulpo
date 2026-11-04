import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { friendSearchErrorMessage, normalizedFriendSearchQuery, shouldSearchFriends } from '@pulpo/client-core'
import type { FriendSearchResult } from '@pulpo/contracts'
import { ApiError, isNetworkError } from '../../api/client'
import { cacheNamespace } from '../../data/schema'
import { useSessionStore } from '../../store/session'
import { refreshFriends, searchFriends } from './api'

export const FRIEND_SEARCH_DEBOUNCE_MS = 250

/** The signed-in account and what this instance offers on the Friends screen. */
export function useFriendsContext() {
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const user = useSessionStore((state) => state.user)
  // Pools share usage between accounts, which exists only where the instance bills usage.
  const poolsEnabled = useSessionStore((state) => state.config?.capabilities.usageLimits ?? false)
  const inviteCodesEnabled = useSessionStore((state) => state.config?.auth.inviteCodesEnabled ?? false)
  const namespace = user ? cacheNamespace(instanceUrl, user.id) : ''
  return { namespace, user, poolsEnabled, inviteCodesEnabled }
}

export type FriendSearchState = 'idle' | 'loading' | 'success' | 'error'

/**
 * People matching the search field, fetched once typing pauses. `revision` changes whenever the
 * friends lists reload; the shown results are then fetched again quietly, so a request declined or
 * cancelled below (or on another device) doesn't leave a stale Accept or "Request sent" here.
 */
export function useFriendSearch(input: string, revision = 0) {
  const query = useMemo(() => normalizedFriendSearchQuery(input), [input])
  const ready = shouldSearchFriends(input)
  const [results, setResults] = useState<FriendSearchResult[]>([])
  const [state, setState] = useState<FriendSearchState>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    setResults([])
    setError('')
    if (!ready) {
      setState('idle')
      return
    }
    setState('loading')
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void searchFriends(query, controller.signal)
        .then((response) => {
          if (controller.signal.aborted) return
          setResults(response.results)
          setState('success')
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return
          setState('error')
          setError(friendSearchErrorMessage({ status: cause instanceof ApiError ? cause.status : undefined, network: isNetworkError(cause) }))
        })
    }, FRIEND_SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, ready])

  const searchedRevision = useRef(revision)
  useEffect(() => {
    if (revision === searchedRevision.current) return
    searchedRevision.current = revision
    if (!ready) return
    const controller = new AbortController()
    void searchFriends(query, controller.signal)
      .then((response) => { if (!controller.signal.aborted) setResults(response.results) })
      // Keep what is shown; the next change or search tries again.
      .catch(() => undefined)
    return () => controller.abort()
  }, [query, ready, revision])

  const update = useCallback((profileId: string, patch: Partial<FriendSearchResult>) => {
    setResults((current) => current.map((result) => result.profile.id === profileId ? { ...result, ...patch } : result))
  }, [])
  const remove = useCallback((profileId: string) => {
    setResults((current) => current.filter((result) => result.profile.id !== profileId))
  }, [])

  return { query, ready, results, state, error, update, remove }
}

/**
 * Runs one friends or Pool change at a time per key, then refreshes friends, the Pool, and usage.
 * Failures are shown in an alert; successes show in the lists themselves.
 */
export function useFriendActions(namespace: string) {
  const queryClient = useQueryClient()
  const active = useRef(new Set<string>())
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())

  const run = useCallback(async <T,>(key: string, operation: () => Promise<T>, onSuccess?: (result: T) => void) => {
    if (active.current.has(key)) return
    active.current.add(key)
    setPending(new Set(active.current))
    try {
      const result = await operation()
      onSuccess?.(result)
      await refreshFriends(queryClient, namespace)
    } catch (cause) {
      Alert.alert('Couldn’t update friends', cause instanceof Error ? cause.message : undefined)
    } finally {
      active.current.delete(key)
      setPending(new Set(active.current))
    }
  }, [namespace, queryClient])

  return { run, pending, busy: pending.size > 0 }
}
