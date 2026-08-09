import { describe, expect, it } from 'vitest'
import { normalizeMathDelimiters } from './markdown'

describe('normalizeMathDelimiters', () => {
  it('normalizes common inline and block LLM math delimiters', () => {
    expect(normalizeMathDelimiters(String.raw`Inline \(E=mc^2\) and \[x^2 + y^2\]`))
      .toBe('Inline $E=mc^2$ and \n$$x^2 + y^2$$\n')
  })

  it('puts multiline display math on one native-compatible line', () => {
    const markdown = String.raw`For a single decoding step, attention is effectively:

\[
\text{Attention}(Q_t, K_{1:t}, V_{1:t})
= \text{softmax}\!\left(\frac{Q_t K_{1:t}^{T}}{\sqrt{d}}\right)V_{1:t}
\]

Only the new token passes through the network.`

    expect(normalizeMathDelimiters(markdown)).toBe(String.raw`For a single decoding step, attention is effectively:


$$\text{Attention}(Q_t, K_{1:t}, V_{1:t}) = \text{softmax}\!\left(\frac{Q_t K_{1:t}^{T}}{\sqrt{d}}\right)V_{1:t}$$


Only the new token passes through the network.`)
  })

  it('canonicalizes multiline dollar-delimited display math', () => {
    const markdown = String.raw`Before.

$$
\frac{a}{b}
+ c
$$

After.`

    expect(normalizeMathDelimiters(markdown)).toBe(String.raw`Before.

$$\frac{a}{b} + c$$

After.`)
  })

  it('flattens physical lines without removing LaTeX line-break commands', () => {
    const markdown = String.raw`\[
\begin{aligned}
a &= b \\
c &= d
\end{aligned}
\]`

    expect(normalizeMathDelimiters(markdown))
      .toBe(String.raw`
$$\begin{aligned} a &= b \\ c &= d \end{aligned}$$
`)
  })

  it('does not rewrite delimiters inside inline or fenced code', () => {
    const markdown = [
      String.raw`Use \(x\), not ` + '`' + String.raw`\(code\) and $$code$$` + '`' + '.',
      '',
      '```tex',
      String.raw`\[code block\]`,
      '$$',
      String.raw`x_1`,
      '$$',
      '```',
    ].join('\n')
    const normalized = normalizeMathDelimiters(markdown)
    expect(normalized).toContain('$x$')
    expect(normalized).toContain('`' + String.raw`\(code\) and $$code$$` + '`')
    expect(normalized).toContain(String.raw`\[code block\]`)
    expect(normalized).toContain('$$\n' + String.raw`x_1` + '\n$$')
  })
})
