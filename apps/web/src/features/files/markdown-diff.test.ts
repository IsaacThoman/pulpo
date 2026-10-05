import { describe, expect, it } from 'vitest'
import { diffRows, lineDiff } from './markdown-diff'

describe('Markdown conversion diff', () => {
  it('marks removed and added lines around unchanged ones', () => {
    const diff = lineDiff('# Title\n<div>x</div>\n* one\nend', '# Title\n- one\nend')!
    expect(diff.map((line) => `${line.kind[0]} ${line.text}`)).toEqual([
      's # Title', 'r <div>x</div>', 'r * one', 'a - one', 's end',
    ])
  })

  it('ignores line endings and trailing whitespace', () => {
    expect(lineDiff('a  \r\nb\r\n', 'a\nb')!.every((line) => line.kind === 'same')).toBe(true)
  })

  it('folds long unchanged runs into gaps with context', () => {
    const before = Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n')
    const after = before.replace('line 10', 'LINE 10')
    const rows = diffRows(lineDiff(before, after)!, 1)
    expect(rows[0]).toEqual({ kind: 'gap', count: 9 })
    expect(rows.filter((row) => row.kind !== 'gap').map((row) => 'text' in row && row.text)).toEqual(['line 9', 'line 10', 'LINE 10', 'line 11'])
    expect(rows.at(-1)).toEqual({ kind: 'gap', count: 8 })
  })
})
