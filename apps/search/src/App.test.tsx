// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { api, SearchApiError, type SearchConfig, type SearchUser } from './api'

const user: SearchUser = { id: 'test-user', name: 'Casey', email: 'casey@example.com' }
const config: SearchConfig = {
  defaultOrder: ['kagi', 'firecrawl'],
  providers: [
    { id: 'kagi', categories: ['web', 'news'], dates: ['day', 'year'], customDateRanges: ['web', 'news'], region: true, priceMicros: 2000 },
    { id: 'firecrawl', categories: ['web', 'images'], dates: ['day', 'week'], customDateRanges: ['web'], region: true, priceMicros: 1000 },
  ],
}

describe('Pulpo Search', () => {
  const session = vi.spyOn(api, 'session')
  const getConfig = vi.spyOn(api, 'config')
  const search = vi.spyOn(api, 'search')
  const exchange = vi.spyOn(api, 'exchange')
  const logout = vi.spyOn(api, 'logout')
  const appearance = vi.spyOn(api, 'appearance')
  const weather = vi.spyOn(api, 'weather')
  const weatherAlerts = vi.spyOn(api, 'weatherAlerts')
  const currency = vi.spyOn(api, 'currency')
  const places = vi.spyOn(api, 'places')

  beforeEach(() => {
    session.mockResolvedValue({ user })
    getConfig.mockResolvedValue(config)
    search.mockImplementation(async ({ query }) => ({
      provider: 'kagi',
      results: [
        { url: 'https://example.com/', title: query + ' field guide', snippet: 'An overview' },
        { url: 'https://help.example.net/', title: 'Quick reference', snippet: 'Further reading' },
        { url: 'javascript:alert(1)', title: 'Unsafe link', snippet: '' },
      ],
    }))
    logout.mockResolvedValue()
    appearance.mockResolvedValue({ theme: 'system', colorTheme: 'pulpo' })
    weather.mockResolvedValue({ status: 'not-found', sources: [] })
    weatherAlerts.mockResolvedValue({ status: 'unavailable' })
    currency.mockResolvedValue({ status: 'unavailable', source: { name: 'ECB', url: 'https://www.ecb.europa.eu/', description: 'Daily reference rates' } })
    places.mockResolvedValue({ provider: 'brave', results: [] })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const preferences = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => preferences.get(key) ?? null,
      setItem: (key: string, value: string) => preferences.set(key, value),
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function () { this.open = true }
      HTMLDialogElement.prototype.close = function () { this.open = false }
    }
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  function submit(query: string) {
    fireEvent.change(screen.getByRole('combobox', { name: 'Search the web' }), { target: { value: query } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  }

  it('searches when submitted, shows safe links, and restores the cached results on back navigation', async () => {
    render(<App callback={null} />)
    await screen.findByLabelText('Pulpo account')
    expect(search).not.toHaveBeenCalled()
    submit('tide pools')
    const fieldGuide = await screen.findByRole('link', { name: 'tide pools field guide' })
    expect(fieldGuide.getAttribute('href')).toBe('https://example.com/')
    expect(screen.queryByText('Unsafe link')).toBeNull()
    expect(window.location.search).toBe('?q=tide+pools')
    fireEvent.keyDown(document.body, { key: 'j' })
    expect(document.activeElement).toBe(fieldGuide)

    submit('kelp forests')
    await screen.findByRole('link', { name: 'kelp forests field guide' })
    await act(async () => { window.history.back() })
    await screen.findByRole('link', { name: 'tide pools field guide' })
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('carries a signed-out query without running it and restores it after the handoff', async () => {
    session.mockResolvedValue({ user: null })
    window.history.replaceState(null, '', '/search?q=tide+pools')
    const { unmount } = render(<App callback={null} />)
    await screen.findByRole('heading', { name: 'Sign in to search' })
    expect(search).not.toHaveBeenCalled()
    unmount()

    exchange.mockResolvedValue({ user })
    render(<App callback={{ code: 'code', codeVerifier: 'verifier' }} />)
    await screen.findByRole('link', { name: 'tide pools field guide' })
    expect(exchange).toHaveBeenCalledWith('code', 'verifier')
  })

  it('uses provider and fallback changes on the next search and shows compatible filters', async () => {
    window.history.replaceState(null, '', '/search?q=tides')
    render(<App callback={null} />)
    await screen.findByRole('link', { name: 'tides field guide' })
    fireEvent.click(screen.getByRole('button', { name: 'Search settings' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Default'), { target: { value: 'firecrawl' } })
    fireEvent.change(within(dialog).getByLabelText('Fallback'), { target: { value: 'none' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(search).toHaveBeenCalledTimes(1)

    submit('kelp')
    await screen.findByRole('link', { name: 'kelp field guide' })
    expect(screen.queryByRole('button', { name: 'News' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Images' }))
    await waitFor(() => expect(search).toHaveBeenLastCalledWith(expect.objectContaining({
      query: 'kelp', category: 'images', providers: ['firecrawl'],
    }), expect.any(AbortSignal)))
    expect(window.location.search).toContain('type=images')
  })

  it('hides and restores sites locally without a second provider request', async () => {
    window.history.replaceState(null, '', '/search?q=tides')
    render(<App callback={null} />)
    await screen.findByRole('link', { name: 'tides field guide' })
    fireEvent.click(screen.getByLabelText('Options for example.com'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Hide site' })[0])
    expect(screen.queryByRole('link', { name: 'tides field guide' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 hidden result' }))
    expect(screen.getByRole('link', { name: 'tides field guide' })).toBeDefined()
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('suggests bangs without calling a provider', async () => {
    render(<App callback={null} />)
    await screen.findByLabelText('Pulpo account')
    const combobox = screen.getByRole('combobox', { name: 'Search the web' })
    fireEvent.change(combobox, { target: { value: '!w' } })
    const wikipedia = screen.getByRole('option', { name: '!w Wikipedia' })
    fireEvent.keyDown(combobox, { key: 'ArrowDown' })
    expect(wikipedia.getAttribute('aria-selected')).toBe('true')
    fireEvent.click(wikipedia)
    expect((combobox as HTMLInputElement).value).toBe('!w ')
    expect(search).not.toHaveBeenCalled()
  })

  it('keeps bangs typed inside an unfinished quote in the local search field', async () => {
    render(<App callback={null} />)
    await screen.findByLabelText('Pulpo account')
    const combobox = screen.getByRole('combobox', { name: 'Search the web' })
    fireEvent.change(combobox, { target: { value: '"what does !w' } })
    fireEvent.keyDown(combobox, { key: 'ArrowDown' })
    expect(screen.queryByRole('option', { name: '!w Wikipedia' })).toBeNull()
    expect((combobox as HTMLInputElement).value).toBe('"what does !w')
    expect(search).not.toHaveBeenCalled()
  })

  it('does not broaden a malformed date link into a paid search without approval', async () => {
    window.history.replaceState(null, '', '/search?q=eclipse&from=2024-04-09&to=2024-04-08')
    render(<App callback={null} />)
    await screen.findByRole('heading', { name: 'Invalid date range' })
    await screen.findByLabelText('Pulpo account')
    expect(search).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Clear date range' }))
    await screen.findByRole('link', { name: 'eclipse field guide' })
    expect(search).toHaveBeenCalledTimes(1)
    expect(window.location.search).toBe('?q=eclipse')
  })

  it('answers exact math signed out without a provider request and offers ordinary web results', async () => {
    session.mockResolvedValue({ user: null })
    window.history.replaceState(null, '', '/search?q=18.5%25+of+249')
    render(<App callback={null} />)
    expect(await screen.findByText('46.065')).toBeDefined()
    expect(search).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Search the web' }))
    await screen.findByRole('heading', { name: 'Sign in to search' })
    expect(window.location.search).toContain('web=1')
    expect(search).not.toHaveBeenCalled()
  })

  it('shows a local forecast in place of a paid web search and allows a unit change', async () => {
    getConfig.mockResolvedValue({ ...config, weather: true })
    weather.mockResolvedValue({
      status: 'forecast', place: { name: 'Seattle', admin: 'Washington', country: 'United States', timeZone: 'America/Los_Angeles' },
      forecast: {
        temperatureC: 10, condition: 'Cloudy', validAt: '2026-11-24T12:00:00Z', updatedAt: '2026-11-24T10:00:00Z',
        hourly: [{ validAt: '2026-11-24T13:00:00Z', temperatureC: 11, precipitationChance: 80 }],
        daily: [{ date: '2026-11-24', highC: 12, lowC: 4 }],
      },
      sources: [{ name: 'National Weather Service', url: 'https://www.weather.gov/', license: 'https://www.weather.gov/disclaimer' }],
    })
    weatherAlerts.mockResolvedValue({
      status: 'available',
      source: { name: 'National Weather Service', url: 'https://www.weather.gov/', license: 'https://www.weather.gov/disclaimer' },
      alerts: [{ event: 'Wind Advisory', severity: 'Moderate', effectiveAt: '2026-11-24T12:00:00Z',
        expiresAt: '2026-11-24T15:00:00Z', url: 'https://www.weather.gov/warnings' }],
    })
    window.history.replaceState(null, '', '/search?q=Seattle+weather')
    render(<App callback={null} />)
    const card = await screen.findByRole('region', { name: 'Weather forecast' })
    expect(weather).toHaveBeenCalledExactlyOnceWith('Seattle', expect.any(AbortSignal))
    expect(search).not.toHaveBeenCalled()
    expect(within(card).getByRole('region', { name: 'Hourly forecast' })).toBeDefined()
    expect((await within(card).findByRole('link', { name: 'Wind Advisory' })).getAttribute('href')).toBe('https://www.weather.gov/warnings')
    fireEvent.click(within(card).getByRole('button', { name: '°C' }))
    expect(within(card).getByText('10°C')).toBeDefined()
    fireEvent.click(within(card).getByRole('button', { name: 'Search the web' }))
    await screen.findByRole('link', { name: 'Seattle weather field guide' })
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('renders a dated currency quote without starting a paid search', async () => {
    getConfig.mockResolvedValue({ ...config, currency: true })
    currency.mockResolvedValue({
      status: 'converted', amount: '100', from: 'USD', to: 'EUR', converted: '91.22', rate: '0.9122', referenceDate: '2026-11-24',
      source: { name: 'European Central Bank', url: 'https://www.ecb.europa.eu/', description: 'Daily reference rates' },
    })
    window.history.replaceState(null, '', '/search?q=100+USD+to+EUR')
    render(<App callback={null} />)
    const card = await screen.findByRole('region', { name: 'Currency conversion' })
    expect(within(card).getByText('91.22 EUR')).toBeDefined()
    expect(within(card).getByRole('link', { name: 'European Central Bank' }).getAttribute('href')).toBe('https://www.ecb.europa.eu/')
    expect(currency).toHaveBeenCalledExactlyOnceWith({ amount: '100', from: 'USD', to: 'EUR' }, expect.any(AbortSignal))
    expect(search).not.toHaveBeenCalled()
    currency.mockResolvedValueOnce({
      status: 'converted', amount: '200', from: 'USD', to: 'EUR', converted: '182.44', rate: '0.9122', referenceDate: '2026-11-24',
      source: { name: 'European Central Bank', url: 'https://www.ecb.europa.eu/', description: 'Daily reference rates' },
    })
    fireEvent.change(within(card).getByRole('textbox', { name: 'Amount' }), { target: { value: '200' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Convert' }))
    await screen.findByText('182.44 EUR')
    expect(search).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Search the web' }))
    await screen.findByRole('link', { name: '200 USD to EUR field guide' })
  })

  it('falls back to ordinary results when a currency quote is unavailable', async () => {
    getConfig.mockResolvedValue({ ...config, currency: true })
    window.history.replaceState(null, '', '/search?q=50+GBP+to+JPY')
    render(<App callback={null} />)
    await screen.findByRole('link', { name: '50 GBP to JPY field guide' })
    expect(currency).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('recovers from a media provider error using Web results', async () => {
    search.mockRejectedValueOnce(new SearchApiError('Try again in a moment.', 502))
    window.history.replaceState(null, '', '/search?q=tide+pools&type=images')
    render(<App callback={null} />)
    await screen.findByRole('heading', { name: 'Couldn’t complete the search' })
    fireEvent.click(screen.getByRole('button', { name: 'Try Web results' }))
    await screen.findByRole('link', { name: 'tide pools field guide' })
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'web' }), expect.any(AbortSignal))
  })

  it('offers a Web search explicitly when a known weather location has no forecast', async () => {
    getConfig.mockResolvedValue({ ...config, weather: true })
    weather.mockResolvedValue({ status: 'unavailable', sources: [],
      place: { name: 'Portland', admin: 'Maine', country: 'United States', timeZone: 'America/New_York' } })
    window.history.replaceState(null, '', '/search?q=weather+in+Portland+ME')
    render(<App callback={null} />)
    await screen.findByRole('heading', { name: 'Forecast unavailable' })
    expect(search).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Search the web' }))
    await screen.findByRole('link', { name: 'weather in Portland ME field guide' })
    expect(search).toHaveBeenCalledTimes(1)
  })

  it.each(['brave', 'firecrawl'] as const)('asks for a typed location and filters reported open %s places without a second request', async provider => {
    getConfig.mockResolvedValue({ ...config, places: { provider, priceMicros: 5000 } })
    places.mockResolvedValue({ provider, results: [
      { name: 'Morning Cafe', address: '1 Elm Street', phone: '+1 555 321 9876 ext 1',
        website: 'https://example.com/', todayHours: ['07:00–15:00'], openNow: true, rating: { value: 4.6, max: 5 } },
      { name: 'Night Cafe', address: '2 Elm Street', openNow: false, rating: { value: 4.8, max: 5 } },
      { name: 'Square Cafe', address: '3 Elm Street', ...(provider === 'brave' ? {
        weeklyHours: [{ day: 'Monday', hours: '07:00–15:00' }],
      } : {}) },
    ] })
    window.history.replaceState(null, '', '/search?q=coffee+shops+near+me')
    render(<App callback={null} />)
    const choose = await screen.findByRole('region', { name: 'Choose a search area' })
    expect(places).not.toHaveBeenCalled()
    expect(search).not.toHaveBeenCalled()
    fireEvent.change(within(choose).getByRole('textbox', { name: 'City or neighborhood' }), { target: { value: 'Davis Square' } })
    fireEvent.click(within(choose).getByRole('button', { name: 'Find places' }))
    const list = await screen.findByRole('region', { name: 'Local places' })
    if (provider === 'brave') {
      const square = within(list).getByRole('heading', { name: 'Square Cafe' }).closest('li')!
      const weeklyHours = within(square).getByText('Weekly hours')
      expect(weeklyHours.closest('details')?.open).toBe(false)
      expect(within(square).getByText('Monday').tagName).toBe('DT')
      expect(within(square).getByText('07:00–15:00').tagName).toBe('DD')
      expect(within(square).queryByText(/Today|Open now|Closed/)).toBeNull()
    }
    if (provider === 'firecrawl') expect(within(list).getByRole('link', { name: 'Firecrawl Maps' })).toBeDefined()
    expect(places).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ query: 'coffee shops near Davis Square' }), expect.any(AbortSignal))
    expect(within(list).getAllByRole('heading', { level: 3 })).toHaveLength(3)
    fireEvent.change(within(list).getByLabelText('Order places'), { target: { value: 'ratings' } })
    expect(within(list).getAllByRole('heading', { level: 3 })[0].textContent).toBe('Night Cafe')
    fireEvent.click(within(list).getByRole('button', { name: 'Open now' }))
    expect(within(list).getAllByRole('heading', { level: 3 })).toHaveLength(1)
    expect(within(list).getByText('Today 07:00–15:00')).toBeDefined()
    expect(within(list).getByRole('link', { name: 'Call' }).getAttribute('href')).toBe('tel:+15553219876;ext=1')
    expect(within(list).getByRole('link', { name: 'Directions' }).getAttribute('href')).toContain('destination=Morning+Cafe%2C+1+Elm+Street')
    expect(places).toHaveBeenCalledTimes(1)
    expect(search).not.toHaveBeenCalled()
  })

  it('paginates only through a capable provider and restores a cached first page', async () => {
    getConfig.mockResolvedValue({
      ...config, providers: config.providers.map(provider => ({ ...provider, maxPage: provider.id === 'kagi' ? 10 : 1 })),
    })
    search.mockImplementation(async ({ page }) => ({
      provider: 'kagi', hasMore: !page,
      results: [{ url: 'https://example.com/page-' + (page ?? 1), title: 'Result page ' + (page ?? 1), snippet: '' }],
    }))
    window.history.replaceState(null, '', '/search?q=tides')
    render(<App callback={null} />)
    const first = await screen.findByRole('link', { name: 'Result page 1' })
    expect(first).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('link', { name: 'Result page 2' })
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ providers: ['kagi'], page: 2 }), expect.any(AbortSignal))
    expect(window.location.search).toContain('page=2')
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await screen.findByRole('link', { name: 'Result page 1' })
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('keeps image refinements and skips previously shown images on a later page', async () => {
    getConfig.mockResolvedValue({
      ...config, providers: [
        { ...config.providers[0], categories: ['web', 'news', 'images'], maxPage: 10 },
        config.providers[1],
      ],
    })
    const picture = (title: string, width: number) => ({
      title, url: 'https://example.com/' + title, imageUrl: 'https://images.example.com/' + title + '.jpg',
      imageDimensions: { width, height: 800 }, snippet: '',
    })
    const repeated = picture('Repeated', 3000)
    search.mockImplementation(async ({ page }) => ({
      provider: 'kagi', hasMore: page !== 2,
      results: page === 2 ? [repeated, picture('New large image', 3000), picture('New small image', 800)] : [repeated],
    }))
    window.history.replaceState(null, '', '/search?q=tides&type=images')
    render(<App callback={null} />)
    await screen.findByRole('button', { name: 'Preview image: Repeated' })
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'large' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('button', { name: 'Preview image: New large image' })
    expect(screen.queryByRole('button', { name: 'Preview image: Repeated' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Preview image: New small image' })).toBeNull()
    expect((screen.getByLabelText('Size') as HTMLSelectElement).value).toBe('large')
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('reveals already downloaded images before allowing a new metered page', async () => {
    getConfig.mockResolvedValue({ ...config, providers: [
      { ...config.providers[0], categories: ['images'], expandedImages: true, maxPage: 10 },
    ] })
    search.mockResolvedValue({
      provider: 'kagi', hasMore: true,
      results: Array.from({ length: 26 }, (_, i) => ({
        title: 'Photo ' + i, url: 'https://example.com/' + i, imageUrl: 'https://img.example.com/' + i, snippet: '',
      })),
    })
    window.history.replaceState(null, '', '/search?q=tides&type=images')
    render(<App callback={null} />)
    const next = await screen.findByRole<HTMLButtonElement>('button', { name: 'Next' })
    expect(next.disabled).toBe(true)
    expect(search).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ expandedImages: true }), expect.any(AbortSignal))
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more images on this page' }))
    expect(next.disabled).toBe(false)
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('offers a supported spelling change without automatically running it', async () => {
    search.mockResolvedValueOnce({
      provider: 'kagi', related: ['equidistant definition'],
      results: [
        { title: 'Equidistant Definition', url: 'https://dictionary.example/', snippet: '' },
        { title: 'Equidistant Points', url: 'https://geometry.example/', snippet: '' },
      ],
    })
    window.history.replaceState(null, '', '/search?q=equidistnat+definition')
    render(<App callback={null} />)
    const suggestion = await screen.findByRole('button', { name: 'equidistant definition' })
    expect(search).toHaveBeenCalledTimes(1)
    expect(window.location.search).toContain('equidistnat')
    fireEvent.click(suggestion)
    await screen.findByRole('link', { name: 'equidistant definition field guide' })
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('applies a shareable focus and can clear an empty scope', async () => {
    window.history.replaceState(null, '', '/search?q=tides')
    render(<App callback={null} />)
    await screen.findByRole('link', { name: 'tides field guide' })
    search.mockResolvedValueOnce({ provider: 'kagi', results: [] })
    fireEvent.change(screen.getByLabelText('Search focus'), { target: { value: 'academic' } })
    await screen.findByRole('heading', { name: 'No results found' })
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'tides', scope: 'academic' }), expect.any(AbortSignal))
    expect(window.location.search).toContain('scope=academic')
    fireEvent.click(screen.getByRole('button', { name: 'Search all sites' }))
    await screen.findByRole('link', { name: 'tides field guide' })
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('can use a different provider for one search without changing the default for the next query', async () => {
    window.history.replaceState(null, '', '/search?q=tides')
    render(<App callback={null} />)
    await screen.findByRole('link', { name: 'tides field guide' })
    fireEvent.click(screen.getByLabelText('Search providers'))
    fireEvent.click(screen.getByRole('button', { name: 'Search with Firecrawl' }))
    await screen.findByRole('link', { name: 'tides field guide' })
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ providers: ['firecrawl'] }), expect.any(AbortSignal))
    expect(window.location.search).toContain('provider=firecrawl')
    submit('kelp')
    await screen.findByRole('link', { name: 'kelp field guide' })
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ providers: ['kagi', 'firecrawl'] }), expect.any(AbortSignal))
  })

  it('handles bare bang discovery from the address bar without starting a paid search', async () => {
    window.history.replaceState(null, '', '/search?q=%21')
    render(<App callback={null} />)
    await screen.findByRole('dialog', { name: 'Bangs' })
    expect(window.location.pathname).toBe('/')
    expect(search).not.toHaveBeenCalled()
  })

  it('searches the clean lucky query once and removes the bang when no result can open', async () => {
    search.mockResolvedValue({ provider: 'kagi', results: [] })
    window.history.replaceState(null, '', '/search?q=tide+pools+%21&type=news')
    render(<App callback={null} />)
    await screen.findByRole('heading', { name: 'No results found' })
    await waitFor(() => expect(window.location.search).toBe('?q=tide+pools'))
    expect(search).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      query: 'tide pools', category: 'web',
    }), expect.any(AbortSignal))
  })

  it('batches date and region edits and preserves compatible filters when switching categories', async () => {
    window.history.replaceState(null, '', '/search?q=tides')
    render(<App callback={null} />)
    await screen.findByRole('link', { name: 'tides field guide' })
    fireEvent.click(screen.getByLabelText('Filters'))
    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: 'day' } })
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'ca' } })
    expect(search).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'web', date: 'day', region: 'ca' }), expect.any(AbortSignal))
    fireEvent.click(screen.getByRole('button', { name: 'News' }))
    await waitFor(() => expect(search).toHaveBeenCalledTimes(3))
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'news', date: 'day', region: 'ca' }), expect.any(AbortSignal))
  })

  it('shares custom dates and leaves presets and media compatible', async () => {
    window.history.replaceState(null, '', '/search?q=tides&from=2024-02-01&to=2024-02-29')
    render(<App callback={null} />)
    await screen.findByRole('link', { name: 'tides field guide' })
    expect(search).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      category: 'web', dateRange: { from: '2024-02-01', to: '2024-02-29' },
    }), expect.any(AbortSignal))
    const trigger = screen.getByLabelText(/^Filters,/)
    fireEvent.click(trigger)
    expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe('2024-02-01')
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2024-01-31' } })
    expect(screen.getByText('End date must be on or after the start date.')).toBeDefined()
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2024-02-02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(document.activeElement).toBe(trigger)
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    expect(window.location.search).toBe('?q=tides&from=2024-02-01&to=2024-02-02')
    fireEvent.click(screen.getByRole('button', { name: 'News' }))
    await waitFor(() => expect(search).toHaveBeenCalledTimes(3))
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({
      category: 'news', dateRange: { from: '2024-02-01', to: '2024-02-02' }, providers: ['kagi'],
    }), expect.any(AbortSignal))
    fireEvent.click(screen.getByRole('button', { name: 'Images' }))
    await waitFor(() => expect(search).toHaveBeenCalledTimes(4))
    expect(search.mock.lastCall?.[0]).not.toHaveProperty('dateRange')
    expect(window.location.search).toBe('?q=tides&type=images')
  })

  it('clears search results on sign-out', async () => {
    window.history.replaceState(null, '', '/search?q=tides')
    render(<App callback={null} />)
    await screen.findByRole('link', { name: 'tides field guide' })
    fireEvent.click(screen.getByLabelText('Pulpo account'))
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await screen.findByRole('heading', { name: 'Sign in to search' })
    expect(screen.queryByRole('link', { name: 'tides field guide' })).toBeNull()
    expect(logout).toHaveBeenCalledOnce()
  })
})
