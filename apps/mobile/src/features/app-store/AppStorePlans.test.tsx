// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { UsageLimits, UsageLimitsPlans } from '@pulpo/contracts'
const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  openURL: vi.fn(),
  kit: {
    products: vi.fn(), purchase: vi.fn(), finish: vi.fn(), sync: vi.fn(), currentEntitlements: vi.fn(), showManageSubscriptions: vi.fn(),
  },
  api: { appStoreAccountToken: vi.fn(), syncAppStoreTransaction: vi.fn() },
}))
vi.mock('react-native', () => {
  type Props = { children?: ReactNode; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string }
  const element = (tag: string) => ({ children, onPress, disabled, accessibilityLabel }: Props) =>
    createElement(tag, { onClick: disabled ? undefined : onPress, 'aria-label': accessibilityLabel }, children)
  return {
    Alert: { alert: mocks.alert },
    Linking: { openURL: mocks.openURL },
    Platform: { OS: 'ios' },
    StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
    ActivityIndicator: () => createElement('progress'),
    ScrollView: element('div'),
    View: element('div'),
    Text: element('span'),
    Pressable: ({ children, onPress, disabled }: Props) => createElement('button', { onClick: onPress, disabled }, children),
  }
})
vi.mock('../../mockup5/src/theme', () => ({
  useAppTheme: () => ({ isDark: false, red: '#C5221F', background: '#F5F5F7', elevated: '#FFFFFF', accent: '#111114', accentText: '#FFFFFF', text: '#000000', secondary: '#666666', separator: '#DDDDDD', blue: '#007AFF' }),
}))
vi.mock('../usage-limits/UsageLimitsSettings', () => ({
  UsageLimitCard: ({ row }: { row: { label: string } }) => createElement('div', null, row.label),
}))
vi.mock('../../api/client', () => ({ mobileApi: mocks.api, ApiError: class extends Error {} }))
import { AppStorePlans } from './AppStorePlans'

const offer = { eight: 'pulpoEight', fat: 'pulpoFat' }
const products = [
  { id: 'pulpoEight', displayName: 'Pulpo Eight', description: 'Higher usage limits', displayPrice: '$9.99', periodUnit: 'month', periodValue: 1 },
  { id: 'pulpoFat', displayName: 'Pulpo Fat', description: 'The highest usage limits', displayPrice: '$29.99', periodUnit: 'month', periodValue: 1 },
]
const plans: UsageLimitsPlans = { storageLimitBytes: { baby: 2 * 1024 ** 3, eight: 10 * 1024 ** 3, fat: 25 * 1024 ** 3 }, fatSharedWeeklyPercent: 50 }
const baby: UsageLimits = { plan: 'baby', subscription: null, plans, weekly: null, fiveHour: null, custom: [] }
const fatSubscriber: UsageLimits = {
  ...baby,
  plan: 'fat',
  subscription: { provider: 'app_store', plan: 'fat', pendingPlan: null, status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: '2026-11-05T18:58:58.000Z' },
  weekly: { remainingPercentage: 82, availableBarPercentage: 82, pendingBarPercentage: 0, resetsAt: '2026-11-09T00:00:00.000Z' },
}
const onChanged = vi.fn()
const mount = (limits: UsageLimits = baby) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
  <AppStorePlans kit={mocks.kit as never} offer={offer} limits={limits} onChanged={onChanged} />
</QueryClientProvider>)

