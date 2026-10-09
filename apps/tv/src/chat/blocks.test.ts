import { describe, expect, it } from 'vitest'
import { inlineText, pageBlocks, parseMarkdown, type Block } from './blocks'

describe('parseMarkdown', () => {
  it('parses common reply structure', () => {
    const blocks = parseMarkdown('# Title\n\nSome **bold** and `code`.\n\n- one\n  - nested\n2. ordered\n\n```js\nconst x = 1\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> quoted\n\n---')
    expect(blocks.map((block) => block.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'code', 'table', 'quote', 'rule'])
    const paragraph = blocks[1] as Extract<Block, { type: 'paragraph' }>
    expect(paragraph.inline).toEqual([
      { type: 'text', text: 'Some ' },
      { type: 'strong', children: [{ type: 'text', text: 'bold' }] },
      { type: 'text', text: ' and ' },
      { type: 'code', text: 'code' },
      { type: 'text', text: '.' },
    ])
    const list = blocks[2] as Extract<Block, { type: 'list' }>
    expect(list.items.map((item) => [item.marker, item.depth, inlineText(item.inline)])).toEqual([['•', 0, 'one'], ['•', 1, 'nested']])
    expect((blocks[3] as Extract<Block, { type: 'list' }>).items[0]!.marker).toBe('2.')
    expect(blocks[4]).toEqual({ type: 'code', lang: 'js', text: 'const x = 1' })
  })

  it('decodes entities and keeps math readable', () => {
    const [paragraph] = parseMarkdown('Tom &amp; Jerry: $x^2$ costs \\$5') as [Extract<Block, { type: 'paragraph' }>]
    expect(inlineText(paragraph.inline)).toBe('Tom & Jerry: x^2 costs $5')
    expect(paragraph.inline).toContainEqual({ type: 'code', text: 'x^2' })
    expect(parseMarkdown('$$\na+b\n$$')).toEqual([{ type: 'math', text: 'a+b' }])
  })

  it('never fetches images', () => {
    const [paragraph] = parseMarkdown('![x](https://attacker.test/?d=1)') as [Extract<Block, { type: 'paragraph' }>]
    expect(JSON.stringify(paragraph)).not.toContain('image')
    expect(inlineText(paragraph.inline)).toContain('🖼')
  })

  it('handles half-streamed and hostile input', () => {
    expect(parseMarkdown('```py\nprint(')).toEqual([{ type: 'code', lang: 'py', text: 'print(' }])
    expect(parseMarkdown('**unfinished')[0]!.type).toBe('paragraph')
    expect(() => parseMarkdown('>'.repeat(5_000) + ' deep')).not.toThrow()
    expect(() => parseMarkdown('*'.repeat(5_000))).not.toThrow()
    expect(parseMarkdown('')).toEqual([])
  })
})

describe('pageBlocks', () => {
  const paragraph = (length: number): Block => ({ type: 'paragraph', inline: [{ type: 'text', text: 'x'.repeat(length) }] })

  it('merges short blocks and splits long replies into screen-sized pages', () => {
    expect(pageBlocks([paragraph(100), paragraph(100), paragraph(100)])).toHaveLength(1)
    expect(pageBlocks([paragraph(500), paragraph(500), paragraph(500)])).toHaveLength(3)
  })

  it('keeps a heading with the block that follows it', () => {
    const heading: Block = { type: 'heading', depth: 2, inline: [{ type: 'text', text: 'Section' }] }
    const pages = pageBlocks([paragraph(650), heading, paragraph(600)])
    expect(pages).toHaveLength(2)
    expect(pages[1]!.map((block) => block.type)).toEqual(['heading', 'paragraph'])
  })

  it('splits long lists into chunks', () => {
    const items = Array.from({ length: 20 }, (_, index) => ({ marker: '•', depth: 0, inline: [{ type: 'text' as const, text: `item ${index} `.repeat(8) }] }))
    const pages = pageBlocks([{ type: 'list', items }])
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.flat().flatMap((block) => block.type === 'list' ? block.items : [])).toHaveLength(20)
  })
})
