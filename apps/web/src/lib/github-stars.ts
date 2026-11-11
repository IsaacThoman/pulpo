import { useEffect, useState } from 'react'
import { GITHUB_REPO_API } from '@/lib/links'

const CACHE_KEY = 'pulpo:github-stars'
// GitHub allows 60 unauthenticated requests an hour per IP, and the count barely moves.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

type CachedStars = { count: number; fetchedAt: number }

function readCachedStars(now = Date.now()): number | null {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Partial<CachedStars> | null
    if (typeof cached?.count !== 'number' || typeof cached.fetchedAt !== 'number') return null
    return now - cached.fetchedAt < CACHE_TTL_MS && cached.fetchedAt <= now ? cached.count : null
  } catch {
    return null
  }
}

function writeCachedStars(count: number) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ count, fetchedAt: Date.now() } satisfies CachedStars))
  } catch {
    // Private windows and blocked storage just fetch again next visit.
  }
}

export function parseStarCount(value: unknown): number | null {
  const count = (value as { stargazers_count?: unknown } | null)?.stargazers_count
  return typeof count === 'number' && Number.isFinite(count) && count >= 0 ? count : null
}

// Shared so the header and the open-source section make one request between them.
let pending: Promise<number | null> | null = null

function fetchStars(): Promise<number | null> {
  pending ??= fetch(GITHUB_REPO_API, { headers: { accept: 'application/vnd.github+json' } })
    .then((response) => (response.ok ? response.json() : null))
    .then((body) => {
      const count = parseStarCount(body)
      if (count !== null) writeCachedStars(count)
      return count
    })
    // No count when GitHub is unreachable, blocked, or rate limited.
    .catch(() => null)
    .finally(() => { pending = null })
  return pending
}

/** The repo's GitHub star count, or null until it is known. Null on the server and on first render, so pre-rendered markup hydrates cleanly. */
export function useGithubStars(): number | null {
  const [stars, setStars] = useState<number | null>(null)
  useEffect(() => {
    const cached = readCachedStars()
    if (cached !== null) {
      setStars(cached)
      return
    }
    let active = true
    void fetchStars().then((count) => { if (active && count !== null) setStars(count) })
    return () => { active = false }
  }, [])
  return stars
}
