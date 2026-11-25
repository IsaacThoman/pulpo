import { useEffect, useState } from 'react'
import { MAX_QUERY_LENGTH } from './navigation'

const storagePrefix = 'pulpo-search-recents-v1:'
const limit = 20
const empty: readonly string[] = []

function cleanQuery(value: unknown) {
  if (typeof value !== 'string') return ''
  const query = value.trim()
  return query.length <= MAX_QUERY_LENGTH && !/^!(?:\s+!)*$/.test(query) ? query : ''
}

function readQueries(key: string, fallback = empty): readonly string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]')
    if (!Array.isArray(value)) return empty
    const seen = new Set<string>()
    const queries: string[] = []
    for (const entry of value) {
      const query = cleanQuery(entry)
      const normalized = query.toLowerCase()
      if (!query || seen.has(normalized)) continue
      seen.add(normalized)
      queries.push(query)
      if (queries.length === limit) break
    }
    return queries
  } catch {
    return fallback
  }
}

function writeQueries(key: string, queries: readonly string[]) {
  try {
    if (queries.length) window.localStorage.setItem(key, JSON.stringify(queries))
    else window.localStorage.removeItem(key)
  } catch {
    // Recents can still work in the current tab when storage is blocked.
  }
}

export function matchRecentQueries(queries: readonly string[], value: string) {
  const prefix = value.trim().toLowerCase()
  return queries.filter(query => {
    const normalized = query.toLowerCase()
    return normalized !== prefix && normalized.startsWith(prefix)
  }).slice(0, 6)
}

export function useRecentQueries(accountId: string | undefined, enabled: boolean) {
  const key = accountId ? storagePrefix + accountId : null
  const [history, setHistory] = useState<{ key: string; queries: readonly string[] } | null>(null)
  const recentQueries = enabled && key && history?.key === key ? history.queries : empty

  useEffect(() => {
    if (!key || !enabled) {
      if (key) writeQueries(key, empty)
      setHistory(null)
      return
    }
    const refresh = () => setHistory({ key, queries: readQueries(key) })
    const sync = (event: StorageEvent) => {
      if (event.key === key || event.key === null) refresh()
    }
    refresh()
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [enabled, key])

  function rememberQuery(value: string) {
    const query = cleanQuery(value)
    if (!enabled || !key || !query) return
    const normalized = query.toLowerCase()
    const queries = [query, ...readQueries(key, recentQueries).filter(item => item.toLowerCase() !== normalized)].slice(0, limit)
    writeQueries(key, queries)
    setHistory({ key, queries })
  }

  function clearRecentQueries() {
    if (!key) return
    writeQueries(key, empty)
    setHistory({ key, queries: empty })
  }

  return { recentQueries, rememberQuery, clearRecentQueries }
}
