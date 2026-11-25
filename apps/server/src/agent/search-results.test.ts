import { describe, expect, it } from 'vitest'
import { normalizeResult, resultSnippet } from './search-results.js'

describe('search result excerpts', () => {
  it('extracts a short paragraph from a scraped Markdown profile', () => {
    const source = [
      '- [Overview](https://github.com/example)',
      '- [Repositories](https://github.com/example?tab=repositories)',
      '- [Stars](https://github.com/example?tab=stars)',
      '',
      '# Example Developer',
      '[Follow](https://github.com/login) | [Sponsor](https://github.com/sponsors/example)',
      '',
      'Builds **accessible interfaces** with [React](https://react.dev/) &amp; TypeScript.',
      '![Public sponsor badge](https://github.com/badge.png)',
      '## Achievements',
      '[![Pull Shark](https://github.com/badge.png)](https://github.com/example?tab=achievements)',
    ].join('\n')

    expect(normalizeResult({ url: 'https://github.com/example', title: 'Example Developer', snippet: source }))
      .toMatchObject({ snippet: 'Builds accessible interfaces with React & TypeScript.' })
  })

  it('drops flattened navigation before a Markdown heading', () => {
    const snippet = resultSnippet('- [Overview](https://example.com) - [Projects](https://example.com/projects) # Maintainer of a small open source search engine.')
    expect(snippet).toBe('Maintainer of a small open source search engine.')
  })

  it('keeps readable HTML text and removes styles and scripts', () => {
    expect(resultSnippet('<p>Server-side <b>rendering</b> &amp; caching</p><p>Learn more.</p><script>tracking()</script>'))
      .toBe('Server-side rendering & caching Learn more.')
  })

  it('bounds long snippets without cutting a word or splitting an emoji', () => {
    expect(resultSnippet('Some helpful detail about search engines. More useful information.', 30))
      .toBe('Some helpful detail about…')
    expect(resultSnippet('abc📷def', 5)).toBe('abc…')
  })
})
