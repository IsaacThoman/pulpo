import { describe, expect, it } from 'vitest'
import { normalizeResult, redditThreadTitle, resultSnippet } from './search-results.js'

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

  it('keeps useful code text while removing fenced markup and pilcrow permalink markers', () => {
    expect(resultSnippet('Data classes&#182;\n```python\nfrom dataclasses import dataclass\n```\nExample: ``` run() ```')).toBe(
      'Data classes from dataclasses import dataclass Example: run()',
    )
  })

  it('bounds long snippets without cutting a word or splitting an emoji', () => {
    expect(resultSnippet('Some helpful detail about search engines. More useful information.', 30))
      .toBe('Some helpful detail about…')
    expect(resultSnippet('abc📷def', 5)).toBe('abc…')
  })

  it('chooses a bounded provider excerpt with the most requested details', () => {
    const intro = 'The reference describes methods for working with files and directories. '.repeat(6)
    const example = 'Path.walk() can follow directory links if follow_symlinks is enabled.'
    const snippet = resultSnippet(intro + example, 180, 'site:docs.python.org pathlib Path.walk follow_symlinks')
    expect(snippet).toContain(example)
    expect(snippet).toMatch(/^… /)
    expect(snippet.length).toBeLessThanOrEqual(180)
    expect(resultSnippet(intro + example, 180, 'unrelated topic')).toBe(resultSnippet(intro + example, 180))
  })

  it('reads a table flattened onto one line as rows of cells', () => {
    const snippet = 'Cursor has two classes of plans: Individual and Business plans. | Plan Name | Price per month | Included Usage | |-|-|-|-| '
      + '| Pro | $20 | $20 in API agent usage, unlimited Tab completions | | Pro+ | $60 | ~$70 in API agent usage (3x Pro),...'
    expect(resultSnippet(snippet, 245, 'cursor plans included models')).toBe(
      'Cursor has two classes of plans: Individual and Business plans. Plan Name, Price per month, Included Usage ; '
      + 'Pro, $20, $20 in API agent usage, unlimited Tab completions ; Pro+, $60, ~$70 in API agent usage (3x Pro)…',
    )
  })

  it('drops symbol-only cells from a flattened comparison table', () => {
    const snippet = '... Contact Sales | |-|-|-|-|-|-|-|-| | Third-party models at API list price | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | '
      + '| Image generation (Imagine) | Limited | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | Grok Build | Limited | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | Write Articles | — | ✓...'
    expect(resultSnippet(snippet, 245, 'cursor plans included models')).toBe(
      '… Contact Sales ; Third-party models at API list price ; Image generation (Imagine), Limited ; Grok Build, Limited ; Write Articles',
    )
  })

  it('reads a multi-line Markdown table between paragraphs', () => {
    const snippet = 'Compare plans.\n\n| Plan | Price | Agent |\n|:---|---:|:-:|\n| Hobby | Free | ✗ |\n| Pro | **$20**/mo | ✓ |\n| Teams | | x |\n\nBilled yearly'
    expect(resultSnippet(snippet)).toBe('Compare plans. Plan, Price, Agent ; Hobby, Free ; Pro, $20/mo ; Teams ; Billed yearly')
  })

  it('leaves prose separators alone', () => {
    expect(resultSnippet('Docs | Pulpo is a chat app with 1 - 2 second replies.')).toBe('Docs | Pulpo is a chat app with 1 - 2 second replies.')
    expect(resultSnippet('Use `a || b` to pick a fallback.')).toBe('Use a || b to pick a fallback.')
  })

  it('titles a Reddit thread from its URL when providers only give the subreddit', () => {
    const url = 'https://www.reddit.com/r/cursor/comments/1abc2de/thirdparty_models_are_no_longer_included_in_any/'
    expect(normalizeResult({ url, title: 'r/cursor', snippet: 'Thread' })?.title).toBe('Thirdparty models are no longer included in any : r/cursor')
    expect(redditThreadTitle('r/cursor', 'https://www.reddit.com/r/cursor/')).toBe('r/cursor')
    expect(redditThreadTitle('r/cursor', 'https://www.reddit.com/r/other/comments/1abc2de/slug/')).toBe('r/cursor')
    expect(redditThreadTitle('Pricing changes : r/cursor', url)).toBe('Pricing changes : r/cursor')
    expect(redditThreadTitle('r/cursor', 'https://example.com/r/cursor/comments/1abc2de/slug/')).toBe('r/cursor')
  })
})
