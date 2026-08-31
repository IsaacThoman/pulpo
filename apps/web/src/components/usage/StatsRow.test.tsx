import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { StatsRow } from './StatsRow'

describe('StatsRow', () => {
  it('includes aggregate subscription coverage in the combined spend breakdown', () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <StatsRow
          calls={2}
          tokens={1_000}
          cost={0.05}
          subscriptionCoveredCost={0.05}
          inferenceReferenceCost={0.31}
        />
      </TooltipProvider>,
    )

    expect(markup).toContain('>$0.3600</span>')
    expect(markup).toContain('Pulpo usage: $0.0500')
    expect(markup).toContain('Covered by your subscription · $0.0000 charged to balance')
  })
})
