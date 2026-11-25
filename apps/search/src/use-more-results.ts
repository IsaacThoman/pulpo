import { useEffect, useRef, useState } from 'react'
import { api, SearchApiError, type Category, type Provider, type ProviderConfig, type SearchRequest, type SearchResponse, type SearchResult } from './api'
import { mergeBatches, nextBatch, type NextBatch, type ResultBatch } from './result-batches'

export const imageBatchSize = 24
const storageKey = 'pulpo-search-more-v1'
const storedSearches = 5
const storedFor = 30 * 60_000
// Repeated results are common when one engine continues another's list, so a nearly empty batch fetches once more.
const enoughNewResults = 3

export type MoreNotice = 'none-new' | 'exhausted'

interface Stored {
  key: string
  savedAt: number
  batches: ResultBatch[]
  galleryLimit: number
  scrollY?: number
}

interface MoreState {
  key: string
  /** Each time a search becomes active is a new visit; state from an earlier visit is never reused directly. */
  visit: number
  batches: ResultBatch[]
  galleryLimit: number
  loading: boolean
  error?: SearchApiError
  notice?: MoreNotice
  scrollY?: number
}

function readStored(): Stored[] {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(storageKey) ?? '[]')
    return Array.isArray(value) ? value.filter((entry): entry is Stored => Boolean(entry) && typeof entry === 'object'
      && typeof entry.key === 'string' && Array.isArray(entry.batches) && typeof entry.galleryLimit === 'number'
      && Date.now() - entry.savedAt < storedFor) : []
  } catch {
    return []
  }
}

function writeStored(entry: Omit<Stored, 'savedAt'>) {
  try {
    const others = readStored().filter(item => item.key !== entry.key)
    const next = entry.batches.length || entry.scrollY ? [{ ...entry, savedAt: Date.now() }, ...others] : others
    window.sessionStorage.setItem(storageKey, JSON.stringify(next.slice(0, storedSearches)))
  } catch {
    // Load more still works for this page; only restoring it after leaving needs storage.
  }
}

let visits = 0

function initialState(key: string, restore: boolean): MoreState {
  const stored = key && restore ? readStored().find(entry => entry.key === key) : undefined
  return { key, visit: ++visits, batches: stored?.batches ?? [], galleryLimit: stored?.galleryLimit ?? imageBatchSize, loading: false, scrollY: stored?.scrollY }
}

function fetchBatch(request: SearchRequest, target: NextBatch, expandedImages: boolean, signal: AbortSignal): Promise<SearchResponse> {
  if ('reusable' in request) {
    const { reusable: _reusable, ...fields } = request
    return api.reusableImages({ ...fields, page: target.page }, signal)
  }
  const { expandedImages: _expanded, page: _page, ...fields } = request
  return api.search({
    ...fields, providers: [target.provider as Provider], ...(target.page > 1 ? { page: target.page } : {}),
    ...(expandedImages ? { expandedImages: true as const } : {}),
  }, signal)
}

interface Options {
  /** Identifies one search for one account. An empty key turns Load more off. */
  key: string
  request: SearchRequest | null
  first: SearchResponse | undefined
  category: Category
  /** Engines that can continue the results, most preferred first. */
  pagers: ProviderConfig[]
  /** Whether this search was reached by reloading or going back, so its saved batches return. */
  restore: boolean
}

