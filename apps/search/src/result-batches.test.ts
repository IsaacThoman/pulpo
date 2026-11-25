import { describe, expect, it } from 'vitest'
import type { SearchResult } from './api'
import { mergeBatches, nextBatch, resultIdentity, type ResultBatch } from './result-batches'

const result = (url: string, imageUrl?: string): SearchResult => ({ url, title: url, snippet: '', ...(imageUrl ? { imageUrl } : {}) })
const batch = (provider: ResultBatch['provider'], page: number, hasMore: boolean, ...urls: string[]): ResultBatch => ({
  provider, page, hasMore, results: urls.map(url => result(url)),
})
const pagers = [{ id: 'kagi' as const, maxPage: 10 }]

describe('Load more batches', () => {
  it('treats the same page from different engines as one result', () => {
    const identity = resultIdentity(result('https://example.com/guide'), 'web')
    expect(resultIdentity(result('http://www.example.com/guide/?utm_source=kagi&fbclid=1#top'), 'web')).toBe(identity)
    expect(resultIdentity(result('https://EXAMPLE.com./guide'), 'web')).toBe(identity)
    expect(resultIdentity(result('https://example.com/Guide'), 'web')).not.toBe(identity)
    expect(resultIdentity(result('https://example.com/guide?b=2&a=1'), 'web')).toBe(resultIdentity(result('https://example.com/guide?a=1&b=2'), 'web'))
    expect(resultIdentity(result('https://example.com/guide?page=2'), 'web')).not.toBe(identity)
  })

  it('compares images by the image rather than the page that shows it', () => {
    const page = 'https://example.com/gallery'
    expect(resultIdentity(result(page, 'https://images.example.com/a.jpg'), 'images'))
      .not.toBe(resultIdentity(result(page, 'https://images.example.com/b.jpg'), 'images'))
  })

  it('keeps the first copy of a result and counts what each batch added', () => {
    const merged = mergeBatches([
      batch('firecrawl', 1, false, 'https://example.com/a', 'https://example.com/b'),
      batch('kagi', 1, true, 'https://www.example.com/b/', 'https://example.com/c'),
    ], 'web')
    expect(merged.results.map(item => item.url)).toEqual(['https://example.com/a', 'https://example.com/b', 'https://example.com/c'])
    expect(merged.added).toEqual([2, 1])
    expect(merged.batchOf.get(merged.results[2]!)).toBe(1)
  })

  it('continues the same engine while it has pages', () => {
    expect(nextBatch([batch('kagi', 1, true, 'a')], pagers)).toEqual({ provider: 'kagi', page: 2 })
    expect(nextBatch([batch('kagi', 1, false, 'a')], pagers)).toBeUndefined()
    expect(nextBatch([batch('kagi', 10, true, 'a')], pagers)).toBeUndefined()
  })

  it('hands a single-page engine to a paging engine once, then follows that engine', () => {
    const first = batch('firecrawl', 1, false, 'a')
    expect(nextBatch([first], pagers)).toEqual({ provider: 'kagi', page: 1 })
    expect(nextBatch([first, batch('kagi', 1, true, 'b')], pagers)).toEqual({ provider: 'kagi', page: 2 })
    expect(nextBatch([first, batch('kagi', 1, false, 'b')], pagers)).toBeUndefined()
    expect(nextBatch([first], [])).toBeUndefined()
  })

  it('pages reusable images by their own result count', () => {
    expect(nextBatch([batch('openverse', 1, true, 'a')], [])).toEqual({ provider: 'openverse', page: 2 })
    expect(nextBatch([batch('openverse', 3, false, 'a')], [])).toBeUndefined()
  })
})
