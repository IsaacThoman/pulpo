import { describe, expect, it } from 'vitest'
import type { SuggestionHunk } from '@pulpo/client-core/doc-schema'
import { adjacentHunk, describeHunk, hunkAt } from './suggestion-review'

function hunk(id: string, from: number, to: number): SuggestionHunk {
  return { id, changeId: 'change', inserted: '', deleted: '', from, to }
}

const hunks = [hunk('a', 5, 9), hunk('b', 20, 30), hunk('c', 40, 41)]

describe('describeHunk', () => {
  it('says what a hunk replaces, adds, or deletes', () => {
    expect(describeHunk({ deleted: 'foo', inserted: 'bar' })).toBe('Replace “foo” with “bar”')
    expect(describeHunk({ deleted: '', inserted: 'a new\n\nparagraph' })).toBe('Add “a new paragraph”')
    expect(describeHunk({ deleted: 'old words ', inserted: '' })).toBe('Delete “old words”')
    expect(describeHunk({ deleted: '', inserted: ' ' })).toBe('Add a space or line break')
    expect(describeHunk({ deleted: '', inserted: '' })).toBe('Change the layout')
  })

  it('shortens long text', () => {
    const text = 'word '.repeat(30)
    expect(describeHunk({ deleted: '', inserted: text })).toBe(`Add “${text.trim().slice(0, 47)}…”`)
  })
})

describe('moving between hunks', () => {
  it('finds the hunk at or touching the cursor', () => {
    expect(hunkAt(hunks, 5)?.id).toBe('a')
    expect(hunkAt(hunks, 9)?.id).toBe('a')
    expect(hunkAt(hunks, 10)).toBeNull()
    expect(hunkAt([hunk('a', 5, 9), hunk('b', 9, 12)], 9)?.id).toBe('b')
  })

  it('steps from the active hunk, wrapping around', () => {
    expect(adjacentHunk(hunks, 0, 'a', 1)?.id).toBe('b')
    expect(adjacentHunk(hunks, 0, 'c', 1)?.id).toBe('a')
    expect(adjacentHunk(hunks, 0, 'a', -1)?.id).toBe('c')
  })

  it('steps from the cursor when no hunk is active', () => {
    expect(adjacentHunk(hunks, 12, null, 1)?.id).toBe('b')
    expect(adjacentHunk(hunks, 12, null, -1)?.id).toBe('a')
    expect(adjacentHunk(hunks, 50, null, 1)?.id).toBe('a')
    expect(adjacentHunk(hunks, 1, null, -1)?.id).toBe('c')
    expect(adjacentHunk([], 1, null, 1)).toBeNull()
  })
})
