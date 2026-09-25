import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from './Markdown'

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
