import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyReply } from 'fastify'
import { db } from '../database/client.js'
import { chats, responses } from '../database/schema.js'
import { newId } from '../lib/ids.js'
import { AppError, notFound } from '../lib/errors.js'
import { createRedis } from '../redis.js'
import { createResponse } from '../responses/service.js'
import { readResponseEvents } from '../responses/events.js'
import { accessibleChatCondition, temporaryChatExpiresAt } from '../chats/temporary.js'
import { createStreamCloser } from './stream-cleanup.js'
import {
  serializeProtocolResponse,
  streamProjector,
  type PublicGenerationRequest,
} from './codecs.js'
import { publicIdempotencyScope, publicRequestFingerprint } from './idempotency.js'

type ApiKeyIdentity = { id: string; userId: string }

async function findIdempotentResponse(input: {
  key: ApiKeyIdentity
  protocol: PublicGenerationRequest['protocol']
  idempotencyKey?: string
  fingerprint: string
}) {
  if (!input.idempotencyKey) return undefined
  const [result] = await db.select({ response: responses })
    .from(responses)
    .innerJoin(chats, eq(chats.id, responses.chatId))
    .where(and(
      eq(responses.userId, input.key.userId),
      eq(responses.idempotencyScope, publicIdempotencyScope(input.key.id, input.protocol)),
      eq(responses.idempotencyKey, input.idempotencyKey),
      isNull(chats.deletedAt),
      accessibleChatCondition(),
    ))
    .limit(1)
  const existing = result?.response
  if (existing?.idempotencyFingerprint && existing.idempotencyFingerprint !== input.fingerprint) {
    throw new AppError(409, 'idempotency_conflict', 'The idempotency key was already used with a different request', 'invalid_request_error')
  }
  return existing
}

export async function waitForTerminalResponse(responseId: string) {
  for (let attempt = 0; attempt < 1_800; attempt += 1) {
    const [row] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
    if (!row) throw notFound('Response')
    if (!['queued', 'in_progress'].includes(row.status)) return row
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Response did not reach a terminal state')
}

async function streamGeneration(
  reply: FastifyReply,
  row: typeof responses.$inferSelect,
  request: PublicGenerationRequest,
): Promise<void> {
  const subscriber = createRedis()
  const projector = streamProjector(request.protocol, row, request.streamIncludeUsage)
  reply.hijack()
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  })
  await subscriber.subscribe('pulpo:response-events', 'pulpo:response-snapshots')
  const close = createStreamCloser(subscriber, reply.raw)
  reply.raw.once('close', close)
  let lastSequence = 0
  let replaying = true
  let finalizing = false
  const buffered: Array<{ channel: string; parsed: Record<string, unknown> }> = []

  const write = (payload: unknown) => {
    if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
  }
  const finish = async () => {
    if (finalizing) return
    finalizing = true
    const [current] = await db.select().from(responses).where(eq(responses.id, row.id)).limit(1)
    if (current) for (const payload of projector.finish(current)) write(payload)
    if (!reply.raw.writableEnded) reply.raw.write('data: [DONE]\n\n')
    close()
  }
  const handle = async (channel: string, parsed: Record<string, unknown>) => {
    if (channel === 'pulpo:response-events') {
      if (parsed.responseId !== row.id || typeof parsed.sequence !== 'number' || parsed.sequence <= lastSequence) return
      lastSequence = parsed.sequence
      for (const payload of projector.project(parsed as never)) write(payload)
      return
    }
    if (parsed.responseId === row.id && typeof parsed.status === 'string' && ['completed', 'failed', 'cancelled', 'incomplete'].includes(parsed.status)) {
      await finish()
    }
  }
  subscriber.on('message', (channel: string, message: string) => {
    const parsed = JSON.parse(message) as Record<string, unknown>
    if (replaying) buffered.push({ channel, parsed })
    else void handle(channel, parsed)
  })

  const replay = await readResponseEvents(row.id, 0)
  for (const event of replay) {
    if (event.sequence <= lastSequence) continue
    lastSequence = event.sequence
    for (const payload of projector.project(event)) write(payload)
  }
  while (buffered.length) {
    const batch = buffered.splice(0).sort((left, right) => Number(left.parsed.sequence ?? Number.MAX_SAFE_INTEGER) - Number(right.parsed.sequence ?? Number.MAX_SAFE_INTEGER))
    for (const message of batch) await handle(message.channel, message.parsed)
  }
  replaying = false
  const [current] = await db.select().from(responses).where(eq(responses.id, row.id)).limit(1)
  if (current && !['queued', 'in_progress'].includes(current.status)) await finish()
}

export async function executePublicGeneration(input: {
  reply: FastifyReply
  key: ApiKeyIdentity
  request: PublicGenerationRequest
  idempotencyKey?: string
}) {
  const fingerprint = publicRequestFingerprint(input.request.fingerprintValue)
  const existing = await findIdempotentResponse({
    key: input.key,
    protocol: input.request.protocol,
    idempotencyKey: input.idempotencyKey,
    fingerprint,
  })
  let created = existing
  if (!created) {
    const chatId = newId()
    await db.insert(chats).values({
      id: chatId,
      userId: input.key.userId,
      modelId: input.request.model,
      title: 'API request',
      temporary: true,
      expiresAt: temporaryChatExpiresAt(),
    })
    try {
      created = await createResponse({
        ownerUserId: input.key.userId,
        chatId,
        apiKeyId: input.key.id,
        idempotencyKey: input.idempotencyKey,
        idempotencyScope: publicIdempotencyScope(input.key.id, input.request.protocol),
        idempotencyFingerprint: fingerprint,
        metadata: input.request.metadata,
        publiclyStored: input.request.publiclyStored,
        input: {
          input: input.request.displayInput,
          modelId: input.request.model,
          executionMode: input.request.background ? 'background' : 'stream',
          maxOutputTokens: input.request.maxOutputTokens,
          presetSelections: {},
          attachmentIds: [],
          agentMode: false,
        },
        rawInput: input.request.rawInput,
        parameters: input.request.parameters,
      })
      if (created.chatId !== chatId) await db.delete(chats).where(eq(chats.id, chatId))
    } catch (error) {
      await db.delete(chats).where(eq(chats.id, chatId))
      const raced = await findIdempotentResponse({
        key: input.key,
        protocol: input.request.protocol,
        idempotencyKey: input.idempotencyKey,
        fingerprint,
      })
      if (!raced) throw error
      created = raced
    }
  }
  if (input.request.stream) return streamGeneration(input.reply, created, input.request)
  if (input.request.background) {
    input.reply.code(202)
    return serializeProtocolResponse(input.request.protocol, created)
  }
  return serializeProtocolResponse(input.request.protocol, await waitForTerminalResponse(created.id))
}
