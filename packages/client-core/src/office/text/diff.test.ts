import { describe, expect, it } from 'vitest'
import { applyTextEdits, textEdits } from './diff.js'

function random(seed: number) {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

describe('textEdits', () => {
  it('returns nothing for equal texts', () => {
    expect(textEdits('a\nb\n', 'a\nb\n')).toEqual([])
  })

  it('narrows a one-character change to that character', () => {
    expect(textEdits('const a = 1\nconst b = 2\n', 'const a = 1\nconst b = 3\n')).toEqual([{ from: 22, to: 23, insert: '3' }])
  })

  it('keeps unchanged lines between two distant edits', () => {
    const before = Array.from({ length: 200 }, (_, index) => `line ${index}`).join('\n')
    const lines = before.split('\n')
    lines[3] = 'changed near the top'
    lines[190] = 'changed near the end'
    const after = lines.join('\n')
    const edits = textEdits(before, after)
    expect(edits).toHaveLength(2)
    expect(edits.every((edit) => edit.to - edit.from < 20)).toBe(true)
    expect(applyTextEdits(before, edits)).toBe(after)
  })

  it('finds inserted and removed lines', () => {
    const before = 'a\nb\nc\nd\n'
    const after = 'a\nx\nb\nd\ny\n'
    const edits = textEdits(before, after)
    expect(applyTextEdits(before, edits)).toBe(after)
    expect(edits.map((edit) => edit.insert)).toEqual(['x\n', '', 'y\n'])
  })

  it('handles texts without a final newline and empty texts', () => {
    for (const [before, after] of [['', 'abc'], ['abc', ''], ['a\nb', 'a\nb\n'], ['a\nb\n', 'a\nb'], ['x', 'y']]) {
      expect(applyTextEdits(before!, textEdits(before!, after!))).toBe(after)
    }
  })

  it('never splits a surrogate pair', () => {
    const edits = textEdits('😀', '😃')
    expect(edits).toEqual([{ from: 0, to: 2, insert: '😃' }])
  })

  it('replaces runs with nothing in common whole past the distance limit', () => {
    const before = Array.from({ length: 50 }, (_, index) => `old ${index}`).join('\n')
    const after = Array.from({ length: 50 }, (_, index) => `new ${index}`).join('\n')
    const edits = textEdits(before, after, 10)
    expect(applyTextEdits(before, edits)).toBe(after)
  })

  it('keeps every unchanged line of a file changed all over (past the distance limit)', () => {
    const lines = Array.from({ length: 6_000 }, (_, index) => `line ${index}`)
    const before = lines.join('\n')
    const after = lines.map((line, index) => index % 2 ? `${line} // agent` : line).join('\n')
    const edits = textEdits(before, after, 100)
    expect(applyTextEdits(before, edits)).toBe(after)
    // Each edit appends to one changed line; none spans an unchanged line.
    expect(edits).toHaveLength(3_000)
    expect(edits.every((edit) => edit.to === edit.from && edit.insert === ' // agent')).toBe(true)
  })

  it('keeps unchanged lines between repeated ones past the distance limit (fuzz)', () => {
    const next = random(9)
    for (let round = 0; round < 60; round += 1) {
      const before = Array.from({ length: 300 }, () => ['x', 'y', `u${Math.floor(next() * 1e6)}`][Math.floor(next() * 3)]).join('\n')
      const after = before.split('\n').map((line) => next() < 0.3 ? `${line}!` : line).join('\n')
      expect(applyTextEdits(before, textEdits(before, after, 5))).toBe(after)
    }
  })

  it('round-trips random edits (fuzz)', () => {
    const next = random(42)
    const alphabet = ['a', 'b', 'c', '\n', ' ', 'é', '😀', '\t']
    for (let round = 0; round < 400; round += 1) {
      const length = Math.floor(next() * 200)
      const before = Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join('')
      let after = before
      const changes = Math.floor(next() * 5)
      for (let change = 0; change < changes; change += 1) {
        const at = Math.floor(next() * (after.length + 1))
        const removed = Math.floor(next() * 10)
        const inserted = Array.from({ length: Math.floor(next() * 10) }, () => alphabet[Math.floor(next() * alphabet.length)]).join('')
        after = after.slice(0, at) + inserted + after.slice(at + removed)
      }
      const edits = textEdits(before, after)
      expect(applyTextEdits(before, edits)).toBe(after)
      for (let index = 1; index < edits.length; index += 1) expect(edits[index]!.from).toBeGreaterThanOrEqual(edits[index - 1]!.to)
    }
  })

  it('diffs a large file with few changes quickly', () => {
    const lines = Array.from({ length: 100_000 }, (_, index) => `const value${index} = ${index}`)
    const before = lines.join('\n')
    lines[10] = 'first'
    lines.splice(50_000, 0, 'inserted')
    lines[99_000] = 'last'
    const after = lines.join('\n')
    const started = performance.now()
    const edits = textEdits(before, after)
    expect(performance.now() - started).toBeLessThan(2_000)
    expect(edits).toHaveLength(3)
    expect(applyTextEdits(before, edits)).toBe(after)
  })
})
