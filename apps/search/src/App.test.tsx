// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { api, type SearchConfig, type SearchUser } from './api'

const user: SearchUser = { id: 'test-user', name: 'Casey', email: 'casey@example.com' }
const config: SearchConfig = {
  defaultOrder: ['kagi', 'firecrawl'],
  providers: [
    { id: 'kagi', categories: ['web', 'news'], dates: ['day', 'year'], region: true, priceMicros: 2000 },
    { id: 'firecrawl', categories: ['web', 'images'], dates: ['day', 'week'], region: true, priceMicros: 1000 },
  ],
}

describe('Pulpo Search', () => {
  const session = vi.spyOn(api, 'session')
  const getConfig = vi.spyOn(api, 'config')
  const search = vi.spyOn(api, 'search')
  const exchange = vi.spyOn(api, 'exchange')
  const logout = vi.spyOn(api, 'logout')
  const appearance = vi.spyOn(api, 'appearance')

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