beforeEach(() => {
  mocks.kit.products.mockResolvedValue(products)
  mocks.kit.finish.mockResolvedValue(undefined)
  mocks.api.appStoreAccountToken.mockResolvedValue('7c9e6679-7425-40de-944b-e07fc1f90ae7')
  mocks.api.syncAppStoreTransaction.mockResolvedValue({ plan: 'fat' })
  onChanged.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

describe('App Store plan cards', () => {
  it('sells both plans at the App Store’s prices with the web’s selling points and the required terms', async () => {
    mount()
    expect(await screen.findByLabelText('$9.99/month')).toBeTruthy()
    expect(screen.getByLabelText('$29.99/month')).toBeTruthy()
    for (const line of ['Everything in Pulpo Baby', 'High usage limits', '10 GB of file storage', 'Cancel any time',
      'Everything in Pulpo Eight', 'Highest usage limits', 'Share 50% of your weekly usage', '25 GB of file storage']) {
      expect(screen.getByText(line)).toBeTruthy()
    }
    // App Store Connect descriptions are not shown.
    expect(screen.queryByText('Higher usage limits')).toBeNull()
    expect(screen.getByText(/renew automatically each month/)).toBeTruthy()
    fireEvent.click(screen.getByText('Terms of Use'))
    expect(mocks.openURL).toHaveBeenCalledWith('https://help.pulpo.baby/terms-hosted')
    fireEvent.click(screen.getByText('Privacy Policy'))
    expect(mocks.openURL).toHaveBeenCalledWith('https://help.pulpo.baby/privacy-hosted')
    expect(screen.getByText('Restore Purchases')).toBeTruthy()
    expect(screen.queryByText('Usage limits')).toBeNull()
    expect(document.body.textContent).not.toMatch(/credit|balance|Pool/i)
  })

  it('shows an App Store subscriber their limits, their plan with its renewal, and a switch to the other plan', async () => {
    mocks.kit.showManageSubscriptions.mockResolvedValue(undefined)
    mount(fatSubscriber)
    expect(await screen.findByText('Current plan')).toBeTruthy()
    expect(screen.getByText('Usage limits')).toBeTruthy()
    expect(screen.getByText('Weekly usage')).toBeTruthy()
    expect(screen.getByText('Ends Nov 5, 2026')).toBeTruthy()
    expect(screen.getByText('Switch to Eight')).toBeTruthy()
    fireEvent.click(screen.getByText('Manage Subscription').closest('button')!)
    await waitFor(() => expect(mocks.kit.showManageSubscriptions).toHaveBeenCalled())
    expect(mocks.kit.purchase).not.toHaveBeenCalled()
  })

  it('switches an App Store subscriber’s plan and holds a change that starts at renewal', async () => {
    mocks.kit.purchase.mockResolvedValue({ status: 'purchased', transactionId: '10', originalTransactionId: '9', productId: 'pulpoEight', signedTransaction: 'jws' })
    mount(fatSubscriber)
    fireEvent.click((await screen.findByText('Switch to Eight')).closest('button')!)
    await waitFor(() => expect(mocks.alert).toHaveBeenCalledWith('Subscription updated', 'Pulpo Eight starts at your next renewal.'))
    cleanup()
    mount({ ...fatSubscriber, subscription: { ...fatSubscriber.subscription!, cancelAtPeriodEnd: false, pendingPlan: 'eight' } })
    expect((await screen.findByText('Starts at renewal')).closest('button')!.disabled).toBe(true)
  })

  it('leaves out lines that need plan details from an older server', async () => {
    mount({ ...baby, plans: null })
    expect(await screen.findByText('Everything in Pulpo Eight')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/storage|Share/)
  })

  it('buys a plan, reports it, finishes it, and refreshes the plan', async () => {
    mocks.kit.purchase.mockResolvedValue({ status: 'purchased', transactionId: '9', originalTransactionId: '9', productId: 'pulpoFat', signedTransaction: 'jws' })
    mount()
    fireEvent.click((await screen.findByText('Choose Fat')).closest('button')!)
    await waitFor(() => expect(mocks.alert).toHaveBeenCalledWith('You’re on Pulpo Fat', 'Your new usage limits apply now.'))
    expect(mocks.kit.purchase).toHaveBeenCalledWith('pulpoFat', '7c9e6679-7425-40de-944b-e07fc1f90ae7')
    expect(mocks.api.syncAppStoreTransaction).toHaveBeenCalledWith('jws')
    expect(mocks.kit.finish).toHaveBeenCalledWith('9')
    expect(onChanged).toHaveBeenCalled()
  })

  it('offers to retry when the App Store can’t load the plans', async () => {
    mocks.kit.products.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(products)
    mount()
    fireEvent.click(await screen.findByText('Try Again'))
    expect(await screen.findByText('Choose Eight')).toBeTruthy()
  })
})
