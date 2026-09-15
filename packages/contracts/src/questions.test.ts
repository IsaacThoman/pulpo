import { describe, expect, it } from 'vitest'
import { applyResponseEventToSnapshot, type ResponseSnapshot } from './index.js'
import { requestUserInputSchema, resolveQuestionAnswers, type QuestionItem } from './questions.js'

const questions = [{ id: 'kind', prompt: 'What kind?', options: [{ label: 'Puzzle' }, { label: 'Arcade' }] }]
describe('agent question contracts', () => {
  it('requires 1–3 uniquely identified questions and bounded options', () => {
    expect(requestUserInputSchema.safeParse({ questions }).success).toBe(true)
    expect(requestUserInputSchema.safeParse({ questions: [] }).success).toBe(false)
    expect(requestUserInputSchema.safeParse({ questions: [...questions, ...questions] }).success).toBe(false)
    expect(requestUserInputSchema.safeParse({ questions: [{ ...questions[0], options: [] }] }).success).toBe(false)
  })
  it('validates option indices, missing answers and text while skip-all ignores drafts', () => {
    expect(() => resolveQuestionAnswers(questions, { action: 'submit', answers: {} })).toThrow()
    expect(() => resolveQuestionAnswers(questions, { action: 'submit', answers: { kind: { kind: 'option', index: 5 } } })).toThrow()
    expect(resolveQuestionAnswers(questions, { action: 'skip_all' })).toEqual({ kind: { kind: 'skipped' } })
  })
  it('upserts question events without losing assistant output or marking the response terminal', () => {
    const item: QuestionItem = { type: 'pulpo_question', id: 'set', toolCallId: 'call', responseId: 'response', status: 'pending', answers: {}, questions }
    const snapshot: ResponseSnapshot = { responseId: 'response', status: 'in_progress', sequence: 1, output: [{ type: 'message', content: [] }], usage: null, error: null, updatedAt: new Date().toISOString() }
    const event = { responseId: 'response', sequence: 2, type: 'pulpo.agent.question.updated', payload: item, emittedAt: snapshot.updatedAt }
    const pending = applyResponseEventToSnapshot(snapshot, event)
    const answered = applyResponseEventToSnapshot(pending, { ...event, sequence: 3, payload: { ...item, status: 'skipped' } })
    expect(answered.status).toBe('in_progress')
    expect(answered.output).toHaveLength(2)
    expect(answered.output[1]).toMatchObject({ status: 'skipped' })
    expect(applyResponseEventToSnapshot(answered, event)).toBe(answered)
  })
})
