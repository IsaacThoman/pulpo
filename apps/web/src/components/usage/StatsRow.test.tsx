import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { StatsRow } from './StatsRow'

describe('StatsRow', () => {
  it('shows combined spend in the default color without a breakdown tooltip', () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <StatsRow
          calls={2}
          tokens={1_000}
          cost={0.05}
          inferenceReferenceCost={0.31}
        />
      </TooltipProvider>,
    )

    expect(markup).toContain('$0.3600')
    expect(markup).not.toContain('text-violet')
    expect(markup).not.toContain('data-inference-reference-cost')
    expect(markup).not.toContain('API equivalent')
    expect(markup).not.toContain('Pulpo usage')
  })
})
