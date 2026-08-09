import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ScrollArea } from './scroll-area'

describe('ScrollArea responsive containment', () => {
  it('uses a block formatting context for the Radix viewport wrapper', () => {
    const markup = renderToStaticMarkup(
      <ScrollArea><div>content</div></ScrollArea>,
    )

    expect(markup).toContain('data-slot="scroll-area-viewport"')
    expect(markup).toContain('[&amp;&gt;div]:!block')
  })
})
