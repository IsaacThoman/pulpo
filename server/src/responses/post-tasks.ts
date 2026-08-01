import OpenAI from 'openai'
import { eq } from 'drizzle-orm'
import { db } from '../database/client.js'
import { applicationSettings, chats, memories, models, responses, userPreferences } from '../database/schema.js'
import { newId } from '../lib/ids.js'
import { DEFAULT_TITLE_PROMPT, parseInterfaceSettings } from '../settings/application-settings.js'
import { parseGeneratedTitle, selectTitleHistory } from './title-generation.js'

export async function runPostResponseTasks(
  client: OpenAI,
  record: { response: typeof responses.$inferSelect; model: typeof models.$inferSelect },
  output: unknown[],
): Promise<void> {
  const [setting] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'interface')).limit(1)
  const task = parseInterfaceSettings(setting?.value)
  const inputText = JSON.stringify(record.response.input).slice(0, 8_000)
  if (task.title !== false && !record.response.parentResponseId) {
    const history = selectTitleHistory(
      JSON.stringify([...(record.response.input as unknown[]), ...output]),
      task.titleIncludeFirstCharacters,
      task.titleIncludeLastCharacters,
    )
    const titleResult = await client.responses.create({
      model: record.model.upstreamModelId,
      input: [{ role: 'user', content: `${task.titlePrompt || DEFAULT_TITLE_PROMPT}\n\nChat history:\n${history}` }],
      store: false,
      max_output_tokens: Math.min(256, record.model.maxOutputTokens),
    })
    const title = parseGeneratedTitle(titleResult.output_text)
    if (title) await db.update(chats).set({ title, updatedAt: new Date() }).where(eq(chats.id, record.response.chatId))
  }
  const [preference] = await db.select().from(userPreferences).where(eq(userPreferences.userId, record.response.userId)).limit(1)
  const values = (preference?.values ?? {}) as { memoryEnabled?: boolean }
  if (!values.memoryEnabled) return
  const memoryResult = await client.responses.create({
    model: record.model.upstreamModelId,
    input: [{ role: 'user', content: `Extract at most 3 durable user facts or preferences worth remembering from this exchange. Return a JSON array of short strings, or [] if there are none.\n\n${inputText}` }],
    store: false,
    max_output_tokens: 200,
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
