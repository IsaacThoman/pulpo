// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlacesAnswer } from './PlacesAnswer'
import type { PlaceMapPin } from './PlacesMap'

vi.mock('./PlacesMap', () => ({
  default: ({ pins }: { pins: PlaceMapPin[] }) => <section aria-label="Map of listed places">
    {pins.map(pin => <span key={pin.id}>{pin.name} ({pin.coordinates.join(', ')})</span>)}
  </section>,
}))

const style = 'https://tiles.openfreemap.org/styles/positron'
const places = [
  { name: 'Market Books', address: '1 Market St', coordinates: [47.6, -122.34] as [number, number], openNow: true },
  { name: 'City Books', address: '2 Union St', coordinates: [47.61, -122.33] as [number, number], openNow: false },
  { name: 'Travel Books', address: '3 Pine St' },
]

function showPlaces() {
  render(<PlacesAnswer response={{ provider: 'firecrawl', results: places }} openNow={false} webExpanded={false} onWeb={vi.fn()} />)
}

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('Places map disclosure', () => {
  it.each(['', 'https://tiles.openfreemap.org.example.com/styles/positron', style + '?query=coffee'])('hides the map for an unconfigured or unsupported style URL %j', url => {
    vi.stubEnv('VITE_SEARCH_PLACES_MAP_STYLE_URL', url)
    showPlaces()
    expect(screen.queryByRole('button', { name: 'Show map' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Market Books' })).toBeDefined()
  })

  it('mounts the map on request and keeps the pins synchronized with the displayed listings', async () => {
    vi.stubEnv('VITE_SEARCH_PLACES_MAP_STYLE_URL', style)
    showPlaces()
    const toggle = screen.getByRole('button', { name: 'Show map' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('region', { name: 'Map of listed places' })).toBeNull()

    fireEvent.click(toggle)
    const map = await screen.findByRole('region', { name: 'Map of listed places' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(within(map).getByText('Market Books (-122.34, 47.6)')).toBeDefined()
    expect(within(map).getByText('City Books (-122.33, 47.61)')).toBeDefined()
    expect(within(map).queryByText(/Travel Books/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Open now' }))
    expect(within(map).queryByText(/City Books/)).toBeNull()
    expect(screen.queryByRole('heading', { name: 'City Books' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Hide map' }))
    expect(screen.queryByRole('region', { name: 'Map of listed places' })).toBeNull()
    expect(document.activeElement).toBe(toggle)
    expect(screen.getByRole('heading', { name: 'Market Books' })).toBeDefined()
  })
})
