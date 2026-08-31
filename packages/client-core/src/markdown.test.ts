import { describe, expect, it } from 'vitest'
import { normalizeMathDelimiters } from './markdown.js'

describe('normalizeMathDelimiters', () => {
  it('preserves paired single-dollar inline math', () => {
    const markdown = String.raw`$F_{AB} = -A_x = 199$ lb; $100.5\sqrt{2} \approx 142.1$ lb; and $x$.`

    expect(normalizeMathDelimiters(markdown)).toBe(markdown)
  })

  it('escapes currency amounts and standalone dollar signs', () => {
    const markdown = 'Costs $5 today, $19.99/month, $1,200 total, or $5–$10. Click the **$** dropdown.'

    expect(normalizeMathDelimiters(markdown))
      .toBe('Costs \\$5 today, \\$19.99/month, \\$1,200 total, or \\$5–\\$10. Click the **\\$** dropdown.')
  })

  it('treats a dollar-delimited number as math but a bare amount as currency', () => {
    expect(normalizeMathDelimiters('$100$ and $100')).toBe('$100$ and \\$100')
  })

  it('normalizes explicit inline and multiline display delimiters', () => {
    const markdown = String.raw`Inline \(E=mc^2\).

\[
\frac{a}{b}
+ c
\]`

    expect(normalizeMathDelimiters(markdown)).toBe(String.raw`Inline $E=mc^2$.


$$\frac{a}{b} + c$$
`)
  })

  it('formats display math as multiline delimiters when requested by the renderer', () => {
    expect(normalizeMathDelimiters(String.raw`\[x^2 + y^2\]`, { displayMathStyle: 'multiline' }))
      .toBe('\n$$\nx^2 + y^2\n$$\n')
  })

  it('does not rewrite delimiters inside inline or fenced code', () => {
    const inlineCode = '`' + String.raw`$5 and \(code\)` + '`'
    const fencedCode = ['```tex', String.raw`$F_x$`, String.raw`\[block\]`, '```'].join('\n')
    const markdown = `Use $x$, not ${inlineCode}.\n\n${fencedCode}`

    const normalized = normalizeMathDelimiters(markdown)
    expect(normalized).toContain('$x$')
    expect(normalized).toContain(inlineCode)
    expect(normalized).toContain(String.raw`$F_x$
\[block\]`)
  })
})
