// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchResponse } from './api'
import { homeLocation } from './navigation'
import { loadPreferences } from './preferences'
import { Results } from './Results'
import { firstVisibleResultUrl } from './result-order'

afterEach(cleanup)

const data: SearchResponse = {
  provider: 'kagi',
  results: [
    { url: 'https://github.com/guide/v1/guide%20intro?q=secret', title: 'Octopus guide', snippet: 'The octopus can use tools.', publishedAt: '2026-11-24' },
    { url: 'https://en.wikipedia.org/wiki/Octopus', title: 'Octopus · Wikipedia', snippet: 'An overview of octopuses.' },
    { url: 'javascript:alert(1)', title: 'Unsafe', snippet: '' },
    { url: 'https://100.64.0.2/secret', title: 'Private host', snippet: '' },
  ],
  related: ['octopus tool use', 'octopus habitat'],
}

const docsResult = (path: string, title: string) => ({ url: `https://docs.python.org/${path}`, title, snippet: '' })

describe('search result presentation', () => {
  it('highlights matching query words and displays a readable path and date', () => {
    const { container } = render(<Results data={data} location={{ ...homeLocation, query: 'the Octopus site:github.com' }}
      preferences={loadPreferences()} setDomain={vi.fn()} onQuery={vi.fn()} />)
    expect([...container.querySelectorAll('mark')].map(mark => mark.textContent)).toEqual(['octopus'])
    expect(screen.getByText('› guide › v1 › guide intro')).toBeDefined()
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-24')
    expect(screen.queryByRole('link', { name: 'Unsafe' })).toBeNull()
  })

  it('displays provider calendar dates in UTC and shows confirmed media metadata', () => {
    const DateTimeFormat = Intl.DateTimeFormat
    const formatter = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (_locale, options) {
      return new DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', ...options })
    })
    try {
      const { container } = render(<Results data={{
        ...data, results: [{ ...data.results[0], publishedAt: '2017-07-04T00:00:00.000Z', duration: '05:31', creatorName: 'Reef Research' }],
      }} location={{ ...homeLocation, category: 'videos', query: 'octopus' }}
        preferences={loadPreferences()} setDomain={vi.fn()} onQuery={vi.fn()} />)
      expect(container.querySelector('time')?.textContent).toBe('Jul 4, 2017')
      expect(screen.getByTitle('Date reported by the search provider')).toBeDefined()
      expect(screen.getByText('Reef Research · 05:31')).toBeDefined()
    } finally {
      formatter.mockRestore()
    }
  })

  it('puts supplied video metadata near the title and keeps player loading opt-in', () => {
    const videos: SearchResponse = { ...data, results: [
      { url: 'https://www.youtube.com/watch?v=M7lc1UVf-VE', title: 'Adjust a rear derailleur', snippet: 'A workshop tutorial.',
        imageUrl: 'https://images.example.org/video.webp', creatorName: 'Park Tool', duration: '05:31', publishedAt: '2026-11-24' },
      { url: 'https://video.example.org/tutorial', title: 'Workshop tips', snippet: 'More bike maintenance tips.' },
    ] }
    const { container } = render(<Results data={videos} location={{ ...homeLocation, category: 'videos', query: 'bike' }}
      preferences={loadPreferences()} setDomain={vi.fn()} onQuery={vi.fn()} />)
    const first = screen.getByRole('heading', { name: 'Adjust a rear derailleur' }).closest('li')
    expect(first?.querySelector('.result-media img')?.getAttribute('src')).toBe('https://images.example.org/video.webp')
    expect(first?.querySelector('.video-result-runtime')?.textContent).toBe('05:31')
    expect(first?.querySelector('.video-result-details')?.textContent).toContain('Park Tool · 05:31')
    expect(first?.querySelector('.video-result-details time')?.getAttribute('datetime')).toBe('2026-11-24')
    expect(screen.getByRole('button', { name: 'Watch here: Adjust a rear derailleur' })).toBeDefined()
    expect(container.querySelector('iframe')).toBeNull()
    const unsourced = screen.getByRole('heading', { name: 'Workshop tips' }).closest('li')
    expect(unsourced?.querySelector('.video-result-details')).toBeNull()
    expect(unsourced?.querySelector('.result-media')).toBeNull()
  })

  it('filters confirmed video runtimes on the current page and preserves ranking within each range', () => {
    const videos: SearchResponse = { ...data, results: [
      { url: 'https://video.example.org/short', title: 'Short tutorial', snippet: '', duration: '04:59' },
      { url: 'https://video.example.org/medium', title: 'Medium tutorial', snippet: '', duration: '05:00' },
      { url: 'https://video.example.org/shorter', title: 'Shorter tutorial', snippet: '', duration: '00:54' },
      { url: 'https://video.example.org/long', title: 'Long tutorial', snippet: '', duration: '0:20:00' },
      { url: 'https://video.example.org/unknown', title: 'Unknown runtime', snippet: '' },
      { url: 'https://video.example.org/zero', title: 'Zero runtime', snippet: '', duration: '00:00' },
    ] }
    const props = { data: videos, preferences: loadPreferences(), setDomain: vi.fn(), onQuery: vi.fn(),
      location: { ...homeLocation, category: 'videos' as const, query: 'tutorial' } }
    const { container, rerender } = render(<Results {...props} />)
    expect(screen.getByRole('link', { name: 'Unknown runtime' })).toBeDefined()
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Duration' })
    fireEvent.change(select, { target: { value: 'short' } })
    const visibleTitles = () => [...container.querySelectorAll('.result-link')].map(link => link.textContent)
    expect(visibleTitles()).toEqual(['Short tutorial', 'Shorter tutorial'])
    expect(screen.getByText('2 of 6 videos on this page · 2 without a reported duration')).toBeDefined()
    fireEvent.change(select, { target: { value: 'medium' } })
    expect(visibleTitles()).toEqual(['Medium tutorial'])
    fireEvent.change(select, { target: { value: 'long' } })
    expect(visibleTitles()).toEqual(['Long tutorial'])
    rerender(<Results {...props} location={{ ...props.location, page: 2 }} />)
    expect(select.value).toBe('any')
    expect(visibleTitles()).toHaveLength(6)
  })

  it('leaves duration filtering out when most displayed videos have no reported runtime', () => {
    const videos: SearchResponse = { ...data, results: [
      { url: 'https://video.example.org/short', title: 'Short tutorial', snippet: '', duration: '04:59' },
      { url: 'https://video.example.org/invalid', title: 'Invalid runtime', snippet: '', duration: '4:65' },
      { url: 'https://video.example.org/unknown', title: 'Unknown runtime', snippet: '' },
    ] }
    render(<Results data={videos} location={{ ...homeLocation, category: 'videos', query: 'tutorial' }}
      preferences={loadPreferences()} setDomain={vi.fn()} onQuery={vi.fn()} />)
    expect(screen.queryByRole('combobox', { name: 'Duration' })).toBeNull()
    expect(screen.getByText('04:59')).toBeDefined()
    expect(screen.queryByText('4:65')).toBeNull()
    expect(screen.getByRole('link', { name: 'Unknown runtime' })).toBeDefined()
  })

  it('sends only a public hostname for lazy favicons and shows a local fallback on error', () => {
    const { container } = render(<Results data={data} location={{ ...homeLocation, query: 'octopus' }}
      preferences={loadPreferences()} setDomain={vi.fn()} onQuery={vi.fn()} />)
    const icons = [...container.querySelectorAll('.site-icon img')]
    expect(icons.map(icon => icon.getAttribute('src'))).toEqual([
      '/api/search/favicon/github.com',
      '/api/search/favicon/en.wikipedia.org',
    ])
    expect(icons[0].getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(icons[0].getAttribute('loading')).toBe('lazy')
    const wrapper = icons[0].parentElement!
    fireEvent.error(icons[0])
    expect(wrapper.querySelector('img')).toBeNull()
    expect(wrapper.querySelector('svg')).toBeDefined()
  })

  it('uses the same ranked first visible result for direct navigation', () => {
    const preferences = { ...loadPreferences(), domains: { 'github.com': 'hide', 'en.wikipedia.org': 'pin' } } as const
    const { container } = render(<Results data={data} location={{ ...homeLocation, query: 'octopus' }}
      preferences={preferences} setDomain={vi.fn()} onQuery={vi.fn()} />)
    const firstVisible = container.querySelector('.result-link')?.getAttribute('href')
    expect(firstVisible).toBe('https://en.wikipedia.org/wiki/Octopus')
    expect(firstVisibleResultUrl(data, preferences)?.href).toBe(firstVisible)
  })

  it('keeps related searches outside the primary results and submits them on selection', () => {
    const onQuery = vi.fn()
    render(<Results data={data} location={{ ...homeLocation, query: 'octopus' }}
      preferences={loadPreferences()} setDomain={vi.fn()} onQuery={onQuery} />)
    expect(screen.getByRole('complementary', { name: 'Related searches' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'octopus habitat' }))
    expect(onQuery).toHaveBeenCalledWith('octopus habitat')
  })

  it('keeps adjacent links from a site together without changing their navigation order', () => {
    const duplicates = { ...data, results: [
      ...data.results.slice(0, 1),
      { url: 'https://github.com/guide/examples', title: 'Octopus examples', snippet: 'More references.' },
      ...data.results.slice(1),
    ] }
    const preferences = loadPreferences()
    const { container, rerender } = render(<Results data={duplicates} location={{ ...homeLocation, query: 'octopus' }}
      preferences={preferences} setDomain={vi.fn()} onQuery={vi.fn()} />)
    expect(screen.getByRole('list', { name: 'More from github.com' }).textContent).toBe('Octopus examples')
    expect(container.querySelectorAll('.result-link')[1]?.textContent).toBe('Octopus examples')
    expect(firstVisibleResultUrl(duplicates, preferences)?.href).toBe(duplicates.results[0].url)
    rerender(<Results data={duplicates} location={{ ...homeLocation, query: 'octopus site:github.com' }}
      preferences={preferences} setDomain={vi.fn()} onQuery={vi.fn()} />)
    expect(screen.queryByRole('list', { name: 'More from github.com' })).toBeNull()
  })

  it('keeps snippets visible after the first two adjacent same-site links', () => {
    const grouped = { ...data, results: Array.from({ length: 4 }, (_, index) => ({
      url: 'https://example.org/' + index, title: 'Result ' + index, snippet: 'Details for result ' + index,
    })) }
    render(<Results data={grouped} location={{ ...homeLocation, query: 'sample' }}
      preferences={loadPreferences()} setDomain={vi.fn()} onQuery={vi.fn()} />)
    expect(screen.getByRole('list', { name: 'More from example.org' }).querySelectorAll('a')).toHaveLength(2)
    expect(screen.getByText('Details for result 3')).toBeDefined()
  })

  it('sorts dated news on this page and preserves reported relative labels', () => {
    const news = { ...data, results: [
      { url: 'https://a.example.org/story', title: 'Undated', snippet: '' },
      { url: 'https://b.example.org/story', title: 'Earlier news', snippet: '', publishedAt: '3 days ago' },
      { url: 'https://c.example.org/story', title: 'Recent news', snippet: '', publishedAt: '2 hours ago' },
    ] }
    const { container } = render(<Results data={news} location={{ ...homeLocation, category: 'news', query: 'telescope' }}
      preferences={loadPreferences()} setDomain={vi.fn()} onQuery={vi.fn()} />)
    const titles = () => [...container.querySelectorAll('.result-link')].map(link => link.textContent)
    expect(titles()).toEqual(['Undated', 'Earlier news', 'Recent news'])
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort news' }), { target: { value: 'newest' } })
    expect(titles()).toEqual(['Recent news', 'Earlier news', 'Undated'])
    expect(screen.getByText('2 hours ago')).toBeDefined()
  })

  it('shows the relative age of recent timestamps and preserves date-only stories', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-25T04:30:00.000Z'))
    try {
      const news = { ...data, results: [
        { url: 'https://a.example.org/recent', title: 'Recent news', snippet: '', publishedAt: '2026-11-25T02:30:00.000Z' },
        { url: 'https://b.example.org/archive', title: 'Calendar date', snippet: '', publishedAt: '2026-11-24' },
      ] }
      const { container } = render(<Results data={news} location={{ ...homeLocation, category: 'news', query: 'telescope' }}
        preferences={loadPreferences()} setDomain={vi.fn()} onQuery={vi.fn()} />)
      expect(screen.getByText('2 hours ago').getAttribute('datetime')).toBe('2026-11-25T02:30:00.000Z')
      expect(container.querySelector('time[datetime="2026-11-24"]')?.textContent).toBe('Nov 24, 2026')
    } finally {
      vi.useRealTimers()
    }
  })

  it('puts nearby versions of the same documentation behind the top-ranked result on site searches', async () => {
    const docs: SearchResponse = { ...data, results: [
      docsResult('3/library/tomllib.html', 'tomllib'),
      docsResult('3.11/library/tomllib.html', 'Python 3.11 tomllib'),
      docsResult('3/library/json.html', 'json'),
      docsResult('release/3.11.0/library/tomllib.html', 'Python 3.11.0 tomllib'),
      docsResult('3.12/library/tomllib.html#exceptions', 'tomllib exceptions'),
      docsResult('3.12/library/tomllib.html', 'Python 3.12 tomllib'),
    ] }
    const preferences = { ...loadPreferences(), newTab: true }
    const { container } = render(<Results data={docs} location={{ ...homeLocation, query: 'site:docs.python.org "tomllib"' }}
      preferences={preferences} setDomain={vi.fn()} onQuery={vi.fn()} />)
    expect([...container.querySelectorAll('.result-link')].map(link => link.textContent)).toEqual(['tomllib', 'json', 'tomllib exceptions'])
    expect(firstVisibleResultUrl(docs, preferences)?.href).toBe(docs.results[0].url)
    const summary = screen.getByText('Other versions (3)')
    fireEvent.click(summary)
    const link = await screen.findByRole('link', { name: 'Version 3.11' })
    expect(link.getAttribute('target')).toBe('_blank')
    const versions = screen.getByRole('list', { name: 'Other versions of tomllib' })
    expect([...versions.querySelectorAll('a')].map(result => result.href)).toEqual([docs.results[1].url, docs.results[3].url, docs.results[5].url])
    fireEvent.click(summary)
    await waitFor(() => expect(container.querySelector('a[aria-label="Version 3.11"]')).toBeNull())
  })

  it.each(['tomllib python3.11', 'tomllib in 3.11 vs 3.12', 'compare tomllib releases'])('keeps distinct versions visible for %s', query => {
    const docs: SearchResponse = { ...data, results: [
      docsResult('3.11/library/tomllib.html', 'Python 3.11 tomllib'),
      docsResult('3.12/library/tomllib.html', 'Python 3.12 tomllib'),
    ] }
    render(<Results data={docs} location={{ ...homeLocation, query: `site:docs.python.org ${query}` }}
      preferences={loadPreferences()} setDomain={vi.fn()} onQuery={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'Python 3.11 tomllib' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Python 3.12 tomllib' })).toBeDefined()
    expect(screen.queryByText(/Other versions/)).toBeNull()
  })

  it('avoids grouping into a distant result or treating numbers in regular site paths as versions', () => {
    const docs: SearchResponse = { ...data, results: [
      docsResult('3/library/tomllib.html', 'tomllib'),
      docsResult('3/library/json.html', 'json'),
      docsResult('3/library/tarfile.html', 'tarfile'),
      docsResult('3/library/zipfile.html', 'zipfile'),
      docsResult('3.12/library/tomllib.html', 'Python 3.12 tomllib'),
      { url: 'https://example.com/1/lessons/toml', title: 'Lesson 1', snippet: '' },
      { url: 'https://example.com/2/lessons/toml', title: 'Lesson 2', snippet: '' },
    ] }
    render(<Results data={docs} location={{ ...homeLocation, query: 'toml site:docs.python.org site:example.com' }}
      preferences={loadPreferences()} setDomain={vi.fn()} onQuery={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'Python 3.12 tomllib' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Lesson 2' })).toBeDefined()
    expect(screen.queryByText(/Other versions/)).toBeNull()
  })

  it('shows sourced knowledge facts and respects the result source preference', () => {
    const featured = { ...data, knowledge: {
      title: 'Octopus', summary: 'A marine mollusc.', url: 'https://en.wikipedia.org/wiki/Octopus',
      facts: [{ label: 'Class', value: 'Cephalopoda' }],
    } }
    const location = { ...homeLocation, query: 'octopus' }
    const preferences = loadPreferences()
    const { rerender } = render(<Results data={featured} location={location}
      preferences={preferences} setDomain={vi.fn()} onQuery={vi.fn()} />)
    const knowledge = screen.getByRole('complementary', { name: 'About Octopus' })
    expect(knowledge.textContent).toContain('Cephalopoda')
    expect(knowledge.querySelector('a')?.getAttribute('href')).toBe(featured.knowledge.url)
    expect(screen.getByRole('link', { name: 'CC BY-SA 4.0' })).toBeDefined()
    expect(firstVisibleResultUrl(featured, preferences)?.hostname).toBe('github.com')
    rerender(<Results data={featured} location={location}
      preferences={{ ...preferences, domains: { 'en.wikipedia.org': 'hide' } }} setDomain={vi.fn()} onQuery={vi.fn()} />)
    expect(screen.queryByRole('complementary', { name: 'About Octopus' })).toBeNull()
  })
})
