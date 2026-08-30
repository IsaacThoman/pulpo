import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from './Markdown'

describe('Markdown responsive containment', () => {
  it('renders currency signs as prose instead of pairing them as inline math', () => {
    const markup = renderToStaticMarkup(
      <Markdown content={'Click the **$** dropdown, or choose Accounting if you want the $ aligned. A bare $100 is also currency.'} />,
    )

    expect(markup).toContain('<strong class="font-semibold">$</strong>')
    expect(markup).toContain('the $ aligned')
    expect(markup).toContain('bare $100')
    expect(markup).not.toContain('class="katex"')
  })

  it('still renders explicit inline and display math delimiters', () => {
    const markup = renderToStaticMarkup(
      <Markdown content={String.raw`Inline \(E=mc^2\) and display \[x^2 + y^2\]`} />,
    )

    expect(markup.match(/class="katex"/g)).toHaveLength(2)
    expect(markup).toContain('katex-display')
  })

  it.each(['# Heading', '## Heading', '### Heading'])('removes top spacing from an initial heading: %s', (content) => {
    const markup = renderToStaticMarkup(<Markdown content={content} />)

    expect(markup).toContain('first:mt-0')
  })

  it('allows prose and inline code to break without widening the chat column', () => {
    const markup = renderToStaticMarkup(
      <Markdown content={'https://example.com/an-unbroken-path-without-natural-breaks `anUnbrokenInlineCodeValue`'} />,
    )

    expect(markup).toContain('markdown-content')
    expect(markup).toContain('[overflow-wrap:anywhere]')
  })

  it('keeps wide code and tables inside local overflow containers', () => {
    const markup = renderToStaticMarkup(
      <Markdown content={'```js\nconst unbrokenValue = "abcdefghijklmnopqrstuvwxyz0123456789"\n```\n\n| heading |\n| --- |\n| abcdefghijklmnopqrstuvwxyz0123456789 |'} />,
    )

    expect(markup).toContain('group/code my-3 min-w-0 max-w-full overflow-hidden')
    expect(markup).toContain('max-w-full overflow-x-auto')
    expect(markup).toContain('my-3 max-w-full overflow-x-auto')
    expect(markup).not.toContain('<pre><div')
  })
})
