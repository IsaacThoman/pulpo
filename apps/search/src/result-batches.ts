import type { Category, Provider, SearchResponse, SearchResult } from './api'

export type BatchProvider = SearchResponse['provider']

/** One set of results added by Load more, in the order it was fetched. */
export interface ResultBatch {
  provider: BatchProvider
  page: number
  hasMore: boolean
  results: SearchResult[]
  /** How long the batch took to fetch, in milliseconds. */
  elapsedMs?: number
}

export interface NextBatch {
  provider: BatchProvider
  page: number
}

const trackingParameter = /^(?:utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|yclid|_hsenc|_hsmi|ref_src)$/i

/** Two engines often return the same page with a different scheme, host prefix, slash or tracking query. */
export function resultIdentity(result: SearchResult, category: Category): string {
  const value = category === 'images' ? result.imageUrl ?? result.url : result.url
  try {
    const url = new URL(value)
    const params = [...url.searchParams].filter(([name]) => !trackingParameter.test(name)).sort(([a], [b]) => a.localeCompare(b))
    const query = new URLSearchParams(params).toString()
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
    const path = url.pathname.replace(/\/+$/, '') || '/'
    return host + (url.port ? ':' + url.port : '') + path + (query ? '?' + query : '')
  } catch {
    return value
  }
}

/** Results from every batch without repeats, and the batch each one arrived in. */
export function mergeBatches(batches: ResultBatch[], category: Category) {
  const seen = new Set<string>()
  const batchOf = new Map<SearchResult, number>()
  const results: SearchResult[] = []
  const added = batches.map((batch, index) => {
    let count = 0
    for (const result of batch.results) {
      const identity = resultIdentity(result, category)
      if (seen.has(identity)) continue
      seen.add(identity)
      batchOf.set(result, index)
      results.push(result)
      count += 1
    }
    return count
  })
  return { results, batchOf, added }
}

/**
 * Where Load more continues: the same engine's next page while it has one. An engine with a single page
 * hands off once to the first engine in `pagers`, which then continues with its own pages.
 */
export function nextBatch(batches: ResultBatch[], pagers: Array<{ id: Provider; maxPage: number }>): NextBatch | undefined {
  const last = batches.at(-1)
  if (!last) return
  if (last.provider === 'openverse') return last.hasMore ? { provider: 'openverse', page: last.page + 1 } : undefined
  const pages = pagers.find(pager => pager.id === last.provider)?.maxPage ?? 1
  if (pages > 1) return last.hasMore && last.page < pages ? { provider: last.provider, page: last.page + 1 } : undefined
  if (batches.length > 1) return
  const handoff = pagers.find(pager => pager.id !== last.provider && pager.maxPage > 1)
  return handoff ? { provider: handoff.id, page: 1 } : undefined
}
