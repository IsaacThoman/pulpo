import { eq } from 'drizzle-orm'
import { db } from '../database/client.js'
import { applicationSettings, chats, memories, models, providerConnections, responses, userPreferences } from '../database/schema.js'
import { newId } from '../lib/ids.js'
import { DEFAULT_TITLE_PROMPT, parseInterfaceSettings } from '../settings/application-settings.js'
import { parseGeneratedTitle, selectTitleHistory } from './title-generation.js'
import { trackInternalModelCall } from './model-calls.js'
import { createCatalogModelClient, resolveAvailableCatalogModel, type CatalogModelRuntime } from './catalog-model-runtime.js'

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
    const titleResult = await trackInternalModelCall({
      requestLogId,
      modelId: runtime.model.id,
      upstreamModelId: runtime.model.upstreamModelId,
      purpose: 'title',
      invoke: () => client.responses.create({
        model: runtime.model.upstreamModelId,
        input: [{ role: 'user', content: `${task.titlePrompt || DEFAULT_TITLE_PROMPT}\n\nChat history:\n${history}` }],
        store: false,
        max_output_tokens: Math.min(256, runtime.model.maxOutputTokens),
      }),
    })
    const title = parseGeneratedTitle(titleResult.output_text)
    if (title) await db.update(chats).set({ title, updatedAt: new Date() }).where(eq(chats.id, record.response.chatId))
  }
  const [preference] = await db.select().from(userPreferences).where(eq(userPreferences.userId, record.response.userId)).limit(1)
  const values = (preference?.values ?? {}) as { memoryEnabled?: boolean }
  if (!values.memoryEnabled) return
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
