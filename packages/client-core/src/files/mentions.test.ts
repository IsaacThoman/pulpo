import { MAX_MESSAGE_FILE_REFERENCES } from '@pulpo/contracts'
import { describe, expect, it } from 'vitest'
import { activeFileMention, applyFileMention, fileMentionKey, fileMentionRequestLimit, fileMentionSuggestions } from './mentions.js'
import { composerMessageText, composerReferences, withComposerReferences } from './references.js'

const plan = { id: '0b5c5d0e-2b7f-4c3e-9a51-6f1d2c3b4a59', name: 'Plan.md', folder: false }

/** The token at the caret marked `|` in `marked`. */
function at(marked: string) {
  const caret = marked.indexOf('|')
  return activeFileMention(marked.replace('|', ''), caret)
}

describe('activeFileMention', () => {
  it('starts at the start of the text, after a space, and after a newline', () => {
    expect(at('@|')).toEqual({ start: 0, end: 1, query: '' })
    expect(at('@pla|')).toEqual({ start: 0, end: 4, query: 'pla' })
    expect(at('summarize @pla|')).toEqual({ start: 10, end: 14, query: 'pla' })
    expect(at('first line\n@notes|')).toEqual({ start: 11, end: 17, query: 'notes' })
    expect(at('tab\t@x|')).toEqual({ start: 4, end: 6, query: 'x' })
  })

  it('ignores an @ inside a word, such as an email address', () => {
    expect(at('a@b|')).toBeNull()
    expect(at('write to a@b.com|')).toBeNull()
    expect(at('(@plan|')).toBeNull()
    expect(at('a@b @c|')).toEqual({ start: 4, end: 6, query: 'c' })
  })

  it('ends at whitespace, so the caret past it leaves the token', () => {
    expect(at('@plan |')).toBeNull()
    expect(at('@plan x|')).toBeNull()
    expect(at('@plan\n|')).toBeNull()
    expect(at('no mention|')).toBeNull()
    expect(at('|')).toBeNull()
  })

  it('takes the query up to the caret and the token to its end', () => {
    expect(at('see @pla|nning today')).toEqual({ start: 4, end: 13, query: 'pla' })
    expect(at('see @|planning')).toEqual({ start: 4, end: 13, query: '' })
    // Just before the @ is not inside the token.
    expect(at('see |@planning')).toBeNull()
  })

  it('handles emoji and other Unicode', () => {
    expect(at('ver @🎉fiesta|')).toEqual({ start: 4, end: 13, query: '🎉fiesta' })
    expect(at('résumé @Écol|')).toEqual({ start: 7, end: 12, query: 'Écol' })
    expect(at('🎉 @año|')).toEqual({ start: 3, end: 7, query: 'año' })
    // A non-breaking space is whitespace too.
    expect(at('x @y|')).toEqual({ start: 2, end: 4, query: 'y' })
  })

  it('needs a collapsed selection inside the text', () => {
    expect(activeFileMention('@plan', 3, 5)).toBeNull()
    expect(activeFileMention('@plan', 9)).toBeNull()
    expect(activeFileMention('@plan', -1)).toBeNull()
  })
})

describe('applyFileMention', () => {
  it('replaces the token with the name and a space, caret after it', () => {
    const text = 'summarize @pla'
    expect(applyFileMention(text, activeFileMention(text, text.length)!, 'Plan.md')).toEqual({ text: 'summarize Plan.md ', caret: 18 })
    expect(applyFileMention('@', activeFileMention('@', 1)!, 'Notes')).toEqual({ text: 'Notes ', caret: 6 })
  })

  it('keeps the text after the token, reusing a space that follows it', () => {
    const text = 'compare @pla and the rest'
    const result = applyFileMention(text, activeFileMention(text, 12)!, 'Plan.md')
    expect(result).toEqual({ text: 'compare Plan.md and the rest', caret: 16 })
    expect(result.text.slice(result.caret)).toBe('and the rest')

    // The caret in the middle of a token replaces the whole token.
    const middle = 'see @planning.'
    expect(applyFileMention(middle, activeFileMention(middle, 8)!, 'Plan.md')).toEqual({ text: 'see Plan.md ', caret: 12 })

    const line = 'look at @no\nthen reply'
    expect(applyFileMention(line, activeFileMention(line, 11)!, 'Notes')).toEqual({ text: 'look at Notes\nthen reply', caret: 14 })
  })

  it('inserts names with spaces and Unicode as they are', () => {
    const text = 'open @q'
    expect(applyFileMention(text, activeFileMention(text, 7)!, 'Q3 report 🎉.md')).toEqual({ text: 'open Q3 report 🎉.md ', caret: 21 })
  })

  it('leaves the draft’s references paragraph alone', () => {
    const draft = withComposerReferences('summarize @pla', [plan])
    const { text, references } = composerReferences(draft)
    const applied = applyFileMention(text, activeFileMention(text, text.length)!, 'Notes')
    const work = { id: '1b5c5d0e-2b7f-4c3e-9a51-6f1d2c3b4a59', name: 'Notes', folder: true }
    const next = withComposerReferences(applied.text, [...references, work])
    expect(composerReferences(next)).toEqual({ text: 'summarize Notes ', references: [plan, work] })
    expect(composerMessageText(next)).toBe(`summarize Notes\n\n[Plan.md](/files/d/${plan.id}) [Notes](/files/f/${work.id})`)
  })
})

describe('fileMentionSuggestions', () => {
  const items = Array.from({ length: 12 }, (_, index) => ({ id: `id-${index}`, name: `Item ${index}` }))

  it('leaves out mentioned items and caps the list', () => {
    expect(fileMentionSuggestions(items, [])).toHaveLength(8)
    expect(fileMentionSuggestions(items, [{ id: 'ID-0' }, { id: 'id-2' }], 3).map((item) => item.id)).toEqual(['id-1', 'id-3', 'id-4'])
  })

  it('offers nothing once a message mentions as many items as it can carry', () => {
    const full = Array.from({ length: MAX_MESSAGE_FILE_REFERENCES }, (_, index) => ({ id: `ref-${index}` }))
    expect(fileMentionSuggestions(items, full)).toEqual([])
  })

  it('asks for enough results to fill the list around mentioned items', () => {
    expect(fileMentionRequestLimit([])).toBe(8)
    expect(fileMentionRequestLimit([1, 2])).toBe(10)
    expect(fileMentionRequestLimit(Array(60))).toBe(MAX_MESSAGE_FILE_REFERENCES)
  })

  it('keys a token by where it starts', () => {
    expect(fileMentionKey(at('hi @a|'))).toBe('3')
    expect(fileMentionKey(at('hi @ab|'))).toBe('3')
    expect(fileMentionKey(null)).toBeNull()
  })
})
