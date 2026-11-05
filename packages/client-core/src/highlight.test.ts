import { describe, expect, it } from 'vitest'
import {
  findInLines,
  highlightCss,
  highlightedHtml,
  highlightHtml,
  highlightRuns,
  highlightTokenOf,
  highlightTree,
  limitLines,
  lineText,
  markLineRanges,
  normalizeLanguage,
  splitHighlightedLines,
} from './highlight.js'

describe('highlightTree', () => {
  it('highlights known grammars and aliases, and refuses plain text and oversized input', () => {
    expect(highlightTree('const a = 1', 'javascript')).not.toBeNull()
    expect(normalizeLanguage('python3')).toBe('python')
    expect(normalizeLanguage('golang')).toBe('go')
    expect(normalizeLanguage('txt')).toBeNull()
    expect(highlightTree('x', null)).toBeNull()
    expect(highlightTree('a'.repeat(200), 'javascript', 100)).toBeNull()
  })
})

describe('splitHighlightedLines', () => {
  it('re-opens spans that cross line breaks so every line renders alone', () => {
    const code = 'a = 1\n/* one\ntwo */\nb = "x"'
    const lines = splitHighlightedLines(code, highlightTree(code, 'javascript'))
    expect(lines.map(lineText)).toEqual(['a = 1', '/* one', 'two */', 'b = "x"'])
    // The comment's second line is still inside a comment span.
    expect(highlightedHtml(lines[2]!)).toBe('<span class="hljs-comment">two */</span>')
  })

  it('splits plain text on any line ending and keeps empty lines', () => {
    expect(splitHighlightedLines('a\r\n\nb\rc', null).map(lineText)).toEqual(['a', '', 'b', 'c'])
  })

  it('keeps every character of a large file', () => {
    const code = Array.from({ length: 2_000 }, (_, index) => `const value${index} = "${index}" // line ${index}`).join('\n')
    const lines = splitHighlightedLines(code, highlightTree(code, 'typescript'))
    expect(lines.map(lineText).join('\n')).toBe(code)
  })
})

describe('markLineRanges', () => {
  it('wraps matches, splitting token spans where needed', () => {
    const code = 'const total = 10'
    const [line] = splitHighlightedLines(code, highlightTree(code, 'javascript'))
    const marked = markLineRanges(line!, [{ start: 3, end: 9 }, { start: 14, end: 16, current: true }])
    expect(lineText(marked)).toBe(code)
    expect(highlightedHtml(marked)).toBe('<span class="hljs-keyword">con<mark class="find-match">st</mark></span><mark class="find-match"> tot</mark>al = <span class="hljs-number"><mark class="find-match find-match-current">10</mark></span>')
  })
})

describe('HTML output', () => {
  it('escapes code and keeps only class names', () => {
    expect(highlightHtml('<b onclick="x">', null)).toBe('&lt;b onclick=&quot;x&quot;&gt;')
    expect(highlightHtml('x = "<i>"', 'python')).toContain('&lt;i&gt;')
  })

  it('maps hljs classes to theme tokens and CSS', () => {
    expect(highlightTokenOf(['hljs-title', 'function_'])).toBe('title')
    expect(highlightTokenOf(['hljs-unknown'])).toBeNull()
    expect(highlightCss('.x', 'dark')).toContain('.x .hljs-keyword')
    expect(highlightCss('.x', 'dark')).toContain('#ff7b72')
  })
})

describe('highlightRuns', () => {
  it('flattens a line into colored runs with find matches', () => {
    const code = 'return "hi" // done'
    const [line] = splitHighlightedLines(code, highlightTree(code, 'javascript'))
    const runs = highlightRuns(line!, [{ start: 8, end: 10, current: true }])
    expect(runs.map((run) => run.text).join('')).toBe(code)
    expect(runs[0]).toEqual({ text: 'return', token: 'keyword' })
    expect(runs.find((run) => run.match)).toEqual({ text: 'hi', token: 'string', match: 'current' })
    expect(runs[runs.length - 1]).toEqual({ text: '// done', token: 'comment' })
  })
})

describe('findInLines', () => {
  it('finds every case-insensitive match, up to a limit', () => {
    expect(findInLines(['Aa aA', 'b', 'xaa'], 'aa')).toEqual([{ line: 0, start: 0, end: 2 }, { line: 0, start: 3, end: 5 }, { line: 2, start: 1, end: 3 }])
    expect(findInLines(['aaaa'], 'aa')).toHaveLength(2)
    expect(findInLines(['aaaa'], 'a', 3)).toHaveLength(3)
    expect(findInLines(['x'], '')).toEqual([])
  })

  it('stays case-insensitive on lines whose lower case is longer, with offsets in the original', () => {
    const line = 'İ ERROR: connection refused'
    expect(findInLines([line], 'error')).toEqual([{ line: 0, start: 2, end: 7 }])
    expect(line.slice(2, 7)).toBe('ERROR')
    // A match that includes the expanding character covers all of it.
    expect(findInLines(['xİy'], 'i̇y')).toEqual([{ line: 0, start: 1, end: 3 }])
    // Characters outside the BMP keep their two code units.
    expect(findInLines(['😀İ AB'], 'ab')).toEqual([{ line: 0, start: 4, end: 6 }])
  })
})

describe('limitLines', () => {
  it('keeps the first lines, whatever the line breaks', () => {
    expect(limitLines('a\nb\r\nc\rd', 2)).toEqual({ text: 'a\nb', truncated: true })
    expect(limitLines('a\r\nb\r\nc', 1)).toEqual({ text: 'a', truncated: true })
    expect(limitLines('a\nb', 5)).toEqual({ text: 'a\nb', truncated: false })
  })

  it('does not count a final line break as cutting anything', () => {
    expect(limitLines('a\nb\n', 2)).toEqual({ text: 'a\nb', truncated: false })
    expect(limitLines('a\nb\n\n', 2)).toEqual({ text: 'a\nb', truncated: true })
  })

  it('bounds files of millions of empty lines', () => {
    const { text, truncated } = limitLines('\n'.repeat(5 * 1024 * 1024))
    expect(truncated).toBe(true)
    expect(text.split('\n')).toHaveLength(500_000)
  })
})
