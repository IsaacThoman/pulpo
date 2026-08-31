import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { UsageCostBreakdown } from './UsageCostBreakdown'

function renderCost(props: ComponentProps<typeof UsageCostBreakdown>): string {
  return renderToStaticMarkup(<TooltipProvider><UsageCostBreakdown {...props} /></TooltipProvider>)
}

describe('UsageCostBreakdown', () => {
  it('labels Codex reference value separately from the Pulpo charge', () => {
    const markup = renderCost({
      costUsd: 0.05,
      inferenceReferenceUsd: 0.31,
      subscriptionCoveredUsd: 0.05,
      personal: true,
    })
    expect(markup).toContain('data-inference-reference-cost')
    expect(markup).toContain('$0.3100')
    expect(markup).toContain('API equivalent')
    expect(markup).toContain('$0.0500')
    expect(markup).toContain('Pulpo charge')
  })

  it('keeps ordinary provider costs compact', () => {
    const markup = renderCost({
      costUsd: 0.05,
      inferenceReferenceUsd: 0,
      subscriptionCoveredUsd: 0,
    })
    expect(markup).not.toContain('API equivalent')
    expect(markup).not.toContain('Pulpo charge')
  })
})
