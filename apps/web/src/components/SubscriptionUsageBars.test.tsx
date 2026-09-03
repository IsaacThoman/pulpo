import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { activeLocale } from '@/i18n/ui'
import { SubscriptionUsageBars } from './SubscriptionUsageBars'

const weekly = {
  remainingPercentage: 72,
  availableBarPercentage: 65,
  pendingMicros: 700_000,
  pendingBarPercentage: 7,
  resetsAt: '2026-09-07T00:00:00.000Z',
}

const fiveHour = {
  remainingPercentage: 40,
  availableBarPercentage: 35,
  pendingMicros: 50_000,
  pendingBarPercentage: 5,
  resetsAt: '2026-09-02T17:30:00.000Z',
}

describe('SubscriptionUsageBars', () => {
  it('renders compact accessible weekly and five-hour limits without billing details', () => {
    const markup = renderToStaticMarkup(<SubscriptionUsageBars compact weekly={weekly} fiveHour={fiveHour} />)

    expect(markup).toContain('Weekly usage')
    expect(markup).toContain('72% left')
    expect(markup).toContain('5-hour usage')
    expect(markup).toContain('40% left')
    expect(markup).toContain('role="progressbar"')
    expect(markup).toContain('aria-valuetext="72% left"')
    expect(markup).not.toContain('reserved')
    expect(markup).not.toContain('Resets')
  })

  it('shows the weekly reset date but only the five-hour reset time in the full billing variant', () => {
    const markup = renderToStaticMarkup(<SubscriptionUsageBars weekly={weekly} fiveHour={fiveHour} />)
    const locale = activeLocale()
    const weeklyReset = new Date(weekly.resetsAt).toLocaleString(locale, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    const fiveHourReset = new Date(fiveHour.resetsAt).toLocaleString(locale, { hour: 'numeric', minute: '2-digit' })
    const fiveHourResetWithDate = new Date(fiveHour.resetsAt).toLocaleString(locale, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

    expect(markup).toContain('$0.70')
    expect(markup).toContain('reserved')
    expect(markup).toContain(`Resets ${weeklyReset}`)
    expect(markup).toContain(`Resets ${fiveHourReset}`)
    expect(markup).not.toContain(fiveHourResetWithDate)
  })

  it('renders nothing when the account has no subscription limits', () => {
    expect(renderToStaticMarkup(<SubscriptionUsageBars weekly={null} fiveHour={null} />)).toBe('')
  })
})
