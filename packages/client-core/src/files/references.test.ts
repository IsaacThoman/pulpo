import { describe, expect, it } from 'vitest'
import { addComposerReferences, composerMessageText, composerReferences, referencePreviewText, removeComposerReference, withComposerReferences } from './references.js'

const plan = { id: '0b5c5d0e-2b7f-4c3e-9a51-6f1d2c3b4a59', name: 'Plan.md', folder: false }
const work = { id: '1b5c5d0e-2b7f-4c3e-9a51-6f1d2c3b4a59', name: 'Work', folder: true }

describe('composer references', () => {
  it('round-trips the typed text exactly, trailing spaces and blank lines included', () => {
    for (const text of ['', 'hello ', 'a\n\n', 'line one\n\nline two\n']) {
      const draft = withComposerReferences(text, [plan, work])
      expect(composerReferences(draft)).toEqual({ text, references: [plan, work] })
    }
    expect(withComposerReferences('hi', [])).toBe('hi')
    expect(composerReferences('just text')).toEqual({ text: 'just text', references: [] })
  })

  it('adds once, removes, and sends the trimmed text with its references', () => {
    let draft = addComposerReferences('Compare ', [plan])
    draft = addComposerReferences(draft, [plan, work])
    expect(composerReferences(draft).references).toEqual([plan, work])
    draft = removeComposerReference(draft, plan.id)
    expect(composerReferences(draft)).toEqual({ text: 'Compare ', references: [work] })
    expect(composerMessageText(draft)).toBe(`Compare\n\n[Work](/files/f/${work.id})`)
    expect(composerMessageText(removeComposerReference(draft, work.id))).toBe('Compare')
  })

  it('previews a draft without its links', () => {
    expect(referencePreviewText(withComposerReferences('Compare ', [plan, work]))).toBe('Compare')
    expect(referencePreviewText(withComposerReferences('', [plan, work]))).toBe('Plan.md, Work')
    expect(referencePreviewText('')).toBe('')
  })
})
