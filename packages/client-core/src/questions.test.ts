import { describe, expect, it } from 'vitest'
import { answerQuestion, emptyQuestionDraft, navigateQuestion, questionSubmission, restoreQuestionDraft } from './questions.js'
import type { QuestionItem } from '@pulpo/contracts'

const item: QuestionItem = { type: 'pulpo_question', id: 'set', responseId: 'response', toolCallId: 'call', status: 'pending', answers: {}, questions: [
  { id: 'game', prompt: 'What kind?', options: [{ label: 'Puzzle' }, { label: 'Arcade' }] },
  { id: 'theme', prompt: 'What theme?' },
  { id: 'difficulty', prompt: 'How difficult?' },
] }

describe('question drafts shared by web and mobile', () => {
  it('starts without an implicit answer and submits only after every question is answered or skipped', () => {
    let draft = emptyQuestionDraft()
    expect(questionSubmission(item, draft)).toBeNull()
    draft = answerQuestion(item, draft, { kind: 'option', index: 1 })
    expect(draft.index).toBe(1)
    draft = answerQuestion(item, draft, { kind: 'text', text: 'Space' })
    expect(draft.index).toBe(2)
    expect(questionSubmission(item, draft)).toBeNull()
    draft = answerQuestion(item, draft, { kind: 'skipped' })
    expect(draft.index).toBe(2)
    expect(questionSubmission(item, draft)).toEqual({ game: { kind: 'option', index: 1 }, theme: { kind: 'text', text: 'Space' }, difficulty: { kind: 'skipped' } })
  })
  it('preserves typed text when navigating and allows replacing choices with custom answers', () => {
    let draft = answerQuestion(item, emptyQuestionDraft(), { kind: 'option', index: 0 })
    draft = navigateQuestion(item, { ...draft, text: 'Ocean' }, 0)
    expect(draft.text).toBe('')
    draft = answerQuestion(item, draft, { kind: 'text', text: 'Word game' })
    expect(draft.text).toBe('Ocean')
    expect(draft.answers.game).toEqual({ kind: 'text', text: 'Word game' })
  })
  it('restores drafts and drops invalid or obsolete options', () => {
    const draft = restoreQuestionDraft(item, { index: 99, answers: { game: { kind: 'option', index: 5 }, theme: { kind: 'text', text: 'Space' }, removed: { kind: 'skipped' } }, text: '' })
    expect(draft.index).toBe(2)
    expect(draft.answers).toEqual({ theme: { kind: 'text', text: 'Space' } })
  })
})
