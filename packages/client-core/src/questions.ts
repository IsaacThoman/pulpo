import { questionAnswerSchema, type QuestionAnswer, type QuestionItem } from '@pulpo/contracts'

export type QuestionDraft = { index: number; answers: Record<string, QuestionAnswer>; text: string }
export const emptyQuestionDraft = (): QuestionDraft => ({ index: 0, answers: {}, text: '' })

export function restoreQuestionDraft(item: QuestionItem, raw: unknown): QuestionDraft {
  const data = raw as Partial<QuestionDraft> | null
  const answers: QuestionDraft['answers'] = {}
  for (const q of item.questions) {
    const parsed = questionAnswerSchema.safeParse(data?.answers?.[q.id])
    if (parsed.success && (parsed.data.kind !== 'option' || q.options?.[parsed.data.index])) answers[q.id] = parsed.data
  }
  return { index: Math.max(0, Math.min(item.questions.length - 1, Number.isInteger(data?.index) ? data!.index! : 0)), answers, text: typeof data?.text === 'string' ? data.text : '' }
}

export function answerQuestion(item: QuestionItem, draft: QuestionDraft, answer: QuestionAnswer): QuestionDraft {
  const question = item.questions[draft.index]!
  const index = Math.min(draft.index + 1, item.questions.length - 1)
  const answers = { ...draft.answers, [question.id]: answer }
  const nextAnswer = answers[item.questions[index]!.id]
  return { index, answers, text: nextAnswer?.kind === 'text' ? nextAnswer.text : '' }
}

export function navigateQuestion(item: QuestionItem, draft: QuestionDraft, index: number): QuestionDraft {
  const current = item.questions[draft.index]!
  const answers = draft.text.trim() ? { ...draft.answers, [current.id]: { kind: 'text' as const, text: draft.text.trim() } } : draft.answers
  const next = Math.max(0, Math.min(item.questions.length - 1, index))
  const answer = answers[item.questions[next]!.id]
  return { index: next, answers, text: answer?.kind === 'text' ? answer.text : '' }
}

export function questionSubmission(item: QuestionItem, draft: QuestionDraft): Record<string, QuestionAnswer> | null {
  const answers = draft.text.trim()
    ? { ...draft.answers, [item.questions[draft.index]!.id]: { kind: 'text' as const, text: draft.text.trim() } }
    : draft.answers
  return item.questions.every(q => answers[q.id]) ? answers : null
}
