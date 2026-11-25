import { afterEach, describe, expect, it, vi } from 'vitest'
import { KagiClient } from './kagi.js'

afterEach(() => vi.unstubAllGlobals())

describe('Kagi client', () => {
  it('formats and limits search results for the model', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      meta: { trace: 'trace-search' },
      data: { search: [
        { title: 'One', url: 'https://one.example', snippet: 'First   result', time: '2026-08-03' },
        { title: 'Two', url: 'https://two.example', snippet: 'Second result' },
      ] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const result = await new KagiClient('secret').search({ query: 'pulpo', limit: 1, includeDomains: ['Example.com'] })
    expect(result.trace).toBe('trace-search')
    expect(result.output).toContain('[One](https://one.example)')
    expect(result.output).not.toContain('Two')
    expect(fetch).toHaveBeenCalledWith('https://kagi.com/api/v1/search', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer secret' }),
    }))
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({ query: 'pulpo', limit: 1, lens: { sites_included: ['example.com'] } })
  })

  it('maps a selected search category into safe, unescaped display data', async () => {
    const example = {
      url: 'https://example.com/page', title: '<b>Image</b> &amp; example', snippet: '&#x1f4f7; Photo',
      image: { url: 'https://cdn.example.com/image.png' }, time: '2026-11-24',
    }
    const fetch = vi.fn().mockResolvedValue(Response.json({
      data: {
        image: [example, { ...example, url: 'https://example.com/duplicate' }, { ...example, url: 'javascript:alert(1)' },
          { ...example, url: 'https://example.com/private', image: { url: 'https://127.0.0.1/image.png' } }],
        search: [{ title: 'Unrelated', url: 'https://example.com/unrelated' }],
        related_search: [{ title: 'other query' }, { props: { query: 'other query' } }],
      },
    }))
    vi.stubGlobal('fetch', fetch)
    await expect(new KagiClient('secret').searchResults({ query: 'pulpo', category: 'images', region: 'CA', timeRelative: 'day' })).resolves.toEqual({
      results: [{
        url: 'https://example.com/page', title: 'Image & example', snippet: '📷 Photo', imageUrl: 'https://cdn.example.com/image.png', publishedAt: '2026-11-24',
      }],
      hasMore: false,
      related: ['other query'],
    })
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({
      workflow: 'images', filters: { region: 'CA', safe_search: true }, lens: { time_relative: 'day' },
    })
  })

  it('keeps image dimensions and separate provider thumbnails, with validated URL fallbacks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      data: { image: [{
        url: 'https://example.com/page', title: 'Landscape',
        image: { url: 'https://p.kagi.com/large.jpg', width: 960, height: 640 },
        props: { thumbnail: { url: 'https://p.kagi.com/thumb.jpg', width: 200, height: 133 } },
      }, {
        url: 'https://example.com/second-page', title: 'Close-up',
        image: { url: 'http://127.0.0.1/large.jpg', width: 1000, height: 900 },
        props: { thumbnail: { url: 'https://p.kagi.com/second-thumb.jpg' } },
      }] },
    })))
    await expect(new KagiClient('secret').searchResults({ query: 'landscape', category: 'images' })).resolves.toMatchObject({
      results: [{
        title: 'Landscape', imageUrl: 'https://p.kagi.com/large.jpg', thumbnailUrl: 'https://p.kagi.com/thumb.jpg',
        imageDimensions: { width: 960, height: 640 },
      }, {
        title: 'Close-up', imageUrl: 'https://p.kagi.com/second-thumb.jpg',
      }],
    })
  })

  it('exposes observed media duration and credit fields while dropping invalid metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({
      data: {
        video: [{
          url: 'https://video.example.com/concert', title: 'Concert',
          props: { creator_name: '<b>Music</b> &amp; Live', duration: '05:31', creator_id: 'unused' },
        }, {
          url: 'https://video.example.com/session', title: 'Session', props: { duration: '10:99' },
        }],
        podcast: [
          { url: 'https://pod.example.com/episode', title: 'Episode', props: { duration: '1:04:49', group_id: 'opaque-feed-id' } },
        ],
      },
    }))))
    const client = new KagiClient('secret')
    const videos = await client.searchResults({ query: 'concert', category: 'videos' })
    expect(videos.results).toEqual([{
      url: 'https://video.example.com/concert', title: 'Concert', snippet: '', creatorName: 'Music & Live', duration: '05:31',
    }, {
      url: 'https://video.example.com/session', title: 'Session', snippet: '',
    }])
    const podcasts = await client.searchResults({ query: 'episode', category: 'podcasts' })
    expect(podcasts.results).toEqual([{
      url: 'https://pod.example.com/episode', title: 'Episode', snippet: '', duration: '1:04:49',
    }])
  })

  it('truncates extracted Markdown before returning it to the model', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      meta: { trace: 'trace-extract' }, data: [{ url: 'https://example.com/page', markdown: 'abcdefghij' }],
    }), { status: 200 })))
    const result = await new KagiClient('secret').extract('https://example.com/page', 5)
    expect(result.output).toContain('abcde')
    expect(result.output).not.toContain('fghij')
    expect(result.output).toContain('Content truncated at 5 bytes')
  })

  it('marks a successful empty extraction as fallback-worthy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      meta: { trace: 'trace-empty' }, data: [{ url: 'https://example.com/new', markdown: null, error: 'Page unavailable' }],
    }), { status: 200 })))
    await expect(new KagiClient('secret').extract('https://example.com/new', 100)).resolves.toMatchObject({
      output: '', trace: 'trace-empty', emptyReason: 'Page unavailable',
    })
  })

  it('rejects non-HTTPS extraction URLs before calling Kagi', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(new KagiClient('secret').extract('http://localhost/private', 100)).rejects.toThrow('public HTTPS URL')
    expect(fetch).not.toHaveBeenCalled()
  })
})
