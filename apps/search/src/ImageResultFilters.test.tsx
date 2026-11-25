// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchResponse, SearchResult } from './api'
import { defaultImageRefinements, matchesImageRefinements } from './image-refinements'
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

describe('image result refinement', () => {
  it('classifies size by longest side and only refines results with reported dimensions', () => {
    expect(matchesImageRefinements(image('first-medium', 640, 320), { size: 'medium', aspect: 'wide' })).toBe(true)
    expect(matchesImageRefinements(image('last-medium', 750, 1279), { size: 'medium', aspect: 'tall' })).toBe(true)
    expect(matchesImageRefinements(image('first-large', 1280, 1280), { size: 'large', aspect: 'square' })).toBe(true)
    expect(matchesImageRefinements(image('no-dimensions'), { size: 'any', aspect: 'square' })).toBe(false)
    expect(matchesImageRefinements(image('no-dimensions'), defaultImageRefinements)).toBe(true)
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
})
