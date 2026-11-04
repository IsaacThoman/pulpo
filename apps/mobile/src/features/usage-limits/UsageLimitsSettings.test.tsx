// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { UsageLimits } from '@pulpo/contracts'
const mocks = vi.hoisted(() => ({ platform: 'ios', usageLimits: vi.fn() }))
const { passthrough } = vi.hoisted(() => ({ passthrough: ({ children }: { children?: unknown }) => children }))
vi.mock('react-native', () => ({
  Platform: { get OS() { return mocks.platform } },
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  View: ({ children, accessibilityLabel, accessibilityValue }: { children?: ReactNode; accessibilityLabel?: string; accessibilityValue?: { text?: string } }) => createElement('div', { 'aria-label': accessibilityLabel, 'aria-valuetext': accessibilityValue?.text }, children),
}))
vi.mock('@expo/ui/swift-ui', () => ({
  Section: ({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) => createElement('section', { 'aria-label': title }, children, footer),
  LabeledContent: ({ label, children }: { label: string; children: ReactNode }) => createElement('div', null, createElement('span', null, label), children),
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  Button: ({ label, onPress }: { label: string; onPress: () => void }) => createElement('button', { onClick: onPress }, label),
  ProgressView: ({ value }: { value: number }) => createElement('progress', { value }),
  HStack: passthrough, VStack: passthrough, Spacer: () => null,
}))
vi.mock('@expo/ui/swift-ui/modifiers', () => Object.fromEntries(['accessibilityElement', 'accessibilityLabel', 'accessibilityValue', 'font', 'foregroundStyle', 'monospacedDigit', 'tint'].map(name => [name, vi.fn()])))
vi.mock('../../api/client', () => ({ mobileApi: { usageLimits: mocks.usageLimits } }))
vi.mock('../../store/session', () => ({ useSessionStore: (selector: (state: unknown) => unknown) => selector({ instanceUrl: 'https://pulpo.test', user: { id: 'user' } }) }))
vi.mock('../../mockup5/src/theme', () => ({ useAppTheme: () => ({ secondary: 'gray', text: 'black', green: 'green', orange: 'orange', blue: 'blue', fillStrong: 'gray', separator: 'gray' }) }))
vi.mock('../../mockup5/src/components/PrototypeUI', () => ({
  Card: passthrough,
  SectionTitle: ({ children }: { children: ReactNode }) => createElement('h2', null, children),
  ListRow: ({ title, value, detail, onPress }: { title: string; value?: string; detail?: string; onPress?: () => void }) => createElement(onPress ? 'button' : 'div', { onClick: onPress }, ...[title, value, detail].filter(Boolean).map(text => createElement('span', { key: text }, text))),
}))
vi.mock('../app-store/AppStoreSubscriptionSection', () => ({ AppStoreSubscriptionSection: () => null }))
import { UsageLimitsSettings } from './UsageLimitsSettings'

const limits: UsageLimits = {
  plan: 'eight',
  subscription: null,
  plans: null,
  weekly: { remainingPercentage: 60, availableBarPercentage: 60, pendingBarPercentage: 10, resetsAt: '2026-11-09T00:00:00.000Z' },
  fiveHour: { remainingPercentage: 25, availableBarPercentage: 25, pendingBarPercentage: 0, resetsAt: null },
  custom: [],
}
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><UsageLimitsSettings /></QueryClientProvider>)
afterEach(() => { cleanup(); vi.clearAllMocks() })

it.each(['ios', 'android'])('shows the plan and remaining usage without amounts on %s', async platform => {
  mocks.platform = platform
  mocks.usageLimits.mockResolvedValue(limits)
  const view = mount()
  await screen.findByText('Pulpo Eight')
  expect(screen.getByText('Weekly usage')).toBeTruthy()
  expect(screen.getByText('60% left')).toBeTruthy()
  expect(screen.getByText('5-hour usage')).toBeTruthy()
  expect(screen.getByText('25% left')).toBeTruthy()
  expect(screen.getByText('Starts on first use')).toBeTruthy()
  expect(view.container.textContent).not.toMatch(/\$|credit|balance/i)
})

it.each(['ios', 'android'])('shows only the plan when it has no usage limits on %s', async platform => {
  mocks.platform = platform
  mocks.usageLimits.mockResolvedValue({ plan: 'baby', weekly: null, fiveHour: null, custom: [] })
  mount()
  await screen.findByText('Pulpo Baby')
  expect(screen.queryByText('Usage limits')).toBeNull()
})

it.each(['ios', 'android'])('retries after a failed load on %s', async platform => {
  mocks.platform = platform
  mocks.usageLimits.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(limits)
  mount()
  fireEvent.click(await screen.findByText(/Usage limits could not be loaded/))
  await screen.findByText('Pulpo Eight')
  expect(mocks.usageLimits).toHaveBeenCalledTimes(2)
})
