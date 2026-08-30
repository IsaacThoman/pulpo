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
import { CODEX_PROVIDER_ID } from '../codex/constants.js'

function publicModel(model: typeof models.$inferSelect) {
  return {
    id: model.id,
    object: 'model',
    created: Math.floor(model.createdAt.getTime() / 1_000),
    owned_by: 'pulpo',
  }
}

async function accessibleResponse(userId: string, responseId: string) {
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
    ))
    return { object: 'list', data: (await filterApiKeyAllowedModels(key.id, rows)).map(publicModel) }
  })

  app.get('/v1/models/:model', async (request) => {
    const key = await authenticateApiKey(request, 'models')
    const { model: modelId } = request.params as { model: string }
    const [model] = await db.select().from(models).where(and(
      eq(models.id, modelId),
      eq(models.enabled, true),
      eq(models.visible, true),
      ne(models.providerConnectionId, CODEX_PROVIDER_ID),
    )).limit(1)
    if (!model || !(await apiKeyModelAllowed(key.id, model.id))) throw notFound('Model')
    return publicModel(model)
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
