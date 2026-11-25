// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SignupPromoOffer } from '@/components/layout/signup-promo'
import { SignupPromoChatAction, SignupPromoClaim } from './SignupPromoClaim'

const apiRequest = vi.hoisted(() => vi.fn())
const auth = vi.hoisted(() => ({ instanceReady: true, billingEnabled: true, user: { id: 'user-1' } }))
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), apiRequest }))
vi.mock('@/lib/runtime', () => ({ isDesktopRuntime: () => false }))
vi.mock('@/stores/auth', () => ({ useAuth: (select: (state: typeof auth) => unknown) => select(auth) }))

function offer(overrides: Partial<SignupPromoOffer> = {}): SignupPromoOffer {
  return { amountMicros: 1_000_000, message: 'Banner-only copy', eligibleUntil: '2026-12-01T00:00:00.000Z', available: true, resetsAt: '2026-11-26T00:00:00.000Z', ...overrides }
}

function serve(promo: SignupPromoOffer | null) {
  let current = promo
  apiRequest.mockImplementation(async (path: string) => {
    if (path === '/api/billing/signup-promo/claim') { current = null; return { amountMicros: 1_000_000 } }
    if (path === '/api/billing/signup-promo') return { offer: current }
    throw new Error(`Unexpected request ${path}`)
  })
}

function renderClaim() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><SignupPromoClaim /></QueryClientProvider>)
}

function renderChatAction() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><SignupPromoChatAction fallback={<a href="/billing">View billing</a>} /></QueryClientProvider>)
}

beforeEach(() => {
  auth.billingEnabled = true
  // A dismissed banner must not hide these fallbacks.
  localStorage.setItem('pulpo.signupPromo.dismissed', JSON.stringify(['user-1']))
})
afterEach(() => {
  cleanup()
  apiRequest.mockReset()
  localStorage.clear()
})

describe('SignupPromoClaim', () => {
  it('confirms a claim from the billing page', async () => {
    serve(offer())
    renderClaim()
    expect(await screen.findByText('New here? Claim $1.00 in free credits.')).toBeTruthy()
    expect(screen.queryByText('Banner-only copy')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Claim $1.00' }))
    expect(await screen.findByText('$1.00 in credits was added to your balance.')).toBeTruthy()
  })

  it('shows on the billing page with the reset time while the budget is used up', async () => {
    serve(offer({ available: false }))
    renderClaim()
    expect(await screen.findByText('New here? Claim $1.00 in free credits.')).toBeTruthy()
    expect(screen.getByText(/Check back after/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Claim $1.00' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders nothing without an offer or where billing is off', async () => {
    serve(null)
    const view = renderClaim()
    await vi.waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/billing/signup-promo'))
    expect(view.container.textContent).toBe('')
    cleanup()
    apiRequest.mockClear()
    auth.billingEnabled = false
    renderClaim()
    expect(apiRequest).not.toHaveBeenCalled()
  })
})

describe('SignupPromoChatAction', () => {
  it('replaces the billing link with a claim, then says how to continue', async () => {
    serve(offer())
    renderChatAction()
    fireEvent.click(await screen.findByRole('button', { name: 'Claim $1.00' }))
    expect(screen.queryByRole('link', { name: 'View billing' })).toBeNull()
    expect(await screen.findByText('$1.00 in credits was added to your balance. Regenerate this response to continue.')).toBeTruthy()
  })

  it('keeps the billing link while the budget is used up or there is no offer', async () => {
    serve(offer({ available: false }))
    renderChatAction()
    await vi.waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/billing/signup-promo'))
    // Let the offer load, so the link is not just the loading state.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.getByRole('link', { name: 'View billing' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Claim $1.00' })).toBeNull()
    cleanup()

    serve(null)
    renderChatAction()
    expect(await screen.findByRole('link', { name: 'View billing' })).toBeTruthy()
  })
})
