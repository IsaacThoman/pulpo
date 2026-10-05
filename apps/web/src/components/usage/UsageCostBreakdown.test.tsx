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

  it('offers the itemized charges on hover for every settled event', () => {
    const markup = renderCost({
      costUsd: 0.0575,
      inferenceReferenceUsd: 0,
      subscriptionCoveredUsd: 0,
      items: [
        { kind: 'model', quantity: 15_147, costMicros: 1_000 },
        { kind: 'tool', name: 'web_search', quantity: 10, costMicros: 50_000 },
        { kind: 'tool', name: 'web_fetch', quantity: 1, costMicros: 5_000 },
        { kind: 'tool', name: 'bash', quantity: 3, costMicros: 0 },
        { kind: 'workspace', quantity: 3, costMicros: 1_500 },
      ],
    })
    expect(markup).toContain('data-usage-cost-breakdown')
    expect(markup).toContain('>$0.0575</span>')
    expect(markup).not.toContain('text-violet-700')
    expect(markup).toContain('aria-label="$0.0575 · 15,147 model tokens: $0.0010 · 10 web searches: $0.0500 · 1 web fetch: $0.0050 · 3 workspace minutes: $0.0015"')
    expect(markup).not.toContain('bash')
  })

  it('lists itemized Pulpo charges beside the API equivalent', () => {
    const markup = renderCost({
      costUsd: 0.005,
      inferenceReferenceUsd: 0.31,
      subscriptionCoveredUsd: 0,
      items: [{ kind: 'tool', name: 'web_search', quantity: 1, costMicros: 5_000 }],
    })
    expect(markup).toContain('aria-label="$0.3150 · API equivalent: $0.3100 · 1 web search: $0.0050"')
    expect(markup).not.toContain('Pulpo usage')
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
