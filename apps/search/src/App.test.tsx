// @vitest-environment jsdom
import { defaultSearchAccountPreferences } from '@pulpo/contracts/search'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { api, SearchApiError, type SearchConfig, type SearchUser } from './api'

const user: SearchUser = { id: 'test-user', name: 'Casey', email: 'casey@example.com' }
const quickAnswerChatId = '00000000-0000-4000-8000-000000000042'
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
  const readPreferences = vi.spyOn(api, 'preferences')
  const writePreferences = vi.spyOn(api, 'updatePreferences')
  const weather = vi.spyOn(api, 'weather')
  const weatherAlerts = vi.spyOn(api, 'weatherAlerts')
  const currency = vi.spyOn(api, 'currency')
  const places = vi.spyOn(api, 'places')
  const quickAnswer = vi.spyOn(api, 'quickAnswer')
  const streamQuickAnswer = vi.spyOn(api, 'streamQuickAnswer')
  const cancelQuickAnswer = vi.spyOn(api, 'cancelQuickAnswer')
  const reusableImages = vi.spyOn(api, 'reusableImages')

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
    let saved: typeof defaultSearchAccountPreferences | null = null
    readPreferences.mockImplementation(async () => ({ preferences: saved }))
    writePreferences.mockImplementation(async (_accountId, patch, initial) => {
      saved = { ...(saved ?? initial ?? defaultSearchAccountPreferences), ...patch }
      return { preferences: saved }
    })
    weather.mockResolvedValue({ status: 'not-found', sources: [] })
    weatherAlerts.mockResolvedValue({ status: 'unavailable' })
    currency.mockResolvedValue({ status: 'unavailable', source: { name: 'ECB', url: 'https://www.ecb.europa.eu/', description: 'Daily reference rates' } })
    places.mockResolvedValue({ provider: 'brave', results: [] })
    quickAnswer.mockResolvedValue({ responseId: 'quick-answer-run', chatId: quickAnswerChatId })
    streamQuickAnswer.mockImplementation(async (_id, onText) => { onText('An answer.') })
    cancelQuickAnswer.mockResolvedValue()
    reusableImages.mockResolvedValue({ provider: 'openverse', results: [] })
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
    window.sessionStorage.clear()
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

  it('uses account filter defaults for the first search and supports query overrides', async () => {
    readPreferences.mockResolvedValue({ preferences: { ...defaultSearchAccountPreferences, defaultRegion: 'ca', safeSearch: false } })
    window.history.replaceState(null, '', '/search?q=tide+pools&region=any&safe=on')
    render(<App callback={null} />)
    await screen.findByRole('link', { name: 'tide pools field guide' })
    expect(search).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      safeSearch: true, limit: 40,
    }), expect.any(AbortSignal))
    expect(search.mock.calls[0][0]).not.toHaveProperty('region')
    search.mockResolvedValueOnce({ provider: 'kagi', results: [] })
    await act(async () => {
      window.history.pushState(null, '', '/search?q=kelp')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    const clear = await screen.findByRole('button', { name: 'Clear date and region' })
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ region: 'ca', safeSearch: false }), expect.any(AbortSignal))
    fireEvent.click(clear)
    await screen.findByRole('link', { name: 'kelp field guide' })
    expect(search.mock.lastCall?.[0]).not.toHaveProperty('region')
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

  it('uses a separate engine for a search type that more than one engine supports', async () => {
    getConfig.mockResolvedValue({ ...config, providers: [
      { ...config.providers[0], categories: ['web', 'news', 'images', 'videos'] },
      { ...config.providers[1], categories: ['web', 'news', 'images'] },
    ] })
    window.history.replaceState(null, '', '/search?q=tides')
    render(<App callback={null} />)
    await screen.findByRole('link', { name: 'tides field guide' })
    fireEvent.click(screen.getByRole('button', { name: 'Search settings' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('group', { name: 'Videos' })).toBeNull()
    const images = within(dialog).getByRole('group', { name: 'Images' })
    expect(within(images).queryByLabelText('Fallback')).toBeNull()
    const imageEngine = within(images).getByLabelText<HTMLSelectElement>('Default')
    expect(imageEngine.selectedOptions[0]?.textContent).toBe('Same as Web · Kagi')
    fireEvent.change(imageEngine, { target: { value: 'firecrawl' } })
    fireEvent.change(within(images).getByLabelText('Fallback'), { target: { value: 'none' } })
    await waitFor(() => expect(writePreferences).toHaveBeenLastCalledWith(user.id, {
      categoryProviders: { images: { defaultProvider: 'firecrawl', fallbackProvider: 'none' } },
    }, undefined, expect.any(AbortSignal)))
    expect((within(within(dialog).getByRole('group', { name: 'Web' })).getByLabelText('Default') as HTMLSelectElement).value).toBe('')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))

    submit('kelp')
    await screen.findByRole('link', { name: 'kelp field guide' })
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'web', providers: ['kagi', 'firecrawl'] }), expect.any(AbortSignal))
    fireEvent.click(screen.getByRole('button', { name: 'Images' }))
    await waitFor(() => expect(search).toHaveBeenLastCalledWith(expect.objectContaining({
      query: 'kelp', category: 'images', providers: ['firecrawl'],
    }), expect.any(AbortSignal)))
    fireEvent.click(screen.getByRole('button', { name: 'News' }))
    await waitFor(() => expect(search).toHaveBeenLastCalledWith(expect.objectContaining({
      category: 'news', providers: ['kagi', 'firecrawl'],
    }), expect.any(AbortSignal)))
  })

  it('does not carry a one-off engine into a search type with its own engine', async () => {
    getConfig.mockResolvedValue({ ...config, providers: [
      { ...config.providers[0], categories: ['web', 'images'] },
      { ...config.providers[1], categories: ['web', 'images'] },
    ] })
    readPreferences.mockResolvedValue({ preferences: { ...defaultSearchAccountPreferences,
      categoryProviders: { images: { defaultProvider: 'kagi', fallbackProvider: 'none' } } } })
    window.history.replaceState(null, '', '/search?q=tides&provider=firecrawl')
    render(<App callback={null} />)
    await screen.findByRole('link', { name: 'tides field guide' })
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ providers: ['firecrawl'] }), expect.any(AbortSignal))
    fireEvent.click(screen.getByRole('button', { name: 'Images' }))
    await waitFor(() => expect(search).toHaveBeenLastCalledWith(expect.objectContaining({
      category: 'images', providers: ['kagi'],
    }), expect.any(AbortSignal)))
    expect(window.location.search).not.toContain('provider=')
  })

  it('applies site preferences to results without another provider request', async () => {
    window.history.replaceState(null, '', '/search?q=tides')
    render(<App callback={null} />)
    await screen.findByRole('link', { name: 'tides field guide' })
    const resultLinks = () => [...document.querySelectorAll<HTMLAnchorElement>('.results-list .result-link')].map(link => link.href)
    expect(resultLinks()).toEqual(['https://example.com/', 'https://help.example.net/'])
    const pinOptions = screen.getByLabelText('Options for help.example.net')
    fireEvent.click(pinOptions)
    fireEvent.click(within(pinOptions.closest('details')!).getByRole('button', { name: 'Pin site' }))
    expect(resultLinks()).toEqual(['https://help.example.net/', 'https://example.com/'])
    const hideOptions = screen.getByLabelText('Options for example.com')
    fireEvent.click(hideOptions)
    fireEvent.click(within(hideOptions.closest('details')!).getByRole('button', { name: 'Hide site' }))
    expect(screen.queryByRole('link', { name: 'tides field guide' })).toBeNull()
    expect(resultLinks()).toEqual(['https://help.example.net/'])
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 hidden result' }))
    expect(screen.getByRole('link', { name: 'tides field guide' })).toBeDefined()
    expect(resultLinks()).toEqual(['https://help.example.net/', 'https://example.com/'])
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('streams a cited default-model answer once, while keeping the Web results visible', async () => {
    getConfig.mockResolvedValue({ ...config, quickAnswer: { modelName: 'Pulpo Test Model' } })
    streamQuickAnswer.mockImplementation(async (_id, onText) => {
      onText('A **short answer** with [a source]')
      onText('(https://example.org/guide) and ![an untrusted embed](https://example.org/pixel.png).')
    })
    window.history.replaceState(null, '', '/search?q=tide+pools')
    render(<App callback={null} />)
    const button = await screen.findByRole('button', { name: /^Quick answer/ })
    expect(quickAnswer).not.toHaveBeenCalled()
    fireEvent.click(button)
    const card = screen.getByRole('region', { name: 'Quick answer' })
    const source = await within(card).findByRole('link', { name: 'a source' }, { timeout: 5000 })
    expect(source.getAttribute('href')).toBe('https://example.org/guide')
    expect(within(card).queryByRole('img')).toBeNull()
    expect(within(card).queryByText('Pulpo Test Model')).toBeNull()
    const handoff = within(card).getByRole('link', { name: 'Open in Pulpo' })
    expect(new URL(handoff.getAttribute('href')!).pathname).toBe('/c/' + quickAnswerChatId)
    expect(handoff.getAttribute('rel')).toContain('noreferrer')
    await screen.findByRole('link', { name: 'tide pools field guide' })
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(within(card).getByRole('link', { name: 'a source' })).toBeDefined()
    expect(quickAnswer).toHaveBeenCalledExactlyOnceWith('tide pools', expect.any(String))
    expect(streamQuickAnswer).toHaveBeenCalledTimes(1)
  })

  it('leaves a running agent response available after opening its Pulpo chat', async () => {
    getConfig.mockResolvedValue({ ...config, quickAnswer: { modelName: 'Pulpo Test Model' } })
    streamQuickAnswer.mockImplementation((_id, _onText, signal) => new Promise(resolve => {
      signal.addEventListener('abort', () => resolve(), { once: true })
    }))
    window.history.replaceState(null, '', '/search?q=tide+pools')
    const { unmount } = render(<App callback={null} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Quick answer' }))
    const handoff = await screen.findByRole('link', { name: 'Open in Pulpo' })
    handoff.addEventListener('click', event => event.preventDefault())
    fireEvent.click(handoff)
    unmount()
    await act(async () => {})
    expect(cancelQuickAnswer).not.toHaveBeenCalled()
  })

  it('automatically runs an answer for a question submitted in Search and cancels on Stop', async () => {
    getConfig.mockResolvedValue({ ...config, quickAnswer: { modelName: 'Pulpo Test Model' } })
    streamQuickAnswer.mockImplementation(async (_id, onText, signal) => {
      onText('Working from the sources.')
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    })
    window.history.replaceState(null, '', '/search?q=linked%20question%3F')
    render(<App callback={null} />)
    await screen.findByRole('button', { name: 'Quick answer' })
    expect(quickAnswer).not.toHaveBeenCalled()
    submit('When do tide pools flood?')
    const stop = await screen.findByRole('button', { name: 'Stop' })
    await waitFor(() => expect(streamQuickAnswer).toHaveBeenCalledTimes(1))
    expect(quickAnswer).toHaveBeenCalledExactlyOnceWith('When do tide pools flood?', expect.any(String))
    fireEvent.click(stop)
    await screen.findByText('Answer stopped.')
    expect(cancelQuickAnswer).toHaveBeenCalledExactlyOnceWith('quick-answer-run')
  })

  it('reattaches to the same answer when the stream fails', async () => {
    getConfig.mockResolvedValue({ ...config, quickAnswer: { modelName: 'Pulpo Test Model' } })
    streamQuickAnswer.mockRejectedValueOnce(new SearchApiError('The stream closed.', 0))
    window.history.replaceState(null, '', '/search?q=tide+pools')
    render(<App callback={null} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Quick answer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }))
    await screen.findByText('Quick answer ready.')
    expect(quickAnswer).toHaveBeenCalledTimes(1)
    expect(streamQuickAnswer.mock.calls.map(([id]) => id)).toEqual(['quick-answer-run', 'quick-answer-run'])
    expect(cancelQuickAnswer).not.toHaveBeenCalled()
  })

  it('offers reconnection after an unacknowledged Stop instead of starting another answer', async () => {
    getConfig.mockResolvedValue({ ...config, quickAnswer: { modelName: 'Pulpo Test Model' } })
    streamQuickAnswer.mockImplementationOnce(async (_id, _onText, signal) => {
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    })
    cancelQuickAnswer.mockRejectedValueOnce(new SearchApiError('Cancellation unavailable.', 503))
    window.history.replaceState(null, '', '/search?q=tide+pools')
    render(<App callback={null} />)
    const toggle = await screen.findByRole('button', { name: 'Quick answer' })
    fireEvent.click(toggle)
    await waitFor(() => expect(streamQuickAnswer).toHaveBeenCalledTimes(1))
    const stop = await screen.findByRole('button', { name: 'Stop' })
    stop.focus()
    fireEvent.click(stop)
    expect(document.activeElement).toBe(toggle)
    fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }))
    await screen.findByText('Quick answer ready.')
    expect(quickAnswer).toHaveBeenCalledTimes(1)
    expect(cancelQuickAnswer).toHaveBeenCalledTimes(1)
  })

  it('consumes the question shortcut once while more results load', async () => {
    getConfig.mockResolvedValue({ ...config, quickAnswer: { modelName: 'Pulpo Test Model' },
      providers: [{ ...config.providers[0], maxPage: 10 }, config.providers[1]],
    })
    search.mockImplementation(async ({ page }) => ({
      provider: 'kagi', hasMore: !page, results: [{ url: 'https://example.org/' + (page ?? 1), title: 'Page ' + (page ?? 1), snippet: '' }],
    }))
    render(<App callback={null} />)
    await screen.findByLabelText('Pulpo account')
    submit('Why do tides change?')
    await screen.findByText('Quick answer ready.')
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    await screen.findByRole('link', { name: 'Page 2' })
    expect(screen.getByRole('link', { name: 'Page 1' })).toBeDefined()
    expect(screen.getByText('Quick answer ready.')).toBeDefined()
    expect(window.location.search).not.toContain('page=')
    expect(quickAnswer).toHaveBeenCalledTimes(1)
  })

  it('preserves requested image license filters without running a different provider', async () => {
    getConfig.mockResolvedValue({ ...config, reusableImages: true })
    reusableImages.mockResolvedValue({ provider: 'openverse', results: [{
      url: 'https://example.org/art', title: 'Public domain artwork', snippet: '',
      imageUrl: 'https://example.org/art.jpg', imageLicense: { code: 'pdm', url: 'https://creativecommons.org/publicdomain/mark/1.0/' },
    }] })
    window.history.replaceState(null, '', '/search?q=Hokusai&type=images&reuse=1&license=public-domain&kind=digitized_artwork')
    render(<App callback={null} />)
    await screen.findByRole('button', { name: 'Preview image: Public domain artwork' })
    expect((screen.getByLabelText('License') as HTMLSelectElement).value).toBe('public-domain')
    expect((screen.getByLabelText('Image type') as HTMLSelectElement).value).toBe('digitized_artwork')
    expect(reusableImages).toHaveBeenCalledTimes(1)
    expect(reusableImages).toHaveBeenCalledWith({
      query: 'Hokusai', license: 'public-domain', category: 'digitized_artwork',
    }, expect.any(AbortSignal))
    expect(search).not.toHaveBeenCalled()
  })

  it('offers to shorten an empty reusable image query while keeping its filters', async () => {
    const query = 'vintage nineteenth-century botanical fern engraving'
    getConfig.mockResolvedValue({ ...config, reusableImages: true })
    reusableImages.mockResolvedValueOnce({ provider: 'openverse', results: [] }).mockResolvedValueOnce({
      provider: 'openverse', results: [{
        url: 'https://example.org/fern', title: 'Fern engraving', snippet: '', imageUrl: 'https://example.org/fern.jpg',
        imageLicense: {
          code: 'pdm', url: 'https://creativecommons.org/publicdomain/mark/1.0/', creator: 'BioDivLibrary',
          attribution: 'Fern engraving by BioDivLibrary',
        },
      }],
    })
    window.history.replaceState(null, '', '/search?' + new URLSearchParams({
      q: query, type: 'images', reuse: '1', license: 'public-domain', kind: 'illustration',
    }))
    render(<App callback={null} />)
    const shorterSearch = await screen.findByRole('button', { name: 'Search for “fern engraving”' })
    expect(reusableImages).toHaveBeenCalledExactlyOnceWith({ query, license: 'public-domain', category: 'illustration' }, expect.any(AbortSignal))
    fireEvent.click(shorterSearch)
    fireEvent.click(await screen.findByRole('button', { name: 'Preview image: Fern engraving' }))
    const preview = screen.getByRole('dialog')
    expect(within(preview).getByText('Fern engraving by BioDivLibrary')).toBeDefined()
    expect(within(preview).getByRole('link', { name: 'Visit original source' }).getAttribute('href')).toBe('https://example.org/fern')
    expect(window.location.search).toBe('?q=fern+engraving&type=images&reuse=1&license=public-domain&kind=illustration')
    expect(reusableImages).toHaveBeenCalledTimes(2)
    expect(reusableImages).toHaveBeenLastCalledWith({
      query: 'fern engraving', license: 'public-domain', category: 'illustration',
    }, expect.any(AbortSignal))
    expect(search).not.toHaveBeenCalled()
  })

  it.each(['sparse gallery', 'provider timeout'])('offers to broaden after a %s without changing the license', async situation => {
    getConfig.mockResolvedValue({ ...config, reusableImages: true })
    reusableImages.mockResolvedValue({ provider: 'openverse', results: [{
      url: 'https://example.org/blue-morpho', title: 'Blue morpho', snippet: '', imageUrl: 'https://example.org/blue-morpho.jpg',
    }] })
    if (situation === 'provider timeout') {
      reusableImages.mockRejectedValueOnce(new SearchApiError('Openverse took too long to respond.', 504, 'reusable_images_timeout'))
    }
    window.history.replaceState(null, '', '/search?q=blue+morpho+butterfly+perched&type=images&reuse=1&license=commercial')
    render(<App callback={null} />)
    const broaden = await screen.findByRole('button', { name: 'Search for “blue morpho butterfly”' })
    expect(reusableImages).toHaveBeenCalledTimes(1)
    fireEvent.click(broaden)
    await waitFor(() => expect(reusableImages).toHaveBeenCalledTimes(2))
    expect(reusableImages).toHaveBeenLastCalledWith({ query: 'blue morpho butterfly', license: 'commercial' }, expect.any(AbortSignal))
    expect(search).not.toHaveBeenCalled()
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

  it('keeps provider selection for dated News inside Filters', async () => {
    getConfig.mockResolvedValue({ ...config, providers: config.providers.map(provider => provider.id === 'firecrawl'
      ? { ...provider, categories: ['web', 'images', 'news'], customDateRanges: ['web', 'news'] } : provider) })
    search.mockImplementation(async ({ providers }) => ({
      provider: providers?.[0] ?? 'kagi',
      results: [{ url: 'https://example.com/launch', title: 'Starliner launch', snippet: 'A dated report.' }],
    }))
    window.history.replaceState(null, '', '/search?q=Starliner&type=news&from=2024-06-05&to=2024-06-06')
    render(<App callback={null} />)
    await screen.findByRole('link', { name: 'Starliner launch' })
    expect(search).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByLabelText(/^Filters/))
    fireEvent.change(screen.getByLabelText('Search provider'), { target: { value: 'firecrawl' } })
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({
      providers: ['firecrawl'], category: 'news', dateRange: { from: '2024-06-05', to: '2024-06-06' },
    }), expect.any(AbortSignal))
  })

  it('uses the recommended News provider on automatic settings', async () => {
    getConfig.mockResolvedValue({
      ...config, newsDefaultOrder: ['firecrawl', 'kagi'],
      providers: config.providers.map(provider => ({ ...provider, categories: ['web', 'news'] })),
    })
    window.history.replaceState(null, '', '/search?q=Starship&type=news')
    render(<App callback={null} />)
    await screen.findByRole('link', { name: 'Starship field guide' })
    expect(search).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      category: 'news', providers: ['firecrawl', 'kagi'],
    }), expect.any(AbortSignal))
  })

  it('narrows an explicitly recent News query and lets the user broaden it', async () => {
    getConfig.mockResolvedValue({
      ...config, newsDefaultOrder: ['firecrawl', 'kagi'],
      providers: config.providers.map(provider => ({ ...provider, categories: ['web', 'news'] })),
    })
    window.history.replaceState(null, '', '/search?q=Artemis+latest+news&type=news')
    render(<App callback={null} />)
    await screen.findByRole('link', { name: 'Artemis latest news field guide' })
    expect(search).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ date: 'week', providers: ['firecrawl'] }), expect.any(AbortSignal))
    expect(screen.getByLabelText('Filters, Past week')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    expect(search.mock.lastCall?.[0]).not.toHaveProperty('date')
    expect(window.location.search).toBe('?q=Artemis+latest+news&type=news&date=any')
  })

  it('keeps other search tabs available when switching News providers', async () => {
    getConfig.mockResolvedValue({ ...config, providers: config.providers.map(provider => provider.id === 'firecrawl'
      ? { ...provider, categories: ['web', 'images', 'news'] } : { ...provider, categories: ['web', 'news', 'videos'] }) })
    window.history.replaceState(null, '', '/search?q=Starliner&type=news&provider=firecrawl')
    render(<App callback={null} />)
    await screen.findByRole('link', { name: 'Starliner field guide' })
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'news', providers: ['firecrawl'] }), expect.any(AbortSignal))
    fireEvent.click(screen.getByRole('button', { name: 'Videos', pressed: false }))
    await waitFor(() => expect(search).toHaveBeenLastCalledWith(expect.objectContaining({
      category: 'videos', providers: ['kagi'],
    }), expect.any(AbortSignal)))
    expect(window.location.search).not.toContain('provider=')
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
        daily: Array.from({ length: 7 }, (_, offset) => ({ date: `2026-11-${24 + offset}`, highC: 12, lowC: 4 })),
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
    expect(within(card).getByRole('heading', { name: '7-day outlook' })).toBeDefined()
    const days = within(within(card).getByRole('list', { name: 'Daily forecast' })).getAllByRole('listitem')
    expect(days).toHaveLength(7)
    expect(days.at(-1)?.querySelector('time')?.dateTime).toBe('2026-11-30')
    expect((await within(card).findByRole('link', { name: 'Wind Advisory' })).getAttribute('href')).toBe('https://www.weather.gov/warnings')
    fireEvent.click(within(card).getByRole('button', { name: '°C' }))
    expect(within(card).getByText('10°C')).toBeDefined()
    fireEvent.click(within(card).getByRole('button', { name: 'Show web results' }))
    await screen.findByRole('link', { name: 'Seattle weather field guide' })
    expect(within(card).getByRole('heading', { name: '7-day outlook' })).toBeDefined()
    expect(weather).toHaveBeenCalledTimes(1)
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

  it('shows a Places credit error before offering a separate Web search', async () => {
    getConfig.mockResolvedValue({ ...config, places: { provider: 'firecrawl', priceMicros: 5000 } })
    places.mockRejectedValueOnce(new SearchApiError('Places lookup failed.', 402))
    window.history.replaceState(null, '', '/search?q=coffee+shops+near+Grand+Central')
    render(<App callback={null} />)
    await screen.findByRole('heading', { name: 'Places search limit reached' })
    expect(search).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Search the web' }))
    await screen.findByRole('link', { name: 'coffee shops near Grand Central field guide' })
    expect(places).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('falls back to Web after a Places provider failure', async () => {
    getConfig.mockResolvedValue({ ...config, places: { provider: 'firecrawl', priceMicros: 5000 } })
    places.mockRejectedValueOnce(new SearchApiError('Places lookup failed.', 502))
    window.history.replaceState(null, '', '/search?q=coffee+shops+near+Grand+Central')
    render(<App callback={null} />)
    await screen.findByRole('link', { name: 'coffee shops near Grand Central field guide' })
    expect(screen.getByText('Showing web results while Places is unavailable.')).toBeDefined()
    expect(places).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('reveals more venues and keeps the local answer beside requested Web results', async () => {
    getConfig.mockResolvedValue({ ...config, places: { provider: 'firecrawl', priceMicros: 5000 },
      providers: [{ ...config.providers[0], maxPage: 10 }, config.providers[1]],
    })
    places.mockResolvedValue({ provider: 'firecrawl', results: Array.from({ length: 8 }, (_, index) => ({
      name: 'Shop ' + index, address: index + ' Elm Street',
    })) })
    search.mockImplementation(async ({ page }) => ({ provider: 'kagi', hasMore: !page, results: [
      { url: 'https://example.com/' + (page ?? 1), title: 'Web page ' + (page ?? 1), snippet: '' },
    ] }))
    window.history.replaceState(null, '', '/search?q=coffee+shops+near+Grand+Central')
    render(<App callback={null} />)
    const local = await screen.findByRole('region', { name: 'Local places' })
    expect(within(local).getAllByRole('listitem')).toHaveLength(6)
    fireEvent.click(within(local).getByRole('button', { name: 'Show all 8 places' }))
    expect(within(local).getAllByRole('listitem')).toHaveLength(8)
    expect(search).not.toHaveBeenCalled()

    fireEvent.click(within(local).getByRole('button', { name: 'Show web results' }))
    fireEvent.click(within(local).getByRole('button', { name: 'Hide web results' }))
    fireEvent.click(within(local).getByRole('button', { name: 'Show web results' }))
    await screen.findByRole('link', { name: 'Web page 1' })
    expect(search).toHaveBeenCalledTimes(1)
    expect(within(local).getAllByRole('listitem')).toHaveLength(8)
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByRole('link', { name: 'Web page 2' })
    expect(within(local).getAllByRole('listitem')).toHaveLength(8)
    fireEvent.click(within(local).getByRole('button', { name: 'Hide web results' }))
    expect(screen.queryByRole('link', { name: 'Web page 2' })).toBeNull()
    fireEvent.click(within(local).getByRole('button', { name: 'Show web results' }))
    await screen.findByRole('link', { name: 'Web page 1' })
    expect(screen.getByRole('link', { name: 'Web page 2' })).toBeDefined()
    expect(places).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('appends the same engine\'s next page below the results shown so far', async () => {
    getConfig.mockResolvedValue({
      ...config, providers: config.providers.map(provider => ({ ...provider, maxPage: provider.id === 'kagi' ? 10 : 1 })),
    })
    search.mockImplementation(async ({ page }) => ({
      provider: 'kagi', hasMore: !page,
      results: Array.from({ length: 3 }, (_, index) => ({
        url: `https://example.com/page-${page ?? 1}-${index}`, title: `Result ${page ?? 1}.${index}`, snippet: '',
      })),
    }))
    window.history.replaceState(null, '', '/search?q=tides')
    render(<App callback={null} />)
    await screen.findByRole('link', { name: 'Result 1.0' })
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByRole('link', { name: 'Result 2.0' })
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ providers: ['kagi'], page: 2 }), expect.any(AbortSignal))
    expect([...document.querySelectorAll('.results-list .result-link')].map(link => link.textContent))
      .toEqual(['Result 1.0', 'Result 1.1', 'Result 1.2', 'Result 2.0', 'Result 2.1', 'Result 2.2'])
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Result 2.0' }))
    expect(window.location.search).not.toContain('page=')
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
    expect(screen.getByText('No more results.')).toBeDefined()
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('continues a single-page engine with Kagi and adds only results it has not shown', async () => {
    getConfig.mockResolvedValue({
      ...config, defaultOrder: ['firecrawl', 'kagi'],
      providers: config.providers.map(provider => ({ ...provider, maxPage: provider.id === 'kagi' ? 10 : 1 })),
    })
    search.mockImplementation(async ({ providers, page }) => providers?.[0] === 'kagi' ? {
      provider: 'kagi', hasMore: !page,
      results: page ? [
        { url: 'https://example.org/kagi-2', title: 'Kagi second page', snippet: '' },
      ] : [
        { url: 'http://www.example.com/shared/?utm_source=kagi', title: 'Shared result from Kagi', snippet: '' },
        ...['one', 'two', 'three'].map(name => ({ url: 'https://example.org/kagi-' + name, title: 'Kagi ' + name, snippet: '' })),
      ],
    } : {
      provider: 'firecrawl',
      results: [{ url: 'https://example.com/shared', title: 'Shared result', snippet: '' }],
    })
    window.history.replaceState(null, '', '/search?q=tides')
    render(<App callback={null} />)
    await screen.findByRole('link', { name: 'Shared result' })
    expect(screen.getByText('Kagi continues these results for $0.002 per search.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Load more from Kagi' }))
    await screen.findByRole('link', { name: 'Kagi three' })
    expect(search).toHaveBeenLastCalledWith(expect.not.objectContaining({ page: expect.anything() }), expect.any(AbortSignal))
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ providers: ['kagi'] }), expect.any(AbortSignal))
    expect(screen.queryByRole('link', { name: 'Shared result from Kagi' })).toBeNull()
    expect(search).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByRole('link', { name: 'Kagi second page' })
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ providers: ['kagi'], page: 2 }), expect.any(AbortSignal))
    expect(search).toHaveBeenCalledTimes(3)
  })

  it('fetches once more when a batch only repeats results, and keeps results when loading more fails', async () => {
    getConfig.mockResolvedValue({ ...config, providers: [{ ...config.providers[0], maxPage: 10 }, config.providers[1]] })
    search.mockImplementation(async ({ page }) => {
      if (page === 3) throw new SearchApiError('You have reached your search limit.', 402)
      return {
        provider: 'kagi', hasMore: true,
        results: page === 2 ? [{ url: 'https://example.com/second', title: 'Second page', snippet: '' }]
          : [{ url: 'https://example.com/first', title: 'First page', snippet: '' }],
      }
    })
    window.history.replaceState(null, '', '/search?q=tides')
    render(<App callback={null} />)
    await screen.findByRole('link', { name: 'First page' })
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByRole('alert')
    expect(search).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('link', { name: 'First page' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Second page' })).toBeDefined()
    expect(screen.getByText('Search limit reached. Add credits in Pulpo to load more.')).toBeDefined()
    expect(within(screen.getByRole('alert')).getByRole('link', { name: 'Open Pulpo' })).toBeDefined()
  })

  it('restores loaded results and the scroll position after the page reloads', async () => {
    getConfig.mockResolvedValue({ ...config, providers: [{ ...config.providers[0], maxPage: 10 }, config.providers[1]] })
    search.mockImplementation(async ({ page }) => ({
      provider: 'kagi', hasMore: !page,
      results: Array.from({ length: 3 }, (_, index) => ({
        url: `https://example.com/${page ?? 1}/${index}`, title: `Result ${page ?? 1}.${index}`, snippet: '',
      })),
    }))
    window.history.replaceState(null, '', '/search?q=tides')
    const first = render(<App callback={null} />)
    await screen.findByRole('link', { name: 'Result 1.0' })
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByRole('link', { name: 'Result 2.2' })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 640 })
    window.dispatchEvent(new Event('pagehide'))
    first.unmount()
    vi.mocked(window.scrollTo).mockClear()

    const navigation = vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'reload' } as PerformanceNavigationTiming])
    const reloaded = render(<App callback={null} />)
    await screen.findByRole('link', { name: 'Result 2.2' })
    expect(search).toHaveBeenCalledTimes(3)
    await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith({ top: 640, behavior: 'instant' }))
    reloaded.unmount()

    // Opening the same search fresh starts over at the top.
    navigation.mockReturnValue([{ type: 'navigate' } as PerformanceNavigationTiming])
    vi.mocked(window.scrollTo).mockClear()
    render(<App callback={null} />)
    await screen.findByRole('link', { name: 'Result 1.2' })
    expect(screen.queryByRole('link', { name: 'Result 2.0' })).toBeNull()
    expect(window.scrollTo).not.toHaveBeenCalledWith({ top: 640, behavior: 'instant' })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
  })

  it('returns to where the reader last left a search after repeated Back and Forward', async () => {
    const scrollTo = (top: number) => {
      Object.defineProperty(window, 'scrollY', { configurable: true, value: top })
      window.dispatchEvent(new Event('scroll'))
    }
    const traverse = async (path: string, link: string) => {
      window.history.replaceState(null, '', path)
      act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
      await screen.findByRole('link', { name: link })
    }
    window.history.replaceState(null, '', '/search?q=tides')
    render(<App callback={null} />)
    await screen.findByRole('link', { name: 'tides field guide' })
    scrollTo(500)
    submit('kelp')
    await screen.findByRole('link', { name: 'kelp field guide' })

    vi.mocked(window.scrollTo).mockClear()
    await traverse('/search?q=tides', 'tides field guide')
    await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith({ top: 500, behavior: 'instant' }))
    scrollTo(900)
    await traverse('/search?q=kelp', 'kelp field guide')
    vi.mocked(window.scrollTo).mockClear()
    await traverse('/search?q=tides', 'tides field guide')
    await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith({ top: 900, behavior: 'instant' }))
    expect(window.scrollTo).not.toHaveBeenCalledWith({ top: 500, behavior: 'instant' })
    scrollTo(0)
  })

  it('keeps image refinements and skips images that are already shown', async () => {
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
    fireEvent.click(screen.getByText('Refine images'))
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'large' } })
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByRole('button', { name: 'Preview image: New large image' })
    expect(screen.getAllByRole('button', { name: 'Preview image: Repeated' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Preview image: New small image' })).toBeNull()
    fireEvent.click(screen.getByText('Image filters applied'))
    expect((screen.getByLabelText('Size') as HTMLSelectElement).value).toBe('large')
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('reveals already downloaded images before running another metered search', async () => {
    getConfig.mockResolvedValue({ ...config, providers: [
      { ...config.providers[0], categories: ['images'], expandedImages: true, maxPage: 10 },
    ] })
    search.mockImplementation(async ({ page }) => ({
      provider: 'kagi', hasMore: !page,
      results: Array.from({ length: 26 }, (_, i) => ({
        title: `Photo ${page ?? 1}.${i}`, url: `https://example.com/${page ?? 1}/${i}`, imageUrl: `https://img.example.com/${page ?? 1}/${i}`, snippet: '',
      })),
    }))
    window.history.replaceState(null, '', '/search?q=tides&type=images')
    render(<App callback={null} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    expect(screen.getByRole('button', { name: 'Preview image: Photo 1.25' })).toBeDefined()
    expect(search).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ expandedImages: true }), expect.any(AbortSignal))
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByRole('button', { name: 'Preview image: Photo 2.0' })
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ expandedImages: true, page: 2, providers: ['kagi'] }), expect.any(AbortSignal))
    expect(screen.getByRole('button', { name: 'Preview image: Photo 2.25' })).toBeDefined()
    expect(search).toHaveBeenCalledTimes(2)
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
    fireEvent.click(screen.getByLabelText('Filters'))
    fireEvent.change(screen.getByLabelText('Search provider'), { target: { value: 'firecrawl' } })
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

  it('offers an explicit web search when a bang is unrecognized', async () => {
    window.history.replaceState(null, '', '/search?q=%21zz+octopus')
    render(<App callback={null} />)
    await screen.findByLabelText('Pulpo account')
    await screen.findByRole('heading', { name: 'Unknown bang: !zz' })
    expect(search).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Search the web as written' }))
    await screen.findByRole('link', { name: '!zz octopus field guide' })
    expect(search).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ query: '!zz octopus' }), expect.any(AbortSignal))
  })

  it('uses j and k to move between primary results without stepping into sitelinks', async () => {
    search.mockResolvedValueOnce({ provider: 'kagi', results: [
      { title: 'Main result', url: 'https://example.com/', snippet: '' },
      { title: 'Sitelink', url: 'https://example.com/about', snippet: '' },
      { title: 'Next result', url: 'https://other.example.com/', snippet: '' },
    ] })
    window.history.replaceState(null, '', '/search?q=example')
    render(<App callback={null} />)
    const first = await screen.findByRole('link', { name: 'Main result' })
    const next = screen.getByRole('link', { name: 'Next result' })
    expect(screen.getByRole('link', { name: 'Sitelink' })).toBeDefined()
    fireEvent.keyDown(document.body, { key: 'j' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'j' })
    expect(document.activeElement).toBe(next)
    fireEvent.keyDown(next, { key: 'k' })
    expect(document.activeElement).toBe(first)
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
