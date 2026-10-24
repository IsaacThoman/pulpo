import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { applyMarkdownToYDoc, ydocToMarkdown } from '@pulpo/client-core/doc-schema'
import { FILE_DOC_MAX_MARKDOWN_LENGTH } from '@pulpo/contracts'

vi.mock('../database/client.js', () => ({ db: {} }))

const { importedDocName, importedMarkdown } = await import('./url-import.js')

describe('URL import naming', () => {
  it('prefers the page title, then its first heading, then its address', () => {
    expect(importedDocName({ title: 'Release notes', output: '# Other', sourceUrl: 'https://example.com/a' })).toBe('Release notes.md')
    expect(importedDocName({ output: 'Intro\n\n## The **real** [title](https://x.test)\n', sourceUrl: 'https://example.com/a' })).toBe('The real title.md')
    expect(importedDocName({ output: 'No heading', sourceUrl: 'https://example.com/blog/my-first_post.html' })).toBe('my first post.md')
    expect(importedDocName({ output: 'No heading', sourceUrl: 'https://example.com/' })).toBe('example.com.md')
  })

  it('makes names the Files tree accepts', () => {
    expect(importedDocName({ title: 'A/B \u0007 test', output: '', sourceUrl: 'https://example.com' })).toBe('A B test.md')
    const long = importedDocName({ title: 'x'.repeat(400), output: '', sourceUrl: 'https://example.com' })
    expect([...long]).toHaveLength(255)
    expect(long.endsWith('.md')).toBe(true)
    expect(importedDocName({ title: '..', output: '', sourceUrl: 'https://example.com/%E0%A4%A' })).toBe('%E0%A4%A.md')
  })
})

describe('URL import Markdown', () => {
  it('links the source above the page and keeps it through the editor schema', () => {
    const markdown = importedMarkdown({ output: '\n# Title\n\nBody text.\n', sourceUrl: 'https://example.com/page?q=1' })
    expect(markdown).toBe('Source: <https://example.com/page?q=1>\n\n# Title\n\nBody text.')
    const doc = new Y.Doc()
    applyMarkdownToYDoc(doc, markdown, 'import')
    const saved = ydocToMarkdown(doc)
    expect(saved).toContain('Source: [https://example.com/page?q=1](https://example.com/page?q=1)')
    expect(saved).toContain('# Title')
  })

  it('cuts a page that would not fit in a document and says so', () => {
    const markdown = importedMarkdown({ output: `${'a'.repeat(FILE_DOC_MAX_MARKDOWN_LENGTH - 1)}😀`, sourceUrl: 'https://example.com' })
    expect(markdown.length).toBeLessThanOrEqual(FILE_DOC_MAX_MARKDOWN_LENGTH)
    expect(markdown.endsWith('*The rest of this page was too long to import.*')).toBe(true)
    expect(markdown).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })
})
