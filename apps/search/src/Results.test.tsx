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
})
