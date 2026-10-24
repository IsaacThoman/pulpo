import { assertPublicIdentifier } from './identifiers.js'
import { and, eq, isNull, ne } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { db } from '../database/client.js'
import { chats, models, responses } from '../database/schema.js'
import {
  apiKeyModelAllowed,
  assertApiKeyModelAllowed,
  authenticateApiKey,
  filterApiKeyAllowedModels,
} from '../api-keys/routes.js'
import { notFound } from '../lib/errors.js'
import { requestCancellation } from '../responses/events.js'
import { accessibleChatCondition } from '../chats/temporary.js'
import {
  parseChatCompletionRequest,
  parseCompletionRequest,
  parseResponsesRequest,
  serializePublicResponse,
} from './codecs.js'
import { executePublicGeneration } from './generation.js'
import { estimateAnthropicInputTokens, parseAnthropicMessagesRequest, wantsAnthropicShape } from './anthropic-codec.js'
import { CODEX_PROVIDER_ID } from '../codex/constants.js'
import { modelAccessibleToUserCondition } from '../catalog/model-access.js'

function anthropicModel(model: typeof models.$inferSelect) {
  return {
    id: model.id, type: 'model', display_name: model.name, created_at: model.createdAt.toISOString(),
    max_input_tokens: model.contextWindow, max_tokens: model.maxOutputTokens,
  }
}

/**
 * Anthropic's cursor pagination: newest first, `after_id` / `before_id`
 * exclusive. Without `limit` every model is returned, so clients that read
 * one page still see the whole catalog.
 */
export function anthropicModelPage<T extends { id: string; createdAt: Date }>(rows: T[], query: Record<string, unknown>) {
  const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id))
  const limit = query.limit === undefined ? Math.max(1, sorted.length) : Math.min(1_000, Math.max(1, Math.floor(Number(query.limit)) || 1))
  const afterIndex = typeof query.after_id === 'string' ? sorted.findIndex((row) => row.id === query.after_id) : -1
  const beforeIndex = typeof query.before_id === 'string' ? sorted.findIndex((row) => row.id === query.before_id) : -1
  if (beforeIndex >= 0) {
    const page = sorted.slice(Math.max(0, beforeIndex - limit), beforeIndex)
    return { data: page, has_more: beforeIndex - limit > 0 }
  }
  const start = typeof query.after_id === 'string' ? (afterIndex >= 0 ? afterIndex + 1 : sorted.length) : 0
  const page = sorted.slice(start, start + limit)
  return { data: page, has_more: start + limit < sorted.length }
}

function publicModel(model: typeof models.$inferSelect) {
  return {
    id: model.id,
    object: 'model',
    created: Math.floor(model.createdAt.getTime() / 1_000),
    owned_by: 'pulpo',
  }
}

async function accessibleResponse(userId: string, responseId: string) {
  assertPublicIdentifier(responseId, 'id')
  const [result] = await db.select({ response: responses })
    .from(responses)
    .innerJoin(chats, eq(chats.id, responses.chatId))
    .where(and(
      eq(responses.id, responseId),
      eq(responses.userId, userId),
      eq(responses.publiclyStored, true),
      isNull(chats.deletedAt),
      accessibleChatCondition(),
    ))
    .limit(1)
  if (!result?.response || !result.response.publiclyStored) throw notFound('Response')
  return result.response
}

