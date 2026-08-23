import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import {
  SubscriptionCoverageCost,
} from './SubscriptionCoverageCost'
import {
  subscriptionCoverageDetails,
  subscriptionCoverageLabel,
} from './subscription-coverage'
import { TooltipProvider } from '@/components/ui/tooltip'

function renderCost(props: ComponentProps<typeof SubscriptionCoverageCost>): string {
  return renderToStaticMarkup(
    <TooltipProvider><SubscriptionCoverageCost {...props} /></TooltipProvider>,
  )
}

describe('subscription coverage cost', () => {
  it.each([
    [1, 0, 'none'],
    [1, 0.25, 'partial'],
    [1, 1, 'full'],
    [0, 1, 'none'],
    [1, 2, 'full'],
  ] as const)('classifies cost %s with %s covered as %s', (cost, covered, status) => {
    expect(subscriptionCoverageDetails(cost, covered).status).toBe(status)
  })

  it('clamps defensive over-coverage and never reports a negative charge', () => {
    expect(subscriptionCoverageDetails(1, 2)).toEqual({
      status: 'full',
      coveredUsd: 1,
      chargedUsd: 0,
    })
  })

  it('uses personal and shared tooltip copy', () => {
    const full = subscriptionCoverageDetails(0.0002, 0.0002)
    const partial = subscriptionCoverageDetails(0.0002, 0.0001)
    expect(subscriptionCoverageLabel(full, true)).toBe('Covered by your subscription · $0.0000 charged to balance')
    expect(subscriptionCoverageLabel(full, false)).toBe('Covered by subscription · $0.0000 charged to balance')
    expect(subscriptionCoverageLabel(partial, true)).toBe('$0.0001 covered by your subscription · $0.0001 charged to balance')
  })

  it('renders the original cost and an accessible full-coverage indicator', () => {
    const markup = renderCost({ costUsd: 0.0002, subscriptionCoveredUsd: 0.0002, personal: true })
    expect(markup).toContain('$0.0002')
    expect(markup).toContain('text-violet-700 dark:text-violet-300')
    expect(markup).toContain('lucide-info')
    expect(markup).toContain('data-subscription-coverage="full"')
    expect(markup).toContain('aria-label="Covered by your subscription · $0.0000 charged to balance"')
  })

  it('uses the same info indicator for partial coverage and no treatment for uncovered cost', () => {
    const partial = renderCost({ costUsd: 0.0002, subscriptionCoveredUsd: 0.0001 })
    const uncovered = renderCost({ costUsd: 0.0002, subscriptionCoveredUsd: 0 })
    expect(partial).toContain('data-subscription-coverage="partial"')
    expect(partial).toContain('text-violet-700 dark:text-violet-300')
    expect(partial).toContain('lucide-info')
    expect(uncovered).toContain('$0.0002')
    expect(uncovered).not.toContain('data-subscription-coverage')
    expect(uncovered).not.toContain('text-violet-700')
    expect(uncovered).not.toContain('lucide-info')
  })
})
