import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from './Markdown'

describe('Markdown responsive containment', () => {
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