export async function registerPublicApiRoutes(app: FastifyInstance): Promise<void> {
  const logIgnoredParameters = (request: Parameters<typeof authenticateApiKey>[0], protocol: string, parameters: string[]) => {
    if (parameters.length) request.log.info({ protocol, ignoredParameters: parameters }, 'Ignored OpenAI-compatible request parameters')
  }

  app.get('/v1/models', async (request) => {
    const key = await authenticateApiKey(request, 'models')
    const rows = await db.select().from(models).where(and(
      eq(models.enabled, true), eq(models.visible, true), ne(models.providerConnectionId, CODEX_PROVIDER_ID),
      modelAccessibleToUserCondition(key.userId),
    ))
    const allowed = await filterApiKeyAllowedModels(key.id, rows)
    if (wantsAnthropicShape(request.headers)) {
      const page = anthropicModelPage(allowed, request.query as Record<string, unknown>)
      const data = page.data.map(anthropicModel)
      return { data, has_more: page.has_more, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null }
    }
    return { object: 'list', data: allowed.map(publicModel) }
  })

  app.get('/v1/models/:model', async (request) => {
    const key = await authenticateApiKey(request, 'models')
    const { model: modelId } = request.params as { model: string }
    assertPublicIdentifier(modelId, 'model')
    const [model] = await db.select().from(models).where(and(
      eq(models.id, modelId),
      eq(models.enabled, true),
      eq(models.visible, true),
      ne(models.providerConnectionId, CODEX_PROVIDER_ID),
      modelAccessibleToUserCondition(key.userId),
    )).limit(1)
    if (!model || !(await apiKeyModelAllowed(key.id, model.id))) throw notFound('Model')
    return wantsAnthropicShape(request.headers) ? anthropicModel(model) : publicModel(model)
  })

  app.post('/v1/responses', async (request, reply) => {
    const key = await authenticateApiKey(request, 'responses')
    const parsed = parseResponsesRequest(request.body)
    logIgnoredParameters(request, parsed.protocol, parsed.ignoredParameters)
    await assertApiKeyModelAllowed(key.id, parsed.model)
    return executePublicGeneration({ reply, key, request: parsed, idempotencyKey: request.headers['idempotency-key'] as string | undefined })
  })

  app.post('/v1/chat/completions', async (request, reply) => {
    const key = await authenticateApiKey(request, 'responses')
    const parsed = parseChatCompletionRequest(request.body)
    logIgnoredParameters(request, parsed.protocol, parsed.ignoredParameters)
    await assertApiKeyModelAllowed(key.id, parsed.model)
    return executePublicGeneration({ reply, key, request: parsed, idempotencyKey: request.headers['idempotency-key'] as string | undefined })
  })

  app.post('/v1/completions', async (request, reply) => {
    const key = await authenticateApiKey(request, 'responses')
    const parsed = parseCompletionRequest(request.body)
    logIgnoredParameters(request, parsed.protocol, parsed.ignoredParameters)
    await assertApiKeyModelAllowed(key.id, parsed.model)
    return executePublicGeneration({ reply, key, request: parsed, idempotencyKey: request.headers['idempotency-key'] as string | undefined })
  })

  // Agent clients such as Claude Code resend long histories with images and
  // tool output; Anthropic accepts 32 MB requests, so match it here.
  const anthropicBodyLimit = { bodyLimit: 32 * 1024 * 1024 }

  app.post('/v1/messages', anthropicBodyLimit, async (request, reply) => {
    const key = await authenticateApiKey(request, 'responses')
    const parsed = parseAnthropicMessagesRequest(request.body)
    logIgnoredParameters(request, parsed.protocol, parsed.ignoredParameters)
    await assertApiKeyModelAllowed(key.id, parsed.model)
    return executePublicGeneration({ reply, key, request: parsed, idempotencyKey: request.headers['idempotency-key'] as string | undefined })
  })

  app.post('/v1/messages/count_tokens', anthropicBodyLimit, async (request) => {
    const key = await authenticateApiKey(request, 'responses')
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {}
    // Counting needs no output limit; supply one so the shared parser accepts the body.
    const parsed = parseAnthropicMessagesRequest({ max_tokens: 1, ...body, stream: false })
    await assertApiKeyModelAllowed(key.id, parsed.model)
    const [model] = await db.select({ id: models.id }).from(models).where(and(
      eq(models.id, parsed.model), eq(models.enabled, true), ne(models.providerConnectionId, CODEX_PROVIDER_ID),
      modelAccessibleToUserCondition(key.userId),
    )).limit(1)
    if (!model) throw notFound('Model')
    return { input_tokens: estimateAnthropicInputTokens(parsed) }
  })

  app.get('/v1/responses/:id', async (request) => {
    const key = await authenticateApiKey(request, 'responses')
    const { id } = request.params as { id: string }
    return serializePublicResponse(await accessibleResponse(key.userId, id))
  })

  app.post('/v1/responses/:id/cancel', async (request) => {
    const key = await authenticateApiKey(request, 'responses')
    const { id } = request.params as { id: string }
    const row = await accessibleResponse(key.userId, id)
    if (['queued', 'in_progress'].includes(row.status)) await requestCancellation(id)
    return serializePublicResponse(await accessibleResponse(key.userId, id))
  })
}
