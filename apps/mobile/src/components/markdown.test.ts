import { describe, expect, it } from 'vitest'
import { normalizeMathDelimiters } from './markdown'

describe('normalizeMathDelimiters', () => {
  it('normalizes common inline and block LLM math delimiters', () => {
    expect(normalizeMathDelimiters(String.raw`Inline \(E=mc^2\) and \[x^2 + y^2\]`))
      .toBe('Inline $E=mc^2$ and \n$$\nx^2 + y^2\n$$\n')
  })

  it('does not rewrite delimiters inside inline or fenced code', () => {
    const markdown = [
      String.raw`Use \(x\), not ` + '`' + String.raw`\(code\)` + '`' + '.',
      '',
      '```tex',
      String.raw`\[code block\]`,
      '```',
    ].join('\n')
    const normalized = normalizeMathDelimiters(markdown)
    expect(normalized).toContain('$x$')
    expect(normalized).toContain('`' + String.raw`\(code\)` + '`')
    expect(normalized).toContain(String.raw`\[code block\]`)
  })
})
