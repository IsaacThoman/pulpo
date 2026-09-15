import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { answerQuestionsSchema, questionItemSchema, resolveQuestionAnswers, type QuestionItem, type ResponseUsage } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { agentQuestions, agentRuns, chats, generationAttempts, requestLogs, responses, toolExecutions } from '../database/schema.js'
import { generationQueue } from '../jobs.js'
import { AppError, notFound } from '../lib/errors.js'
import { accessibleChatCondition } from '../chats/temporary.js'
import { publishResponseEvent, publishSnapshot } from '../responses/events.js'
import { toSnapshot } from '../responses/service.js'
import { releaseBudget, settleBudget } from '../accounting/service.js'

export function withQuestionItem(output: unknown[], item: QuestionItem): unknown[] {
  const next = output.filter(raw => (raw as { id?: string; type?: string })?.type !== 'pulpo_question' || (raw as { id?: string }).id !== item.id)
  return [...next, item]
}

export async function answerAgentQuestions(responseId: string, questionSetId: string, userId: string, body: unknown) {
  const input = answerQuestionsSchema.parse(body)
  const result = await db.transaction(async tx => {
    const [response] = await tx.select({ response: responses }).from(responses).innerJoin(chats, eq(chats.id, responses.chatId))
      .where(and(eq(responses.id, responseId), eq(responses.userId, userId), isNull(responses.deletedAt), isNull(chats.deletedAt), accessibleChatCondition()))
      .for('update', { of: responses }).limit(1)
    if (!response) throw notFound('Response')
    const [row] = await tx.select().from(agentQuestions).where(and(eq(agentQuestions.id, questionSetId), eq(agentQuestions.responseId, responseId))).limit(1)
    if (!row) throw notFound('Questions')
    const item = questionItemSchema.parse(row.item)
    let answers: QuestionItem['answers']
    try { answers = resolveQuestionAnswers(item.questions, input) }
    catch { throw new AppError(400, 'invalid_answers', 'Answer or skip each question using a valid option or text') }
    if (item.status !== 'pending') {
      const identical = item.status !== 'cancelled' && item.questions.every(q => JSON.stringify(item.answers[q.id]) === JSON.stringify(answers[q.id]))
      return { response: response.response, item, changed: false, conflict: !identical }
    }
    if (!['queued', 'in_progress'].includes(response.response.status)) throw new AppError(409, 'response_not_active', 'This response is no longer accepting answers')
    const resolved: QuestionItem = { ...item, status: input.action === 'skip_all' ? 'skipped' : 'answered', answers }
    await tx.update(agentQuestions).set({ item: resolved, resolvedAt: new Date(), updatedAt: new Date() }).where(eq(agentQuestions.id, row.id))
    const [updated] = await tx.update(responses).set({ output: withQuestionItem(response.response.output as unknown[], resolved), lastSequence: response.response.lastSequence + 1, updatedAt: new Date() }).where(eq(responses.id, responseId)).returning()
    return { response: updated!, item: resolved, changed: true, conflict: false }
  })
  const snapshot = toSnapshot(result.response)
  if (result.changed) await publishResponseEvent({ responseId, sequence: snapshot.sequence, type: 'pulpo.agent.question.updated', payload: result.item, emittedAt: snapshot.updatedAt })
  await publishSnapshot(snapshot)
  // The resolved row is the durable outbox. A periodic recovery pass retries queue failures.
  await dispatchQuestionResumes().catch(() => undefined)
  return { snapshot, conflict: result.conflict }
}

