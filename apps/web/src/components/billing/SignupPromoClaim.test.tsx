// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SignupPromoOffer } from '@/components/layout/signup-promo'
import { SignupPromoClaim } from './SignupPromoClaim'

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

function renderClaim(context: 'billing' | 'chat') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><SignupPromoClaim context={context} /></QueryClientProvider>)
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
  it('offers the claim when a chat runs out of credits, then says how to continue', async () => {
    serve(offer())
    renderClaim('chat')
    expect(await screen.findByText('New here? Claim $1.00 in free credits to keep chatting.')).toBeTruthy()
    expect(screen.queryByText('Banner-only copy')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Claim $1.00' }))
    expect(await screen.findByText('$1.00 in credits was added to your balance. Regenerate this response to continue.')).toBeTruthy()
  })

  it('shows on the billing page with the reset time while the budget is used up', async () => {
    serve(offer({ available: false }))
    renderClaim('billing')
    expect(await screen.findByText('New here? Claim $1.00 in free credits.')).toBeTruthy()
    expect(screen.getByText(/Check back after/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Claim $1.00' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders nothing without an offer or where billing is off', async () => {
    serve(null)
    const view = renderClaim('billing')
    await vi.waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/billing/signup-promo'))
    expect(view.container.textContent).toBe('')
    cleanup()
    apiRequest.mockClear()
    auth.billingEnabled = false
    renderClaim('chat')
    expect(apiRequest).not.toHaveBeenCalled()
  })
})
