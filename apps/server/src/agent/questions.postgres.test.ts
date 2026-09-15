import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { questionItemSchema, type QuestionItem } from '@pulpo/contracts'
import { db, queryClient } from '../database/client.js'
import { agentQuestions, agentRuns, chats, models, providerConnections, responses, users } from '../database/schema.js'

const queue = vi.hoisted(() => ({ add: vi.fn(), getJob: vi.fn() }))
const accounting = vi.hoisted(() => ({ releaseBudget: vi.fn(), settleBudget: vi.fn() }))
vi.mock('../jobs.js', () => ({ generationQueue: queue, maintenanceQueue: { add: vi.fn() } }))
vi.mock('../responses/events.js', () => ({ publishResponseEvent: vi.fn(), publishSnapshot: vi.fn() }))
vi.mock('../accounting/service.js', () => accounting)
vi.mock('../responses/service.js', () => ({ toSnapshot: (row: typeof responses.$inferSelect) => ({ responseId: row.id, sequence: row.lastSequence, status: row.status, output: row.output, usage: row.usage, error: row.error, updatedAt: row.updatedAt.toISOString() }) }))
import { answerAgentQuestions, cancelWaitingQuestions, dispatchQuestionResumes } from './questions.js'

const enabled = process.env.PULPO_QUESTIONS_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_questions_test') throw new Error('Question regressions require a disposable database named pulpo_questions_test')
const owner = randomUUID(), provider = randomUUID(), model = `questions-${randomUUID()}`
let chatId: string, responseId: string, runId: string, item: QuestionItem

describe.skipIf(!enabled)('durable question answers on PostgreSQL', () => {
  beforeEach(async () => {
    vi.resetAllMocks()
    await db.delete(users).where(eq(users.id, owner))
    await db.delete(models).where(eq(models.id, model))
    await db.delete(providerConnections).where(eq(providerConnections.id, provider))
    await db.insert(users).values({ id: owner, email: `${owner}@pulpo.invalid`, name: 'Question owner', username: `question-${owner.slice(0, 8)}` })
    await db.insert(providerConnections).values({ id: provider, name: 'Question test', encryptedApiKey: 'unused' })
    await db.insert(models).values({ id: model, providerConnectionId: provider, upstreamModelId: model, name: 'Question test', contextWindow: 16384, maxOutputTokens: 2048 })
    chatId = randomUUID(); responseId = randomUUID(); runId = randomUUID()
    item = { type: 'pulpo_question', id: randomUUID(), responseId, toolCallId: randomUUID(), status: 'pending', answers: {}, questions: [{ id: 'q', prompt: 'What kind?', options: [{ label: 'Puzzle' }, { label: 'Arcade' }] }] }
    await db.insert(chats).values({ id: chatId, userId: owner, modelId: model, title: 'Questions' })
    await db.insert(responses).values({ id: responseId, chatId, userId: owner, modelId: model, userMessageId: randomUUID(), agentMode: true, status: 'in_progress', input: [], output: [item], lastSequence: 4 })
    await db.insert(agentRuns).values({ id: runId, responseId, status: 'waiting_for_input', activeDurationMs: 1200 })
    await db.insert(agentQuestions).values({ id: item.id, responseId, agentRunId: runId, toolCallId: item.toolCallId, item })
  })
  afterAll(async () => {
    await db.delete(users).where(eq(users.id, owner))
    await db.delete(models).where(eq(models.id, model))
    await db.delete(providerConnections).where(eq(providerConnections.id, provider))
    await queryClient.end()
  })
  const answer = (index = 0) => answerAgentQuestions(responseId, item.id, owner, { action: 'submit', answers: { q: { kind: 'option', index } } })

  it('serializes conflicting answers from two devices and preserves the first resolution', async () => {
    const results = await Promise.all([answer(0), answer(1)])
    expect(results.filter(result => result.conflict)).toHaveLength(1)
    const [row] = await db.select().from(agentQuestions).where(eq(agentQuestions.id, item.id))
    const saved = questionItemSchema.parse(row!.item)
    const accepted = results.find(result => !result.conflict)!
    expect(accepted.snapshot.output).toEqual([saved])
    expect(saved.status).toBe('answered')
    expect(accepted.snapshot.status).toBe('in_progress')
    expect(accepted.snapshot.sequence).toBe(5)
  })
  it('returns the same result for duplicate submissions without another sequence', async () => {
    const first = await answer()
    const second = await answer()
    expect(second.conflict).toBe(false)
    expect(second.snapshot).toEqual(first.snapshot)
  })
  it('recovers a queue outage from the saved answer and does not dispatch unresolved requests', async () => {
    await dispatchQuestionResumes()
    expect(queue.add).not.toHaveBeenCalledWith('answer-question', { responseId }, { jobId: `question-${item.id}` })
    queue.add.mockRejectedValueOnce(new Error('Redis offline'))
    await answer()
    queue.add.mockClear()
    await dispatchQuestionResumes()
    expect(queue.add).toHaveBeenCalledWith('answer-question', { responseId }, { jobId: `question-${item.id}` })
    await db.update(agentQuestions).set({ consumedAt: new Date() }).where(eq(agentQuestions.id, item.id))
    queue.add.mockClear()
    await dispatchQuestionResumes()
    expect(queue.add).not.toHaveBeenCalledWith('answer-question', { responseId }, { jobId: `question-${item.id}` })
  })
  it('skips all questions and rejects unauthorized, expired, and invalid answers', async () => {
    await expect(answerAgentQuestions(responseId, item.id, randomUUID(), { action: 'skip_all' })).rejects.toThrow('Response')
    await expect(answerAgentQuestions(responseId, item.id, owner, { action: 'submit', answers: {} })).rejects.toThrow('Answer or skip')
    const skipped = await answerAgentQuestions(responseId, item.id, owner, { action: 'skip_all' })
    expect(skipped.snapshot.output).toMatchObject([{ status: 'skipped', answers: { q: { kind: 'skipped' } } }])
    await db.update(chats).set({ expiresAt: new Date('2020-01-01') }).where(eq(chats.id, chatId))
    await expect(answer()).rejects.toThrow('Response')
  })
  it('cancels a parked run, releases its reservation and prevents later resumption', async () => {
    await cancelWaitingQuestions(responseId)
    expect(accounting.releaseBudget).toHaveBeenCalledWith(responseId)
    const [row] = await db.select().from(responses).where(eq(responses.id, responseId))
    expect(row?.status).toBe('cancelled')
    expect(row?.output).toMatchObject([{ status: 'cancelled' }])
    await dispatchQuestionResumes()
    expect(queue.add).not.toHaveBeenCalledWith('answer-question', { responseId }, { jobId: `question-${item.id}` })
    expect((await answer()).conflict).toBe(true)
  })
  it('retries interrupted cancellation accounting without reviving the response', async () => {
    accounting.releaseBudget.mockRejectedValueOnce(new Error('Accounting temporarily unavailable'))
    await expect(cancelWaitingQuestions(responseId)).rejects.toThrow('Accounting temporarily unavailable')
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId))
    expect(run).toMatchObject({ status: 'cancelled', completedAt: null })
    await dispatchQuestionResumes()
    expect(accounting.releaseBudget).toHaveBeenCalledTimes(2)
    expect(queue.add).not.toHaveBeenCalledWith('answer-question', { responseId }, { jobId: `question-${item.id}` })
    const [completed] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId))
    expect(completed?.completedAt).toBeInstanceOf(Date)
  })
})
