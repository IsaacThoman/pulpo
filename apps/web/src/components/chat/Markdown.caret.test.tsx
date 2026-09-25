import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from './Markdown'

const CARET = '<span class="stream-caret" aria-hidden="true"></span>'

function caretMarkup(content: string) {
  const markup = renderToStaticMarkup(<Markdown content={content} streaming caret />)
  expect(markup.split(CARET)).toHaveLength(2)
  return markup
}

describe('Markdown streaming caret', () => {
  it('omits the caret unless requested', () => {
    expect(renderToStaticMarkup(<Markdown content="Done" streaming />)).not.toContain('stream-caret')
  })

  it('follows paragraph text', () => {
    expect(caretMarkup('Streaming a sentence')).toContain(`Streaming a sentence${CARET}</p>`)
  })

  it('follows the last list item text instead of starting a new line', () => {
    expect(caretMarkup('Steps:\n\n- First\n- Second in progr')).toContain(`Second in progr${CARET}</li>`)
  })

  it('follows text in nested and loose lists', () => {
    expect(caretMarkup('- Outer\n  - Inner item')).toContain(`Inner item${CARET}</li>`)
    expect(caretMarkup('- First\n\n- Second para')).toContain(`Second para${CARET}</p>`)
  })

  it('follows the last typed table cell, skipping padded empty cells', () => {
    const markup = caretMarkup('| Name | Value |\n| --- | --- |\n| alpha | 12 |\n| beta')
    expect(markup).toContain(`beta${CARET}</td>`)
  })

  it('follows blockquote and emphasized text', () => {
    expect(caretMarkup('> A quoted line')).toContain(`A quoted line${CARET}</p>`)
    expect(caretMarkup('Some **bold text')).toContain(`Some **bold text${CARET}</p>`)
    expect(caretMarkup('Some **bold** text and **more**')).toContain(`more${CARET}</strong>`)
  })

  it('sits after links and inline code rather than inside them', () => {
    expect(caretMarkup('See [docs](https://example.com)')).toContain(`</a>${CARET}</p>`)
    expect(caretMarkup('Run `npm test`')).toContain(`</code>${CARET}</p>`)
  })

  it('draws the caret inside fenced code at the end of the code', () => {
    const markup = caretMarkup('```js\nconst x = 1\n')
    expect(markup).toMatch(new RegExp(`${CARET}</code></pre>`))
  })

  it('stays after text that precedes hoisted footnote definitions', () => {
    const markup = caretMarkup('Claim[^1]\n\n[^1]: Source\n\nStill writ')
    expect(markup).toContain(`Still writ${CARET}</p>`)
  })
})
