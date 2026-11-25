// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
