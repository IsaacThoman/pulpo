import { eq } from 'drizzle-orm'
import { db } from '../database/client.js'
import { applicationSettings, chats, memories, models, providerConnections, responses, userPreferences } from '../database/schema.js'
import { persistGeneratedChatTitle } from '../chats/title-change.js'
import { newId } from '../lib/ids.js'
import { DEFAULT_TITLE_PROMPT, parseInterfaceSettings } from '../settings/application-settings.js'
import { parseGeneratedTitle, selectTitleHistory } from './title-generation.js'
import { trackBilledInternalModelCall } from './model-calls.js'
import { createCatalogModelClient, resolveAvailableCatalogModel, type CatalogModelRuntime } from './catalog-model-runtime.js'
import { scheduleUserIndex } from '../episodic-memory/queue.js'

export const TITLE_MAX_OUTPUT_TOKENS = 1_024
export const TITLE_VALIDATION_ATTEMPTS = 3

type TitleModelResponse = {
  id?: string
  output_text: string
  status?: string
  incomplete_details?: { reason?: string } | null
  usage?: unknown
}

export class TitleOutputValidationError extends Error {
  constructor(reason: string) {
    super(`Title output validation failed: ${reason}`)
    this.name = 'TitleOutputValidationError'
  }
}

class TitleUnfundedError extends Error {
  constructor() {
    super('insufficient balance for title generation')
    this.name = 'TitleUnfundedError'
  }
}

function responseOutputTokens(usage: unknown): number {
  const value = (usage ?? {}) as Record<string, unknown>
  return Number(value.output_tokens ?? value.outputTokens ?? 0)
}

export function validateGeneratedTitleResponse(response: TitleModelResponse, maxOutputTokens: number): string {
  if (response.status === 'incomplete') {
    throw new TitleOutputValidationError(response.incomplete_details?.reason ?? 'incomplete response')
  }
  if (responseOutputTokens(response.usage) >= maxOutputTokens) {
    throw new TitleOutputValidationError('maximum output token limit reached')
  }
  const title = parseGeneratedTitle(response.output_text)
  if (!title) throw new TitleOutputValidationError('response was not valid title JSON')
  return title
}

export async function retryInvalidTitleOutput<T>(
  invoke: (attempt: number) => Promise<T>,
  attempts = TITLE_VALIDATION_ATTEMPTS,
): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await invoke(attempt)
    } catch (error) {
      if (!(error instanceof TitleOutputValidationError) || attempt + 1 >= attempts) throw error
    }
  }
  throw new TitleOutputValidationError('retry attempts exhausted')
}

function titleTaskPrompt(prompt: string, history: string, attempt: number): string {
  const correction = attempt > 0
    ? '\n\nYour previous response was invalid or truncated. Return exactly one JSON object matching {"title":"..."}, with no analysis, explanation, or Markdown.'
    : ''
  return `${prompt}${correction}\n\nChat history:\n${history}`
}

export async function resolvePostTaskRuntime(
  selectedModelId: string,
  current: CatalogModelRuntime,
): Promise<CatalogModelRuntime> {
  if (selectedModelId === 'current') return current
  return selectPostTaskRuntime(current, await resolveAvailableCatalogModel(selectedModelId))
}

export function selectPostTaskRuntime(
  current: CatalogModelRuntime,
  selected: CatalogModelRuntime | null,
): CatalogModelRuntime {
  return selected ?? current
}

export async function persistGeneratedTitleResult(input: {
  userId: string
  chatId: string
  outputText: string
}): Promise<boolean> {
  const title = parseGeneratedTitle(input.outputText)
  if (!title) return false
  return persistGeneratedChatTitle({
    userId: input.userId,
    chatId: input.chatId,
    title,
  })
}

