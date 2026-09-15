import { z } from 'zod'

export const agentQuestionSchema = z.object({
  id: z.string().trim().min(1).max(100),
  prompt: z.string().trim().min(1).max(2_000),
  options: z.array(z.object({
    label: z.string().trim().min(1).max(300),
    description: z.string().max(1_000).optional(),
    recommended: z.boolean().optional(),
  })).min(2).max(6).optional(),
})
export const requestUserInputSchema = z.object({ questions: z.array(agentQuestionSchema).min(1).max(3) })
  .refine(({ questions }) => new Set(questions.map(q => q.id)).size === questions.length, 'Question IDs must be unique')
export const questionAnswerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('option'), index: z.number().int().min(0).max(5) }),
  z.object({ kind: z.literal('text'), text: z.string().trim().min(1).max(10_000) }),
  z.object({ kind: z.literal('skipped') }),
])
export const answerQuestionsSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('submit'), answers: z.record(z.string(), questionAnswerSchema) }),
  z.object({ action: z.literal('skip_all') }),
])
export const questionItemSchema = z.object({
  type: z.literal('pulpo_question'),
  id: z.string(),
  toolCallId: z.string(),
  responseId: z.string(),
  questions: z.array(agentQuestionSchema).min(1).max(3),
  status: z.enum(['pending', 'answered', 'skipped', 'cancelled']),
  answers: z.record(z.string(), questionAnswerSchema).default({}),
})
export type AgentQuestion = z.infer<typeof agentQuestionSchema>
export type QuestionAnswer = z.infer<typeof questionAnswerSchema>
export type AnswerQuestions = z.infer<typeof answerQuestionsSchema>
export type QuestionItem = z.infer<typeof questionItemSchema>

export function questionItems(output: unknown[] = []): QuestionItem[] {
  return output.flatMap(item => {
    const parsed = questionItemSchema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

export function resolveQuestionAnswers(questions: AgentQuestion[], input: AnswerQuestions): Record<string, QuestionAnswer> {
  if (input.action === 'skip_all') return Object.fromEntries(questions.map(q => [q.id, { kind: 'skipped' as const }]))
  if (Object.keys(input.answers).length !== questions.length) throw new Error('Answer or skip each question')
  return Object.fromEntries(questions.map(q => {
    const answer = questionAnswerSchema.parse(input.answers[q.id])
    if (answer.kind === 'option' && !q.options?.[answer.index]) throw new Error('Invalid option')
    return [q.id, answer]
  }))
}

export function questionAnswerText(question: AgentQuestion, answer?: QuestionAnswer): string {
  if (!answer || answer.kind === 'skipped') return 'Skipped'
  return answer.kind === 'text' ? answer.text : question.options?.[answer.index]?.label ?? 'Skipped'
}
