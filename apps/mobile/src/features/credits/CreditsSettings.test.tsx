// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CreditSummary, SignupPromoOffer } from '@pulpo/contracts'
const mocks = vi.hoisted(() => ({
  openURL: vi.fn(),
  api: { creditSummary: vi.fn(), signupPromo: vi.fn(), claimSignupPromo: vi.fn() },
}))
const { passthrough } = vi.hoisted(() => ({ passthrough: ({ children }: { children?: unknown }) => children }))
vi.mock('react-native', () => {
  type Props = { children?: ReactNode; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string }
  return {
    AppState: { addEventListener: () => ({ remove: () => {} }) },
    Linking: { openURL: mocks.openURL },
    Platform: { OS: 'ios' },
    StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
    ActivityIndicator: () => createElement('progress'),
    View: ({ children, accessibilityLabel }: Props) => createElement('div', { 'aria-label': accessibilityLabel }, children),
    Text: ({ children }: Props) => createElement('span', null, children),
    Pressable: ({ children, onPress, disabled }: Props) => createElement('button', { onClick: onPress, disabled }, children),
  }
})
vi.mock('@expo/ui/swift-ui', () => ({
  Section: ({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) => createElement('section', { 'aria-label': title }, children, footer),
  LabeledContent: ({ label, children }: { label: string; children: ReactNode }) => createElement('div', null, createElement('span', null, label), children),
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  Button: ({ label, onPress }: { label: string; onPress: () => void }) => createElement('button', { onClick: onPress }, label),
  HStack: passthrough, VStack: passthrough, Spacer: () => null,
}))
vi.mock('@expo/ui/swift-ui/modifiers', () => Object.fromEntries(['accessibilityElement', 'disabled', 'font', 'foregroundStyle', 'monospacedDigit'].map((name) => [name, vi.fn()])))
vi.mock('../../api/client', () => ({ mobileApi: mocks.api, ApiError: class extends Error { code = '' } }))
vi.mock('../app-store/storeKit', () => ({ storeKit: null }))
vi.mock('../../store/session', () => ({ useSessionStore: (selector: (state: unknown) => unknown) => selector({ instanceUrl: 'https://pulpo.baby', user: { id: 'user' } }) }))
vi.mock('../../mockup5/src/theme', () => ({
  useAppTheme: () => ({ isDark: false, red: 'red', green: 'green', blue: 'blue', text: 'black', secondary: 'gray', separator: 'gray' }),
}))
import { CreditsCard, NativeCreditsSections, PaymentHistoryCard } from './CreditsSettings'

const summary: CreditSummary = {
  balanceMicros: 4_250_000,
  balancePendingMicros: 120_000,
  availableBalanceMicros: 4_130_000,
  poolBalanceMicros: null,
  poolBalancePendingMicros: null,
  availablePoolBalanceMicros: null,
  onHold: false,
  autoTopUp: { enabled: false, thresholdCents: null, amountCents: null },
  payments: [
    { id: 'pi_1', provider: 'stripe', kind: 'credits', automatic: false, plan: null, requestedCreditCents: 2500, amountCents: 2688, status: 'paid', createdAt: '2026-11-20T15:00:00.000Z' },
    { id: 'txn_1', provider: 'app_store', kind: 'subscription', automatic: false, plan: 'eight', requestedCreditCents: null, amountCents: 999, status: 'paid', createdAt: '2026-11-01T15:00:00.000Z' },
  ],
}
const offer: SignupPromoOffer = { amountMicros: 1_000_000, message: '', eligibleUntil: '2026-12-28T00:00:00.000Z', available: true, resetsAt: '2026-12-01T00:00:00.000Z' }
const mount = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>)

beforeEach(() => {
  mocks.api.creditSummary.mockResolvedValue(summary)
  mocks.api.signupPromo.mockResolvedValue(null)
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

describe.each([
  ['the Usage form', () => <NativeCreditsSections />],
  ['the plans screen', () => <><CreditsCard surface="white" /><PaymentHistoryCard surface="white" /></>],
])('credits in %s', (_name, view) => {
  it('shows the balance, what is reserved, and recent payments', async () => {
    mount(view())
    expect(await screen.findByText('$4.25')).toBeTruthy()
    expect(screen.getByText('$0.12')).toBeTruthy()
    expect(screen.getByText('$25.00 credit top-up')).toBeTruthy()
    expect(screen.getByText('Pulpo Eight subscription · App Store')).toBeTruthy()
    expect(screen.getByText('$26.88')).toBeTruthy()
  })

  it('adds credits on the web, in the browser', async () => {
    mount(view())
    fireEvent.click(await screen.findByText('Add Credits'))
    expect(mocks.openURL).toHaveBeenCalledWith('https://pulpo.baby/billing?topup=1')
    fireEvent.click(screen.getByText('Billing on the Web'))
    expect(mocks.openURL).toHaveBeenCalledWith('https://pulpo.baby/billing')
  })

  it('claims the signup promo and confirms it', async () => {
    mocks.api.signupPromo.mockResolvedValueOnce(offer).mockResolvedValue(null)
    mocks.api.claimSignupPromo.mockResolvedValue({ amountMicros: 1_000_000, balanceMicros: 1_000_000 })
    mount(view())
    expect(await screen.findByText('Welcome! Claim $1.00 in free credits to try things out.')).toBeTruthy()
    fireEvent.click(screen.getByText('Claim $1.00'))
    expect(await screen.findByText('$1.00 in credits was added to your balance.')).toBeTruthy()
    await waitFor(() => expect(mocks.api.creditSummary.mock.calls.length).toBeGreaterThan(1))
    expect(screen.queryByText('Claim $1.00')).toBeNull()
  })

  it('says when free credits are claimed out for now', async () => {
    mocks.api.signupPromo.mockResolvedValue({ ...offer, available: false })
    mount(view())
    expect(await screen.findByText(/Free credits are all claimed for now/)).toBeTruthy()
    expect(screen.queryByText('Claim $1.00')).toBeNull()
  })
})
