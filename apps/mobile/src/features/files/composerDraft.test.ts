import { addComposerReferences, composerMessageText, composerReferences, removeComposerReference } from '@pulpo/client-core/files'
import { fileReferenceIds, splitFileReferences } from '@pulpo/contracts'
import { describe, expect, it } from 'vitest'
import { appendComposerText, composerTextEnd, draftPreviewText, draftReferenceNames, withComposerText } from './composerDraft'

const plan = { id: '6f1c1c0e-58f8-4c55-9f0e-0f8c6f1b2a01', name: 'Plan.md', folder: false }
const projects = { id: '6f1c1c0e-58f8-4c55-9f0e-0f8c6f1b2a02', name: 'Projects', folder: true }

describe('composer drafts with Files references', () => {
  it('shows the typed text and keeps the references as chips while typing', () => {
    let draft = addComposerReferences('', [plan])
    expect(composerReferences(draft)).toEqual({ text: '', references: [plan] })
    draft = withComposerText(draft, 'Summarize')
    draft = withComposerText(draft, 'Summarize this\n')
    expect(composerReferences(draft)).toEqual({ text: 'Summarize this\n', references: [plan] })
    expect(composerTextEnd(draft)).toBe('Summarize this\n'.length)
    draft = addComposerReferences(draft, [projects, plan])
    expect(composerReferences(draft).references).toEqual([plan, projects])
    draft = removeComposerReference(draft, plan.id)
    expect(composerReferences(draft)).toEqual({ text: 'Summarize this\n', references: [projects] })
  })

  it('sends the typed text with its references as a last paragraph the server reads', () => {
    const draft = withComposerText(addComposerReferences('', [plan, projects]), '  Compare these  ')
    const sent = composerMessageText(draft)
    expect(sent).toBe(`Compare these\n\n[Plan.md](/files/d/${plan.id}) [Projects](/files/f/${projects.id})`)
    expect(fileReferenceIds(sent)).toEqual([plan.id, projects.id])
    // Editing the sent message puts the links back into chips.
    expect(composerReferences(sent)).toEqual({ text: 'Compare these', references: [plan, projects] })
    expect(splitFileReferences(sent).references).toEqual([plan, projects])
  })

  it('adds text before the references, not after them', () => {
    const draft = appendComposerText(withComposerText(addComposerReferences('', [plan]), 'Notes'), 'Quiz results')
    expect(composerReferences(draft)).toEqual({ text: 'Notes\n\nQuiz results', references: [plan] })
    expect(composerReferences(appendComposerText('', 'Only text'))).toEqual({ text: 'Only text', references: [] })
  })

  it('previews queued and shelved messages without the links', () => {
    const draft = withComposerText(addComposerReferences('', [plan, projects]), 'Compare these')
    expect(draftPreviewText(draft)).toBe('Compare these')
    expect(draftReferenceNames(draft)).toEqual(['Plan.md', 'Projects'])
    const onlyReferences = addComposerReferences('', [plan])
    expect(draftPreviewText(onlyReferences)).toBe('Plan.md')
    expect(draftReferenceNames(onlyReferences)).toEqual([])
    expect(draftPreviewText('')).toBe('Attachments')
  })
})