export async function runPostResponseTasks(
  record: { response: typeof responses.$inferSelect },
  current: { model: typeof models.$inferSelect; provider: typeof providerConnections.$inferSelect },
  output: unknown[],
  requestLogId: string,
): Promise<number> {
  if (record.response.origin === 'api') return 0
  const [setting] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'interface')).limit(1)
  const task = parseInterfaceSettings(setting?.value)
  const runtime = await resolvePostTaskRuntime(task.localTask, current)
  const client = createCatalogModelClient(runtime)
  const inputText = JSON.stringify(record.response.input).slice(0, 8_000)
  let costMicros = 0
  if (task.title !== false && !record.response.parentResponseId) {
    const history = selectTitleHistory(
      JSON.stringify([...(record.response.input as unknown[]), ...output]),
      task.titleIncludeFirstCharacters,
      task.titleIncludeLastCharacters,
    )
    const maxOutputTokens = Math.min(TITLE_MAX_OUTPUT_TOKENS, runtime.model.maxOutputTokens)
    try {
      const titleResult = await retryInvalidTitleOutput(async (attempt) => {
        const prompt = titleTaskPrompt(task.titlePrompt || DEFAULT_TITLE_PROMPT, history, attempt)
        const billed = await trackBilledInternalModelCall({
          responseId: record.response.id,
          requestLogId,
          modelId: runtime.model.id,
          upstreamModelId: runtime.model.upstreamModelId,
          purpose: 'title',
          requestInput: [{ role: 'user', content: prompt }],
          maxOutputTokens,
          retryAttempt: attempt + 1,
          invoke: async () => {
            const response = await client.responses.create({
              model: runtime.model.upstreamModelId,
              input: [{ role: 'user', content: prompt }],
              store: false,
              max_output_tokens: maxOutputTokens,
            })
            return {
              id: response.id,
              usage: response.usage,
              title: validateGeneratedTitleResponse(response, maxOutputTokens),
            }
          },
        })
        if ('skipped' in billed) throw new TitleUnfundedError()
        costMicros += billed.costMicros
        return billed.result
      })
      await persistGeneratedChatTitle({
        userId: record.response.userId,
        chatId: record.response.chatId,
        title: titleResult.title,
      })
    } catch (error) {
      if (!(error instanceof TitleUnfundedError)) throw error
    }
  }
  const [preference] = await db.select().from(userPreferences).where(eq(userPreferences.userId, record.response.userId)).limit(1)
  const values = (preference?.values ?? {}) as { memoryEnabled?: boolean }
  if (!values.memoryEnabled) return costMicros
  const [chat] = await db.select({ temporary: chats.temporary }).from(chats)
    .where(eq(chats.id, record.response.chatId)).limit(1)
  if (chat?.temporary) return costMicros
  const memoryInput = [{ role: 'user' as const, content: `Extract at most 3 durable user facts or preferences worth remembering from this exchange. Return a JSON array of short strings, or [] if there are none.\n\n${inputText}` }]
  const memoryMaxOutputTokens = Math.min(200, runtime.model.maxOutputTokens)
  const memoryResult = await trackBilledInternalModelCall({
    responseId: record.response.id,
    requestLogId,
    modelId: runtime.model.id,
    upstreamModelId: runtime.model.upstreamModelId,
    purpose: 'memory',
    requestInput: memoryInput,
    maxOutputTokens: memoryMaxOutputTokens,
    invoke: () => client.responses.create({
      model: runtime.model.upstreamModelId,
      input: memoryInput,
      store: false,
      max_output_tokens: memoryMaxOutputTokens,
    }),
  })
  if ('skipped' in memoryResult) return costMicros
  costMicros += memoryResult.costMicros
  try {
    const parsed = JSON.parse(memoryResult.result.output_text.replace(/^```json\s*|```$/g, '').trim()) as unknown
    if (!Array.isArray(parsed)) return costMicros
    const existing = new Set((await db.select({ content: memories.content }).from(memories).where(eq(memories.userId, record.response.userId))).map((row) => row.content.toLowerCase()))
    let inserted = false
    for (const content of parsed.slice(0, 3)) {
      if (typeof content !== 'string' || !content.trim() || existing.has(content.trim().toLowerCase())) continue
      await db.insert(memories).values({ id: newId(), userId: record.response.userId, sourceChatId: record.response.chatId, content: content.trim().slice(0, 2_000) })
      inserted = true
    }
    if (inserted) await scheduleUserIndex(record.response.userId, 'saved-memory-extracted')
  } catch { /* malformed task output is non-fatal */ }
  return costMicros
}
