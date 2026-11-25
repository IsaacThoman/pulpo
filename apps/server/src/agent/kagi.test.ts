import { afterEach, describe, expect, it, vi } from 'vitest'
import { KagiClient } from './kagi.js'
import type { ProviderSearchInput } from './search-results.js'

afterEach(() => vi.unstubAllGlobals())

const curieInfobox = {
  url: 'https://en.wikipedia.org/wiki/Marie_Curie',
  title: '<strong>Marie Curie</strong>',
  snippet: '<p><b>Marie Curie</b> was a physicist &amp; chemist [1].</p><p>She studied radioactivity.</p><script data-example="a < b">ignore this</script>',
  image: { url: 'https://example.com/photo' },
  props: { infobox: [
    { key: 'Born', value: '7 November 1867<br class="line"> <a title="Poland > city" href="/wiki/Warsaw">Warsaw</a><sup class="reference">2</sup>' },
    { key: 'Awards', value: 'Nobel Prize in Physics<br/>Nobel Prize in Chemistry &#91;note 3&#93;' },
    { key: 'Spouse', value: '<a href="https://en.wikipedia.org/wiki/Pierre_Curie">Pierre Curie</a> <i>(m. 1895)</i>' },
    { key: 'born', value: 'Duplicate' },
    { key: 'Invalid fact', value: { url: 'https://example.com' } },
    { key: 'Invalid markup', value: '&lt;img src=bad&gt;' },
    { key: 'Incomplete markup', value: '<script>ignore this' },
    { key: 'Empty', value: '[12]' },
    { key: ' ', value: 'Missing label' },
    null,
  ] },
}

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

  it('adds plain-text Wikipedia knowledge from the same call while preserving Web results and direct answers', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: {
      search: [{ title: 'First', url: 'https://example.com/first', snippet: 'First result' },
        { title: 'Second', url: 'https://example.com/second', snippet: 'Second result' }],
      direct_answer: [{ title: 'Answer', url: 'https://example.com/answer', snippet: 'Direct answer' }],
      infobox: [curieInfobox],
    } }))
    vi.stubGlobal('fetch', fetch)

    await expect(new KagiClient('secret').searchResults({ query: 'Marie Curie', limit: 2 })).resolves.toEqual({
      results: [{ title: 'First', url: 'https://example.com/first', snippet: 'First result' },
        { title: 'Second', url: 'https://example.com/second', snippet: 'Second result' }],
      hasMore: true,
      answer: { title: 'Answer', url: 'https://example.com/answer', snippet: 'Direct answer' },
      knowledge: {
        title: 'Marie Curie',
        summary: 'Marie Curie was a physicist & chemist. She studied radioactivity.',
        url: 'https://en.wikipedia.org/wiki/Marie_Curie',
        facts: [{ label: 'Born', value: '7 November 1867 Warsaw' },
          { label: 'Awards', value: 'Nobel Prize in Physics Nobel Prize in Chemistry' },
          { label: 'Spouse', value: 'Pierre Curie (m. 1895)' }],
      },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('chooses the first valid Wikipedia article and accepts summary-only knowledge', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: { infobox: [
      null,
      ...[
        'http://en.wikipedia.org/wiki/Marie_Curie',
        'https://en.wikipedia.org.evil.example/wiki/Marie_Curie',
        'https://en.wikipedia.org:9000/wiki/Marie_Curie',
        'https://user@en.wikipedia.org/wiki/Marie_Curie',
        'https://en.wikipedia.org/wiki/',
        'https://en.wikipedia.org/wiki/Marie_Curie?action=edit',
        'https://en.wikipedia.org/wiki/Special%3ARandom',
        'https://en.wikipedia.org/w/index.php?title=Marie_Curie',
      ].map(url => ({ ...curieInfobox, url })),
      { ...curieInfobox, snippet: '<br>[1]' },
      { ...curieInfobox, title: ['Broken title'] },
      { title: 'Équidistance', snippet: '<p>Deux distances sont égales.</p>', url: 'https://fr.wikipedia.org/wiki/%C3%89quidistance#Exemple' },
    ] } })))

    await expect(new KagiClient('secret').searchResults({ query: '"literal site:operator"' })).resolves.toEqual({
      results: [],
      hasMore: false,
      knowledge: {
        title: 'Équidistance', summary: 'Deux distances sont égales.', url: 'https://fr.wikipedia.org/wiki/%C3%89quidistance', facts: [],
      },
    })
  })

  it('bounds the knowledge summary and number and length of facts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: { infobox: [{
      ...curieInfobox,
      title: 'Title '.repeat(70),
      snippet: 'Summary words '.repeat(100),
      props: { infobox: Array.from({ length: 20 }, (_, index) => ({
        key: `Label ${index} ` + 'descriptor '.repeat(30), value: 'Fact value '.repeat(100),
      })) },
    }] } })))

    const { knowledge } = await new KagiClient('secret').searchResults({ query: 'Marie Curie' })
    expect(knowledge?.title.length).toBeLessThanOrEqual(200)
    expect(knowledge?.summary.length).toBeLessThanOrEqual(800)
    expect(knowledge?.summary.endsWith('…')).toBe(true)
    expect(knowledge?.facts).toHaveLength(8)
    for (const fact of knowledge!.facts) {
      expect(fact.label.length).toBeLessThanOrEqual(72)
      expect(fact.value.length).toBeLessThanOrEqual(300)
    }
  })

  it.each([
    { category: 'news' }, { page: 2 }, { region: 'CA' }, { timeRelative: 'day' },
    { dateRange: { from: '2024-01-01', to: '2024-01-01' } },
    { includeDomains: ['wikipedia.org'] }, { excludeDomains: ['example.com'] },
    { query: 'Marie Curie site:wikipedia.org' }, { query: 'Marie Curie AND (-site:example.com OR site:wikipedia.org)' },
  ] satisfies Array<Partial<ProviderSearchInput>>)('omits knowledge for restricted searches %j', async (input) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: { infobox: [curieInfobox] } })))

    await expect(new KagiClient('secret').searchResults({ query: 'Marie Curie', ...input })).resolves.not.toHaveProperty('knowledge')
  })

  it('includes the entire final day and omits undated direct answers about filtered results', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: {
      direct_answer: [{ title: 'Answer', snippet: 'Undated answer' }],
    } }))
    vi.stubGlobal('fetch', fetch)
    await expect(new KagiClient('secret').searchResults({
      query: 'new year', dateRange: { from: '2024-12-31', to: '2024-12-31' },
    })).resolves.not.toHaveProperty('answer')
    expect(JSON.parse(fetch.mock.calls[0]![1].body).filters).toEqual({
      safe_search: true, after: '2024-12-31', before: '2025-01-01',
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
          props: { creator_name: '<b>Music</b> &amp; Live', duration: '05:31', view_count: '547099', creator_id: 'unused' },
        }, {
          url: 'https://video.example.com/session', title: 'Session', props: { duration: '10:99' },
        }],
        podcast: [
          { url: 'https://pod.example.com/show/', title: 'Trailer', props: { duration: '2:00' } },
          { url: 'https://radio.example.com/', title: 'Episode', time: '2026-11-24', props: { duration: '1:04:49' } },
          { url: 'https://pod.example.com/episode', title: 'Episode', time: '2026-11-24', props: { duration: '1:04:49', group_id: 'opaque-feed-id' } },
        ],
        podcast_creator: [{ url: 'https://pod.example.com/show', title: 'The show', props: { duration: '53:40' } }],
      },
    }))))
    const client = new KagiClient('secret')
    const videos = await client.searchResults({ query: 'concert', category: 'videos' })
    expect(videos.results).toEqual([{
      url: 'https://video.example.com/concert', title: 'Concert', snippet: '', creatorName: 'Music & Live', duration: '05:31', viewCount: 547099,
    }, {
      url: 'https://video.example.com/session', title: 'Session', snippet: '',
    }])
    const podcasts = await client.searchResults({ query: 'episode', category: 'podcasts' })
    expect(podcasts.results).toEqual([{
      url: 'https://pod.example.com/episode', title: 'Episode', snippet: '', duration: '1:04:49', publishedAt: '2026-11-24',
    }])
    expect(podcasts.podcastShows).toEqual([{ url: 'https://pod.example.com/show', title: 'The show', snippet: '' }])
  })

  it('ranks the named original episode ahead of its rerun unless the query names the rerun', async () => {
    const rerun = { title: 'The Pool and the Stream (Redux)', url: 'https://example.com/redux' }
    const original = { title: 'The Pool and the Stream', url: 'https://example.com/original' }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ data: { podcast: [rerun, original] } }))))
    const client = new KagiClient('secret')
    const query = '99% Invisible The Pool and the Stream'
    const originalSearch = await client.searchResults({ query, category: 'podcasts' })
    expect(originalSearch.results.map(result => result.url)).toEqual([original.url, rerun.url])
    const rerunSearch = await client.searchResults({ query: query + ' redux', category: 'podcasts' })
    expect(rerunSearch.results.map(result => result.url)).toEqual([rerun.url, original.url])
  })

  it('never presents a Kagi News update timestamp as a publication date', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: { news: [{
      url: 'https://example.com/article', title: 'Article', time: '2026-11-24T08:26:22Z',
    }] } }))
    vi.stubGlobal('fetch', fetch)
    const { results } = await new KagiClient('secret').searchResults({
      query: 'starship', category: 'news', timeRelative: 'week', limit: 40, safeSearch: false,
    })
    expect(results).toEqual([{ url: 'https://example.com/article', title: 'Article', snippet: '' }])
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({ limit: 40, filters: { safe_search: false }, lens: { time_relative: 'week' } })
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
