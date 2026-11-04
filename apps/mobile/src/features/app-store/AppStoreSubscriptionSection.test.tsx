// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import type { UsageLimits } from '@pulpo/contracts'
const mocks = vi.hoisted(() => ({ offer: { eight: 'pulpoEight', fat: 'pulpoFat' } as { eight: string; fat: string } | null }))
vi.mock('@expo/ui/swift-ui', () => ({
  Section: ({ title, children }: { title: string; children: ReactNode }) => createElement('section', { 'aria-label': title }, children),
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
}))
vi.mock('@expo/ui/swift-ui/modifiers', () => ({ foregroundStyle: vi.fn() }))
vi.mock('./storeKit', () => ({ storeKit: {} }))
vi.mock('./useAppStoreOffer', () => ({ useAppStoreOffer: () => mocks.offer }))
import { AppStoreSubscriptionSection } from './AppStoreSubscriptionSection'

const subscription = { provider: 'stripe' as const, plan: 'eight' as const, pendingPlan: null, status: 'active' as const, cancelAtPeriodEnd: false, currentPeriodEnd: '2026-12-01T12:00:00.000Z' }
const limits: UsageLimits = { plan: 'eight', subscription, plans: null, weekly: null, fiveHour: null, custom: [] }

afterEach(() => { cleanup(); mocks.offer = { eight: 'pulpoEight', fat: 'pulpoFat' } })

describe('App Store subscription note on the Usage form', () => {
  it('explains that a web subscription is managed outside the App Store', () => {
    render(<AppStoreSubscriptionSection limits={limits} />)
    expect(screen.getByText('Your subscription is managed outside the App Store.')).toBeTruthy()
  })

  it('shows nothing for App Store subscribers, Pulpo Baby, plans an administrator set, or builds that can’t buy', () => {
    for (const value of [
      { ...limits, subscription: { ...subscription, provider: 'app_store' as const } },
      { ...limits, plan: 'baby' as const, subscription: null },
      { ...limits, plan: 'fat' as const, subscription: null },
    ]) {
      render(<AppStoreSubscriptionSection limits={value} />)
      expect(document.body.textContent).toBe('')
      cleanup()
    }
    mocks.offer = null
    render(<AppStoreSubscriptionSection limits={limits} />)
    expect(document.body.textContent).toBe('')
  })
})
