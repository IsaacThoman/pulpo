// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchResponse, SearchResult } from './api'
import { defaultImageRefinements, matchesImageRefinements, type ImageRefinements } from './image-refinements'
import { homeLocation } from './navigation'
import { loadPreferences } from './preferences'
import { Results } from './Results'

afterEach(cleanup)

function image(title: string, width?: number, height?: number): SearchResult {
  return {
    title, url: 'https://example.com/' + title, imageUrl: 'https://cdn.example.com/' + title + '.jpg', snippet: '',
    ...(width && height ? { imageDimensions: { width, height } } : {}),
  }
}

const data: SearchResponse = {
  provider: 'kagi',
  results: [image('Small square', 600, 600), image('Medium tall', 500, 640), image('Large wide', 1280, 720), image('Unknown size')],
}
const location = { ...homeLocation, query: 'octopus', category: 'images' } as const

function matches(result: SearchResult, refinements: Partial<ImageRefinements> = {}) {
  const url = new URL(result.url)
  return matchesImageRefinements({ result, url, host: url.hostname, rule: undefined }, { ...defaultImageRefinements, ...refinements })
}

describe('image result refinement', () => {
  it('classifies size by longest side and only refines results with reported dimensions', () => {
    expect(matches(image('first-medium', 640, 320), { size: 'medium', aspect: 'wide' })).toBe(true)
    expect(matches(image('last-medium', 750, 1279), { size: 'medium', aspect: 'tall' })).toBe(true)
    expect(matches(image('first-large', 1280, 1280), { size: 'large', aspect: 'square' })).toBe(true)
    expect(matches(image('panorama', 1280, 640), { aspect: 'panoramic' })).toBe(true)
    expect(matches(image('wide', 1280, 641), { aspect: 'panoramic' })).toBe(false)
    expect(matches(image('no-dimensions'), { aspect: 'square' })).toBe(false)
    expect(matches(image('no-dimensions'))).toBe(true)
  })

  it('combines local filters and recovers from an empty outcome without another search', () => {
    const onQuery = vi.fn()
    render(<Results data={data} location={location} preferences={loadPreferences()} setDomain={vi.fn()} onQuery={onQuery} />)
    const controls = within(screen.getByRole('group', { name: 'Filter these results' }))
    const size = controls.getByLabelText('Size')
    const aspect = controls.getByLabelText('Aspect ratio')
    expect(screen.getByRole('link', { name: 'Unknown size' })).toBeDefined()
    fireEvent.change(size, { target: { value: 'large' } })
    expect(screen.getByRole('link', { name: 'Large wide' })).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Unknown size' })).toBeNull()
    expect(controls.getByText('1 of 4 images shown · 1 without reported dimensions')).toBeDefined()
    fireEvent.change(aspect, { target: { value: 'tall' } })
    expect(screen.getByRole('heading', { name: 'No images match these filters' })).toBeDefined()

    fireEvent.click(controls.getByRole('button', { name: 'Clear image filters' }))
    expect(document.activeElement).toBe(size)
    expect(screen.getByRole('link', { name: 'Unknown size' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Medium tall' })).toBeDefined()
    expect(onQuery).not.toHaveBeenCalled()
  })

  it('omits dimension controls when all returned images have unknown sizes', () => {
    render(<Results data={{ ...data, results: [image('Unknown size')] }} location={location}
      preferences={loadPreferences()} setDomain={vi.fn()} onQuery={vi.fn()} />)
    expect(screen.queryByRole('group', { name: 'Filter these results' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Unknown size' })).toBeDefined()
  })

  it('filters by source independently of dimensions and orders by confirmed source dates', () => {
    render(<Results data={{ ...data, results: [
      image('Undated'),
      { ...image('Recent'), url: 'https://example.org/recent', publishedAt: '2026-07-08T11:00:00Z' },
      { ...image('Earlier'), publishedAt: '2020-01-10' },
    ] }} location={location} preferences={loadPreferences()} setDomain={vi.fn()} onQuery={vi.fn()} />)
    expect(screen.queryByLabelText('Size')).toBeNull()
    const order = screen.getByLabelText('Order')
    expect(within(order).queryByRole('option', { name: 'Largest first' })).toBeNull()
    fireEvent.change(order, { target: { value: 'newest' } })
    const titles = () => screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent)
    expect(titles()).toEqual(['Recent', 'Earlier', 'Undated'])
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'example.com' } })
    expect(titles()).toEqual(['Earlier', 'Undated'])
  })

  it('keeps a controlled source selection while more images can load and can clear it', () => {
    const update = vi.fn()
    render(<Results data={{ ...data, hasMore: true }} location={location} preferences={loadPreferences()}
      more={{ next: { provider: 'kagi', switching: false }, loading: false, loadedMore: true, load: vi.fn() }}
      setDomain={vi.fn()} onQuery={vi.fn()} imageRefinements={{ value: { ...defaultImageRefinements, source: 'example.org' }, update }} />)
    expect(screen.getByRole('heading', { name: 'No images match these filters' })).toBeDefined()
    expect(screen.getByRole('option', { name: 'example.org (0)', selected: true })).toBeDefined()
    expect(screen.getByText('Clear the image filters or load more images.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Clear image filters' }))
    expect(update).toHaveBeenCalledWith(defaultImageRefinements)
  })

  it('reveals already loaded images, moves focus to the new batch, and does not run another query', () => {
    const onQuery = vi.fn()
    render(<Results data={{ ...data, results: Array.from({ length: 30 }, (_, i) => image('Octopus ' + (i + 1), 800, 600)) }}
      location={location} preferences={loadPreferences()} setDomain={vi.fn()} onQuery={onQuery} />)
    expect(screen.queryByRole('link', { name: 'Octopus 25' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(screen.getByRole('link', { name: 'Octopus 30' })).toBeDefined()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Preview image: Octopus 25' }))
    expect(onQuery).not.toHaveBeenCalled()
  })
})
