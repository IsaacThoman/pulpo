// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const { authState } = vi.hoisted(() => ({
  authState: {
    instanceName: 'Pulpo',
    signupEnabled: false,
    setupRequired: false,
  },
}))

vi.mock('@/stores/auth', () => ({
  useAuth: Object.assign(
    (selector: (state: typeof authState) => unknown) => selector(authState),
    { getState: () => authState },
  ),
}))

import { LandingPage } from './LandingPage'
import i18n from '@/i18n'

afterEach(async () => {
  await i18n.changeLanguage('en-US')
  authState.signupEnabled = false
  authState.setupRequired = false
})

describe('landing page', () => {
  it('shows the instance name, log in, docs, GitHub, and the demo', () => {
    const markup = renderToStaticMarkup(<MemoryRouter><LandingPage /></MemoryRouter>)

    expect(markup).toContain('Pulpo')
    expect(markup).toContain('href="/login"')
    expect(markup).toContain('Log in')
    expect(markup).not.toContain('href="/signup"')
    expect(markup).toContain('href="https://help.pulpo.baby"')
    expect(markup).toContain('href="https://github.com/IsaacThoman/pulpo"')
    // The demo opens on a new chat with the scripted model, before anything is typed.
    expect(markup).toContain('landing-device-canvas')
    expect(markup).toContain('GPT-6 Luna')
    expect(markup).toContain('Message…')
    expect(markup).toContain('Download')
    expect(markup).toContain('Open in your browser')
  })

  it('presents models, workspaces, apps, and self-hosting', () => {
    const markup = renderToStaticMarkup(<MemoryRouter><LandingPage /></MemoryRouter>)

    for (const id of ['models', 'workspaces', 'apps', 'more', 'self-host']) expect(markup).toContain(`id="${id}"`)
    expect(markup).toContain('/ai-icons/claude-color.svg')
    // The demo's tabs, the still of its agent scene further down the page, and the app screenshots in both themes.
    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('Instant workspaces')
    expect(markup).toContain('Started workspace')
    expect(markup).toContain('/landing/demo-agent.png')
    expect(markup).toContain('/landing/app-ios-models-light.webp')
    expect(markup).toContain('/landing/app-android-brunch-dark.webp')
    expect(markup).toContain('/landing/app-ios-drawer-light.webp')
    expect(markup).toContain('href="https://apps.apple.com/us/app/pulpo-ai/id6798530217"')
    expect(markup).toContain('docker compose up --build -d')
    expect(markup).toContain('Pulpo Noncommercial License')
  })

  it('offers sign up only when signup is enabled', () => {
    authState.signupEnabled = true

    const markup = renderToStaticMarkup(<MemoryRouter><LandingPage /></MemoryRouter>)

    expect(markup).toContain('href="/signup"')
    expect(markup).toContain('Sign up')
  })

  it('redirects to setup on a fresh instance', () => {
    authState.setupRequired = true

    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route index element={<LandingPage />} />
          <Route path="setup" element={<p>setup page</p>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(markup).not.toContain('href="/login"')
  })

  it('renders in Spanish', async () => {
    await i18n.changeLanguage('es-ES')

    const markup = renderToStaticMarkup(<MemoryRouter><LandingPage /></MemoryRouter>)

    expect(markup).toContain('Iniciar sesión')
    expect(markup).toContain('Chatbot autoalojado para el día a día')
  })
})

describe('landing page GitHub stars', () => {
  const REPO_API = 'https://api.github.com/repos/IsaacThoman/pulpo'
  const storage = new Map<string, string>()
  // Answers the star count request; the download button's release lookup gets a 404 and is ignored.
  const repoFetch = vi.fn<() => Promise<Response>>()
  const fetchMock = vi.fn<typeof fetch>(async (input) => (input === REPO_API ? repoFetch() : new Response('{}', { status: 404 })))
  const starsResponse = (stargazers_count: number) => new Response(JSON.stringify({ stargazers_count }), { status: 200 })
  const renderLanding = () => render(<MemoryRouter><LandingPage /></MemoryRouter>)

  beforeEach(() => {
    storage.clear()
    repoFetch.mockReset()
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
    // An in-memory stand-in, since Node's own experimental localStorage can shadow jsdom's.
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('leaves the count out of the pre-rendered markup', () => {
    const markup = renderToStaticMarkup(<MemoryRouter><LandingPage /></MemoryRouter>)

    expect(markup).not.toContain('stars')
    expect(repoFetch).not.toHaveBeenCalled()
  })

  it('shows the star count next to both GitHub links after one fetch, and caches it', async () => {
    repoFetch.mockResolvedValue(starsResponse(1234))

    renderLanding()

    await waitFor(() => expect(screen.getAllByText('1.2K stars')).toHaveLength(2))
    expect(repoFetch).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: 'GitHub 1.2K stars' })).toHaveProperty('href', 'https://github.com/IsaacThoman/pulpo')
    expect(screen.getByRole('link', { name: 'View on GitHub 1.2K stars' })).toHaveProperty('href', 'https://github.com/IsaacThoman/pulpo')
    expect(JSON.parse(storage.get('pulpo:github-stars') ?? '{}')).toMatchObject({ count: 1234 })
  })

  it('uses a fresh cached count without fetching again', async () => {
    storage.set('pulpo:github-stars', JSON.stringify({ count: 5, fetchedAt: Date.now() }))

    renderLanding()

    await waitFor(() => expect(screen.getAllByText('5 stars')).toHaveLength(2))
    expect(repoFetch).not.toHaveBeenCalled()
  })

  it('refetches once the cached count is stale', async () => {
    storage.set('pulpo:github-stars', JSON.stringify({ count: 5, fetchedAt: Date.now() - 7 * 60 * 60 * 1000 }))
    repoFetch.mockResolvedValue(starsResponse(1))

    renderLanding()

    await waitFor(() => expect(screen.getAllByText('1 star')).toHaveLength(2))
    expect(repoFetch).toHaveBeenCalledTimes(1)
  })

  it('shows no count when GitHub fails or is rate limited', async () => {
    repoFetch.mockResolvedValueOnce(new Response('{"message":"API rate limit exceeded"}', { status: 403 }))

    const { unmount } = renderLanding()
    await waitFor(() => expect(repoFetch).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText(/\bstars?$/)).toBeNull()
    expect(storage.has('pulpo:github-stars')).toBe(false)
    unmount()

    repoFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderLanding()
    await waitFor(() => expect(repoFetch).toHaveBeenCalledTimes(2))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText(/\bstars?$/)).toBeNull()
    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveProperty('href', 'https://github.com/IsaacThoman/pulpo')
  })

  it('formats the count for the current language', async () => {
    await i18n.changeLanguage('es-ES')
    repoFetch.mockResolvedValue(starsResponse(1234))

    renderLanding()

    await waitFor(() => expect(screen.getAllByText('1,2 mil estrellas')).toHaveLength(2))
  })

  it('survives storage that throws', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    })
    repoFetch.mockResolvedValue(starsResponse(42))

    renderLanding()

    await waitFor(() => expect(screen.getAllByText('42 stars')).toHaveLength(2))
  })
})
