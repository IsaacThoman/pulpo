// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Banner } from '@pulpo/contracts'
import { BannerBar } from './BannerBar'
import type { SignupPromoOffer } from './signup-promo'

const apiRequest = vi.hoisted(() => vi.fn())
const auth = vi.hoisted(() => ({ instanceReady: true, billingEnabled: false, user: { id: 'user-1' } as { id: string } | null }))
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), apiRequest }))
vi.mock('@/lib/runtime', () => ({ isDesktopRuntime: () => false }))
vi.mock('@/stores/auth', () => ({ useAuth: (select: (state: typeof auth) => unknown) => select(auth) }))
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  clear: () => storage.clear(),
})

function banner(id: string, overrides: Partial<Banner> = {}): Banner {
  return { id, type: 'info', content: `Banner ${id}`, dismissible: true, startsAt: null, endsAt: null, createdAt: '2026-10-01T00:00:00.000Z', ...overrides }
}

function offer(overrides: Partial<SignupPromoOffer> = {}): SignupPromoOffer {
  return { amountMicros: 1_000_000, message: '', eligibleUntil: '2026-12-01T00:00:00.000Z', available: true, resetsAt: '2026-11-26T00:00:00.000Z', ...overrides }
}

function renderBar(props: { signupPromo?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><BannerBar {...props} /></QueryClientProvider>)
}

/** Answers the banner list and the promo endpoints; `claim` handles POSTs. */
function serve(promo: SignupPromoOffer | null, claim: () => Promise<unknown> = async () => ({ amountMicros: 1_000_000 })) {
  let current = promo
  apiRequest.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (path === '/api/banners') return { data: [] }
    if (path === '/api/billing/signup-promo/claim' && options?.method === 'POST') {
      const result = await claim()
      current = null
      return result
    }
    if (path === '/api/billing/signup-promo') return { offer: current }
    throw new Error(`Unexpected request ${path}`)
  })
}

beforeEach(() => {
  localStorage.clear()
  auth.billingEnabled = false
  auth.user = { id: 'user-1' }
})
afterEach(() => {
  cleanup()
  apiRequest.mockReset()
})

describe('BannerBar', () => {
  it('keeps a dismissed banner hidden after remounting', async () => {
    apiRequest.mockResolvedValue({ data: [banner('a'), banner('b')] })
    const first = renderBar()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Dismiss banner' }))[0]!)
    expect(screen.queryByText('Banner a')).toBeNull()
    first.unmount()

    renderBar()
    expect(await screen.findByText('Banner b')).toBeTruthy()
    expect(screen.queryByText('Banner a')).toBeNull()
  })

  it('shows a previously dismissed banner once it is no longer dismissible', async () => {
    localStorage.setItem('pulpo.banners.dismissed', JSON.stringify(['a']))
    apiRequest.mockResolvedValue({ data: [banner('a', { dismissible: false })] })
    renderBar()
    expect(await screen.findByText('Banner a')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Dismiss banner' })).toBeNull()
  })

  it('never asks for a signup promo where billing is off', async () => {
    serve(offer())
    renderBar()
    await vi.waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/banners'))
    expect(apiRequest).not.toHaveBeenCalledWith('/api/billing/signup-promo')
  })
})

describe('signup promo banner', () => {
  beforeEach(() => { auth.billingEnabled = true })

  it('claims the credits and confirms them', async () => {
    serve(offer())
    renderBar()
    expect(await screen.findByText('Welcome! Claim $1.00 in free credits to try things out.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Claim $1.00' }))
    expect(await screen.findByText('$1.00 in credits was added to your balance.')).toBeTruthy()
    expect(apiRequest).toHaveBeenCalledWith('/api/billing/signup-promo/claim', { method: 'POST', body: {} })
    expect(screen.queryByRole('button', { name: 'Claim $1.00' })).toBeNull()
  })

  it('shows the admin message and waits for the budget to reset', async () => {
    serve(offer({ message: 'Launch week gift', available: false }))
    renderBar()
    expect(await screen.findByText('Launch week gift')).toBeTruthy()
    expect(screen.getByText(/Free credits are all claimed for now\. Check back after/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Claim $1.00' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('stays dismissed for that account after remounting', async () => {
    serve(offer())
    const first = renderBar()
    await screen.findByRole('button', { name: 'Claim $1.00' })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss banner' }))
    expect(screen.queryByRole('button', { name: 'Claim $1.00' })).toBeNull()
    first.unmount()

    renderBar()
    await vi.waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/billing/signup-promo'))
    expect(screen.queryByRole('button', { name: 'Claim $1.00' })).toBeNull()
    cleanup()

    auth.user = { id: 'user-2' }
    renderBar()
    expect(await screen.findByRole('button', { name: 'Claim $1.00' })).toBeTruthy()
  })

  it('skips the signup promo on Billing and still shows site banners', async () => {
    apiRequest.mockImplementation(async (path: string) => path === '/api/banners' ? { data: [banner('a')] } : { offer: offer() })
    renderBar({ signupPromo: false })
    expect(await screen.findByText('Banner a')).toBeTruthy()
    expect(apiRequest).not.toHaveBeenCalledWith('/api/billing/signup-promo')
    expect(screen.queryByRole('button', { name: 'Claim $1.00' })).toBeNull()
  })

  it('reports a failed claim without hiding the offer', async () => {
    serve(offer(), async () => { throw new Error('network down') })
    renderBar()
    fireEvent.click(await screen.findByRole('button', { name: 'Claim $1.00' }))
    expect(await screen.findByText('Could not claim the credits. Try again.')).toBeTruthy()
  })
})