export function useMoreResults({ key, request, first, category, pagers, restore }: Options) {
  const [state, setState] = useState<MoreState>(() => initialState('', false))
  const controller = useRef<AbortController>(undefined)
  const latestKey = useRef(key)
  latestKey.current = key
  // Decided once when a search becomes active, so later updates build on the same restored batches.
  const activation = useRef<{ state: MoreState; restored: boolean }>(undefined)
  if (activation.current?.state.key !== key) activation.current = { state: initialState(key, restore), restored: restore }
  const base = activation.current.state
  const current = state.key === key && state.visit === base.visit ? state : undefined
  const active = current ?? base
  const pagerPages = pagers.map(pager => ({ id: pager.id, maxPage: pager.maxPage ?? 1 }))
  const firstBatch: ResultBatch | undefined = first && {
    provider: first.provider, page: 1, hasMore: first.hasMore ?? false, results: first.results,
  }
  const batches = firstBatch ? [firstBatch, ...active.batches] : []
  const merged = mergeBatches(batches, category)
  const next = merged.results.length ? nextBatch(batches, pagerPages) : undefined

  useEffect(() => {
    // A new visit replaces what an earlier visit to the same search saved.
    if (key && !activation.current?.restored) writeStored({ key, batches: [], galleryLimit: imageBatchSize })
  }, [key])

  useEffect(() => () => {
    controller.current?.abort()
    controller.current = undefined
    // A search left mid-load must not stay busy when the reader comes back to it.
    setState(previous => previous.loading ? { ...previous, loading: false } : previous)
  }, [key])

  useEffect(() => {
    if (!key || !current) return
    writeStored({ key, batches: current.batches, galleryLimit: current.galleryLimit, scrollY: current.scrollY })
  }, [current, key])

  function update(change: (state: MoreState) => Partial<MoreState>) {
    if (key !== latestKey.current) return
    setState(previous => {
      const from = previous.key === key && previous.visit === base.visit ? previous : base
      return { ...from, ...change(from) }
    })
  }

  async function load() {
    if (!key || !request || !firstBatch || !next || active.loading || controller.current) return
    const signal = (controller.current = new AbortController()).signal
    const searchRequest = request
    update(() => ({ loading: true, error: undefined, notice: undefined }))
    let added = 0
    const appended = [...active.batches]
    let target: NextBatch | undefined = next
    try {
      for (let attempt = 0; target && attempt < 2 && added < enoughNewResults; attempt += 1) {
        const expandedImages = category === 'images' && pagers.some(pager => pager.id === target!.provider && pager.expandedImages)
        const data = await fetchBatch(searchRequest, target, expandedImages, signal)
        if (signal.aborted) return
        appended.push({ provider: data.provider, page: target.page, hasMore: data.hasMore ?? false, results: data.results })
        const all = [firstBatch, ...appended]
        added += mergeBatches(all, category).added.at(-1) ?? 0
        target = nextBatch(all, pagerPages)
        const saved = [...appended]
        update(() => ({ batches: saved }))
      }
      update(() => ({ loading: false, notice: added ? undefined : target ? 'none-new' : 'exhausted' }))
    } catch (error) {
      if (signal.aborted) return
      update(() => ({
        loading: false,
        error: error instanceof SearchApiError ? error : new SearchApiError('Couldn’t load more results. Try again.', 0),
      }))
    } finally {
      if (controller.current?.signal === signal) controller.current = undefined
    }
  }

  return {
    results: merged.results,
    batchOf: merged.batchOf as ReadonlyMap<SearchResult, number>,
    /** The engine the next Load more uses, when there is one. */
    next,
    /** The engine whose results were added last. */
    lastProvider: batches.at(-1)?.provider,
    loadedMore: active.batches.length > 0,
    loading: active.loading,
    error: active.error,
    notice: active.notice,
    load,
    galleryLimit: active.galleryLimit,
    setGalleryLimit: (value: number | ((current: number) => number)) => update(state => ({
      galleryLimit: typeof value === 'function' ? value(state.galleryLimit) : value,
    })),
    /** Where this search was scrolled to when the reader left it. */
    savedScroll: active.scrollY,
    saveScroll: (scrollY: number) => {
      if (!key) return
      // Storage covers a reload; state covers Back within this page, where the hook still holds this search.
      writeStored({ key, batches: active.batches, galleryLimit: active.galleryLimit, scrollY })
      update(() => ({ scrollY }))
    },
  }
}
