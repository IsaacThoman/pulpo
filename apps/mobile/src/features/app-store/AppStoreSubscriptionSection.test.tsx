// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { UsageLimits } from '@pulpo/contracts'
const mocks = vi.hoisted(() => ({
  offer: { eight: 'pulpoEight', fat: 'pulpoFat' } as { eight: string; fat: string } | null,
  alert: vi.fn(),
  kit: {
    products: vi.fn(), purchase: vi.fn(), finish: vi.fn(), sync: vi.fn(), currentEntitlements: vi.fn(), showManageSubscriptions: vi.fn(),
  },
  api: { appStoreAccountToken: vi.fn(), syncAppStoreTransaction: vi.fn() },
}))
const { passthrough } = vi.hoisted(() => ({ passthrough: ({ children }: { children?: unknown }) => children }))
vi.mock('react-native', () => ({ Alert: { alert: mocks.alert }, Linking: { openURL: vi.fn() }, Platform: { OS: 'ios' } }))
vi.mock('@expo/ui/swift-ui', () => ({
  Section: ({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) => createElement('section', { 'aria-label': title }, children, footer),
  LabeledContent: ({ label, children }: { label: string; children: ReactNode }) => createElement('div', null, createElement('span', null, label), children),
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  Link: ({ label, destination }: { label: string; destination: string }) => createElement('a', { href: destination }, label),
  Button: ({ label, children, onPress, modifiers }: { label?: string; children?: ReactNode; onPress: () => void; modifiers?: Array<{ disabled?: boolean }> }) =>
    createElement('button', { onClick: onPress, disabled: modifiers?.some((item) => item?.disabled) }, label ?? children),
  HStack: passthrough, VStack: passthrough, Spacer: () => null,
}))
vi.mock('@expo/ui/swift-ui/modifiers', () => ({ disabled: (value: boolean) => ({ disabled: value }), font: vi.fn(), foregroundStyle: vi.fn() }))
vi.mock('../../api/client', () => ({ mobileApi: mocks.api, ApiError: class extends Error {} }))
vi.mock('./storeKit', () => ({ storeKit: mocks.kit }))
vi.mock('./useAppStoreOffer', () => ({ useAppStoreOffer: () => mocks.offer }))
import { AppStoreSubscriptionSection } from './AppStoreSubscriptionSection'

const products = [
  { id: 'pulpoEight', displayName: 'Pulpo Eight', description: 'Higher usage limits', displayPrice: '$9.99', periodUnit: 'month', periodValue: 1 },
  { id: 'pulpoFat', displayName: 'Pulpo Fat', description: 'The highest usage limits', displayPrice: '$29.99', periodUnit: 'month', periodValue: 1 },
]
const baby: UsageLimits = { plan: 'baby', subscription: null, plans: null, weekly: null, fiveHour: null, custom: [] }
const appStoreEight: UsageLimits = {
  ...baby,
  plan: 'eight',
  subscription: { provider: 'app_store', plan: 'eight', pendingPlan: null, status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: '2026-12-01T12:00:00.000Z' },
}
const onChanged = vi.fn()
const mount = (limits: UsageLimits) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
  <AppStoreSubscriptionSection limits={limits} onChanged={onChanged} />
</QueryClientProvider>)

beforeEach(() => {
  mocks.offer = { eight: 'pulpoEight', fat: 'pulpoFat' }
  mocks.kit.products.mockResolvedValue(products)
  mocks.kit.finish.mockResolvedValue(undefined)
  mocks.api.appStoreAccountToken.mockResolvedValue('7c9e6679-7425-40de-944b-e07fc1f90ae7')
  mocks.api.syncAppStoreTransaction.mockResolvedValue({ plan: 'fat' })
  onChanged.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

describe('App Store subscriptions on the Usage screen', () => {
  it('changes plans at the App Store’s prices, with the required terms and links', async () => {
    mocks.kit.purchase.mockResolvedValue({ status: 'purchased', transactionId: '9', originalTransactionId: '9', productId: 'pulpoFat', signedTransaction: 'jws' })
    mount(appStoreEight)
    fireEvent.click((await screen.findByText('$29.99/month')).closest('button')!)
    await waitFor(() => expect(mocks.alert).toHaveBeenCalledWith('Subscription updated', 'Pulpo Fat applies now.'))
    expect(mocks.kit.purchase).toHaveBeenCalledWith('pulpoFat', '7c9e6679-7425-40de-944b-e07fc1f90ae7')
    expect(mocks.api.syncAppStoreTransaction).toHaveBeenCalledWith('jws')
    expect(mocks.kit.finish).toHaveBeenCalledWith('9')
    expect(onChanged).toHaveBeenCalled()
    expect(screen.getByText(/renew automatically each month/)).toBeTruthy()
    expect(screen.getByText('Terms of Use').getAttribute('href')).toBe('https://help.pulpo.baby/terms-hosted')
    expect(screen.getByText('Privacy Policy').getAttribute('href')).toBe('https://help.pulpo.baby/privacy-hosted')
    expect(document.body.textContent).not.toMatch(/credit|balance/i)
  })

  it('marks the current App Store plan and offers subscription management', async () => {
    mocks.kit.showManageSubscriptions.mockResolvedValue(undefined)
    mount(appStoreEight)
    expect(await screen.findByText('Current plan')).toBeTruthy()
    expect(screen.getByText('Current plan').closest('button')!.disabled).toBe(true)
    expect(screen.getByText('Renews Dec 1, 2026')).toBeTruthy()
    fireEvent.click(screen.getByText('Manage Subscription'))
    await waitFor(() => expect(mocks.kit.showManageSubscriptions).toHaveBeenCalled())
  })

  it('leaves Pulpo Baby to the plan cards, and offers no purchases for a subscription billed elsewhere or a plan an administrator set', () => {
    mount(baby)
    expect(document.body.textContent).toBe('')
    cleanup()
    mount({ ...appStoreEight, subscription: { ...appStoreEight.subscription!, provider: 'stripe' } })
    expect(screen.getByText('Your subscription is managed outside the App Store.')).toBeTruthy()
    expect(screen.queryByText('Restore Purchases')).toBeNull()
    cleanup()
    mount({ ...baby, plan: 'fat' })
    expect(document.body.textContent).toBe('')
    expect(mocks.kit.products).not.toHaveBeenCalled()
  })

  it('shows nothing where this build may not buy', () => {
    mocks.offer = null
    mount(appStoreEight)
    expect(document.body.textContent).toBe('')
  })
})
