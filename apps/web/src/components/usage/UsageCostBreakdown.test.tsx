import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { UsageCostBreakdown } from './UsageCostBreakdown'

function renderCost(props: ComponentProps<typeof UsageCostBreakdown>): string {
  return renderToStaticMarkup(<TooltipProvider><UsageCostBreakdown {...props} /></TooltipProvider>)
}

describe('UsageCostBreakdown', () => {
  it('shows one violet combined cost with the breakdown available on hover', () => {
    const markup = renderCost({
      costUsd: 0.05,
      inferenceReferenceUsd: 0.31,
      subscriptionCoveredUsd: 0.05,
      personal: true,
    })
    expect(markup).toContain('data-inference-reference-cost')
    expect(markup).toContain('text-violet-700')
    expect(markup).toContain('>$0.3600</span>')
    expect(markup).toContain('aria-label="$0.3600 · API equivalent: $0.3100 · Pulpo usage: $0.0500 · Covered by your subscription · $0.0000 charged to balance"')
    expect(markup.match(/>\$0\.3100</g)).toBeNull()
    expect(markup.match(/>\$0\.0500</g)).toBeNull()
  })

  it('keeps ordinary provider costs compact', () => {
    const markup = renderCost({
      costUsd: 0.05,
      inferenceReferenceUsd: 0,
      subscriptionCoveredUsd: 0,
    })
    expect(markup).not.toContain('API equivalent')
    expect(markup).not.toContain('Pulpo usage')
  })
})
