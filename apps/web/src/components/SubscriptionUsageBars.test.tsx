import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
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
  resetsAt: null,
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
    expect(markup).not.toContain('Starts on first use')
  })

  it('keeps reservation and reset details in the full billing variant', () => {
    const markup = renderToStaticMarkup(<SubscriptionUsageBars weekly={weekly} fiveHour={fiveHour} />)

    expect(markup).toContain('$0.70')
    expect(markup).toContain('reserved')
    expect(markup).toContain('Resets')
    expect(markup).toContain('Starts on first use')
  })

  it('renders nothing when the account has no subscription limits', () => {
    expect(renderToStaticMarkup(<SubscriptionUsageBars weekly={null} fiveHour={null} />)).toBe('')
  })
})
