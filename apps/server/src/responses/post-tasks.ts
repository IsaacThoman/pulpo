import { eq } from 'drizzle-orm'
import { db } from '../database/client.js'
import { applicationSettings, chats, memories, models, providerConnections, responses, userPreferences } from '../database/schema.js'
import { persistGeneratedChatTitle } from '../chats/title-change.js'
import { newId } from '../lib/ids.js'
import { DEFAULT_TITLE_PROMPT, parseInterfaceSettings } from '../settings/application-settings.js'
import { parseGeneratedTitle, selectTitleHistory } from './title-generation.js'
import { trackInternalModelCall } from './model-calls.js'
import { createCatalogModelClient, resolveAvailableCatalogModel, type CatalogModelRuntime } from './catalog-model-runtime.js'

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
): Promise<void> {
  const [setting] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'interface')).limit(1)
  const task = parseInterfaceSettings(setting?.value)
  const runtime = await resolvePostTaskRuntime(task.localTask, current)
  const client = createCatalogModelClient(runtime)
  const inputText = JSON.stringify(record.response.input).slice(0, 8_000)
  if (task.title !== false && !record.response.parentResponseId) {
    const history = selectTitleHistory(
      JSON.stringify([...(record.response.input as unknown[]), ...output]),
      task.titleIncludeFirstCharacters,
      task.titleIncludeLastCharacters,
    )
    const maxOutputTokens = Math.min(TITLE_MAX_OUTPUT_TOKENS, runtime.model.maxOutputTokens)
    const titleResult = await retryInvalidTitleOutput((attempt) => trackInternalModelCall({
      requestLogId,
      modelId: runtime.model.id,
      upstreamModelId: runtime.model.upstreamModelId,
      purpose: 'title',
      retryAttempt: attempt + 1,
      invoke: async () => {
        const response = await client.responses.create({
          model: runtime.model.upstreamModelId,
          input: [{ role: 'user', content: titleTaskPrompt(task.titlePrompt || DEFAULT_TITLE_PROMPT, history, attempt) }],
          store: false,
          max_output_tokens: maxOutputTokens,
        })
        return {
          id: response.id,
          usage: response.usage,
          title: validateGeneratedTitleResponse(response, maxOutputTokens),
        }
      },
    }))
    await persistGeneratedChatTitle({
      userId: record.response.userId,
      chatId: record.response.chatId,
      title: titleResult.title,
    })
  }
  const [preference] = await db.select().from(userPreferences).where(eq(userPreferences.userId, record.response.userId)).limit(1)
  const values = (preference?.values ?? {}) as { memoryEnabled?: boolean }
  if (!values.memoryEnabled) return
  const [chat] = await db.select({ temporary: chats.temporary }).from(chats)
    .where(eq(chats.id, record.response.chatId)).limit(1)
  if (chat?.temporary) return
  const memoryResult = await trackInternalModelCall({
    requestLogId,
    modelId: runtime.model.id,
    upstreamModelId: runtime.model.upstreamModelId,
    purpose: 'memory',
    invoke: () => client.responses.create({
      model: runtime.model.upstreamModelId,
      input: [{ role: 'user', content: `Extract at most 3 durable user facts or preferences worth remembering from this exchange. Return a JSON array of short strings, or [] if there are none.\n\n${inputText}` }],
      store: false,
      max_output_tokens: Math.min(200, runtime.model.maxOutputTokens),
    }),
  })
  try {
    const parsed = JSON.parse(memoryResult.output_text.replace(/^```json\s*|```$/g, '').trim()) as unknown
    if (!Array.isArray(parsed)) return
    const existing = new Set((await db.select({ content: memories.content }).from(memories).where(eq(memories.userId, record.response.userId))).map((row) => row.content.toLowerCase()))
    for (const content of parsed.slice(0, 3)) {
      if (typeof content !== 'string' || !content.trim() || existing.has(content.trim().toLowerCase())) continue
      await db.insert(memories).values({ id: newId(), userId: record.response.userId, sourceChatId: record.response.chatId, content: content.trim().slice(0, 2_000) })
    }
  } catch { /* malformed task output is non-fatal */ }
}