export async function dispatchQuestionResumes(): Promise<void> {
  const cancelled = await db.select({ responseId: agentRuns.responseId }).from(agentRuns).where(and(eq(agentRuns.status, 'cancelled'), isNull(agentRuns.completedAt)))
  for (const run of cancelled) await cancelWaitingQuestions(run.responseId)
  const pending = await db.select({ id: agentQuestions.id, responseId: agentQuestions.responseId }).from(agentQuestions)
    .innerJoin(responses, eq(responses.id, agentQuestions.responseId))
    .where(and(isNotNull(agentQuestions.resolvedAt), isNull(agentQuestions.consumedAt), inArray(responses.status, ['queued', 'in_progress'])))
  for (const row of pending) {
    const jobId = `question-${row.id}`
    const job = await generationQueue.getJob(jobId)
    const state = await job?.getState()
    if (state === 'completed' || state === 'failed') await job!.remove()
    if (!job || state === 'completed' || state === 'failed') await generationQueue.add('answer-question', { responseId: row.responseId }, { jobId })
  }
}

/** Settle a parked run without requiring a model, provider credentials, or a workspace. */
export async function cancelWaitingQuestions(responseId: string): Promise<void> {
  const claimed = await db.transaction(async tx => {
    const [response] = await tx.select().from(responses).where(eq(responses.id, responseId)).for('update').limit(1)
    if (!response) return
    const [run] = await tx.select().from(agentRuns).where(and(eq(agentRuns.responseId, responseId), or(eq(agentRuns.status, 'waiting_for_input'), and(eq(agentRuns.status, 'cancelled'), isNull(agentRuns.completedAt))))).for('update').limit(1)
    if (!run) return
    if (run.status === 'waiting_for_input') {
      const rows = await tx.select().from(agentQuestions).where(eq(agentQuestions.agentRunId, run.id))
      let output = response.output as unknown[]
      for (const row of rows) {
        const item = questionItemSchema.parse(row.item)
        if (item.status === 'pending') {
          const cancelled = { ...item, status: 'cancelled' as const }
          output = withQuestionItem(output, cancelled)
          await tx.update(agentQuestions).set({ item: cancelled, consumedAt: new Date(), updatedAt: new Date() }).where(eq(agentQuestions.id, row.id))
        }
      }
      // A cancelled run with no completedAt is a durable accounting-finalization job.
      await tx.update(agentRuns).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(agentRuns.id, run.id))
      await tx.update(responses).set({ status: 'cancelled', output, lastSequence: sql`${responses.lastSequence} + 1`, completedAt: new Date(), updatedAt: new Date() }).where(eq(responses.id, responseId))
    }
    return { run, response }
  })
  if (!claimed) return
  const { run, response } = claimed
  const [cancelled] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
  if (cancelled) await publishSnapshot(toSnapshot(cancelled))
  const [log] = await db.select().from(requestLogs).where(eq(requestLogs.responseId, responseId)).limit(1)
  const [modelCost] = log ? await db.select({ total: sql<number>`coalesce(sum(${generationAttempts.costMicros}), 0)::bigint` }).from(generationAttempts).where(eq(generationAttempts.requestLogId, log.id)) : []
  const [toolCost] = await db.select({ total: sql<number>`coalesce(sum(${toolExecutions.billedCostMicros}), 0)::bigint` }).from(toolExecutions).where(eq(toolExecutions.agentRunId, run.id))
  const cost = Number(modelCost?.total ?? 0) + Number(toolCost?.total ?? 0) + run.workspaceCostMicros
  const usage = response.usage as ResponseUsage | null
  if (cost || usage?.totalTokens) await settleBudget({ responseId, usage: usage ?? { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 0 }, latencyMs: run.activeDurationMs, costMicrosOverride: cost, inferenceReferenceCostMicros: Number((run.context as { inferenceReferenceCostMicros?: number }).inferenceReferenceCostMicros ?? 0) })
  else await releaseBudget(responseId)
  await db.update(agentRuns).set({ completedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, run.id))
  if (log) await db.update(requestLogs).set({ status: 'cancelled', costMicros: cost, durationMs: run.activeDurationMs, completedAt: new Date(), updatedAt: new Date() }).where(eq(requestLogs.id, log.id))
}
