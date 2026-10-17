import { describe, expect, it } from 'vitest'
import type { SuggestionHunk } from '../doc-schema/index.js'
import { adjacentHunk, describeHunkSummary, hunkAt, summarizeHunk } from './review.js'

function hunk(id: string, from: number, to: number): SuggestionHunk {
  return { id, changeId: 'change', inserted: '', deleted: '', from, to }
}

const hunks = [hunk('a', 5, 9), hunk('b', 20, 30), hunk('c', 40, 41)]

describe('summarizeHunk', () => {
  it('says what a hunk replaces, adds, or deletes', () => {
    expect(summarizeHunk({ deleted: 'foo', inserted: 'bar' })).toEqual({ kind: 'replace', deleted: 'foo', inserted: 'bar' })
    expect(summarizeHunk({ deleted: '', inserted: 'a new\n\nparagraph' })).toEqual({ kind: 'add', inserted: 'a new paragraph' })
    expect(summarizeHunk({ deleted: 'old words ', inserted: '' })).toEqual({ kind: 'delete', deleted: 'old words' })
    expect(summarizeHunk({ deleted: '', inserted: ' ' })).toEqual({ kind: 'add-whitespace' })
    expect(summarizeHunk({ deleted: '\n', inserted: '' })).toEqual({ kind: 'delete-whitespace' })
    expect(summarizeHunk({ deleted: '', inserted: '' })).toEqual({ kind: 'layout' })
  })

  it('shortens long text and words it in English', () => {
    const text = 'word '.repeat(30)
    expect(describeHunkSummary(summarizeHunk({ deleted: '', inserted: text }))).toBe(`Add “${text.trim().slice(0, 47)}…”`)
    expect(describeHunkSummary(summarizeHunk({ deleted: 'foo', inserted: 'bar' }))).toBe('Replace “foo” with “bar”')
  })
})

describe('moving between hunks', () => {
  it('finds the hunk at or touching the cursor, preferring the innermost', () => {
    expect(hunkAt(hunks, 5)?.id).toBe('a')
    expect(hunkAt(hunks, 9)?.id).toBe('a')
    expect(hunkAt(hunks, 10)).toBeNull()
    expect(hunkAt([hunk('a', 5, 9), hunk('b', 9, 12)], 9)?.id).toBe('b')
    expect(hunkAt([hunk('block', 10, 40), hunk('word', 11, 16)], 13)?.id).toBe('word')
  })

  it('steps from the active hunk or the cursor, wrapping around', () => {
    expect(adjacentHunk(hunks, 0, 'c', 1)?.id).toBe('a')
    expect(adjacentHunk(hunks, 0, 'a', -1)?.id).toBe('c')
    expect(adjacentHunk(hunks, 12, null, 1)?.id).toBe('b')
    expect(adjacentHunk(hunks, 1, null, -1)?.id).toBe('c')
    expect(adjacentHunk([], 1, null, 1)).toBeNull()
  })
})
