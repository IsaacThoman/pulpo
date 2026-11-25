import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import type { FastifyReply } from 'fastify'
import type { z } from 'zod'
import { userModelEligibility } from '../catalog/user-models.js'
import { accessibleChatCondition, temporaryChatExpiresAt } from '../chats/temporary.js'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { applicationSettings, chats, labs, models, providerConnections, responses, userPreferences } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { requestCancellation } from '../responses/events.js'
import { createResponse, resolveResponseGeneration } from '../responses/service.js'
import { parseAgentSettings, parseAuthSettings } from '../settings/application-settings.js'
import { preferencesWithModelDefaults } from '../settings/model-preferences.js'
import { withNewAccountModelDefaults } from '../settings/new-account-defaults.js'
import { searchQuickAnswerScope, type quickAnswerInput } from './quick-answer-policy.js'

const pollIntervalMs = 750
const heartbeatMs = 12_000
const streamLifetimeMs = 3 * 60_000
const maximumAnswerLength = 24_000
const inFlight = new Map<string, { fingerprint: string; result: Promise<QuickAnswerStart> }>()

type QuickAnswerInput = z.infer<typeof quickAnswerInput>
type QuickAnswerStart = { responseId: string; chatId: string; modelName: string }

async function resolveQuickAnswerModel(userId: string) {
  const config = getConfig()
  const unavailable = () => new AppError(409, 'quick_answer_agent_unavailable', 'Enable Pulpo Agent to use Quick Answer.')
  if (!config.WORKSPACE_CONTROLLER_URL || !config.WORKSPACE_CONTROLLER_TOKEN) throw unavailable()
  const [[preferences], settings] = await Promise.all([
    db.select({ values: userPreferences.values }).from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1),
    db.select({ key: applicationSettings.key, value: applicationSettings.value }).from(applicationSettings)
      .where(sql`${applicationSettings.key} in ('agent', 'auth')`),
  ])
  const byKey = new Map(settings.map(row => [row.key, row.value]))
  if (!parseAgentSettings(byKey.get('agent')).enabled) throw unavailable()
  const { values, followedModelDefaults } = withNewAccountModelDefaults(
    preferencesWithModelDefaults(preferences?.values as Record<string, unknown> | undefined), parseAuthSettings(byKey.get('auth')),
  )
  const requestedModel = typeof values.defaultModelId === 'string' ? values.defaultModelId : undefined
  const { condition } = await userModelEligibility(userId)
  const lookup = (id?: string) => db.select({ id: models.id, name: models.name, agentEnabled: models.agentEnabled }).from(models)
    .leftJoin(labs, eq(models.labId, labs.id)).innerJoin(providerConnections, eq(models.providerConnectionId, providerConnections.id))
    .where(and(condition, id ? eq(models.id, id) : undefined))
    .orderBy(sql`${labs.sortOrder} asc nulls last`, asc(models.sortOrder), asc(models.createdAt)).limit(1)
  let model = requestedModel ? (await lookup(requestedModel))[0] : undefined
  if (!model && (!requestedModel || followedModelDefaults.defaultModelId)) model = (await lookup())[0]
  if (!model) throw new AppError(409, 'quick_answer_default_model_unavailable', 'Choose an available default model in Pulpo to use Quick Answer.')
  const notAgentCapable = () => new AppError(409, 'quick_answer_model_not_agent_capable', 'Your default model doesn’t support Pulpo Agent. Choose an agent-enabled default model in Pulpo.')
  if (!model.agentEnabled) throw notAgentCapable()
  const resolved = await resolveResponseGeneration(model.id, {})
  const effective = resolved.effectiveModelId === model.id ? model : (await lookup(resolved.effectiveModelId))[0]
  if (!effective?.agentEnabled) throw notAgentCapable()
  return { id: model.id, name: effective.name }
}

export async function quickAnswerCapability(userId: string) {
  try {
    const model = await resolveQuickAnswerModel(userId)
    return { modelName: model.name }
  } catch (error) {
    if (error instanceof AppError) return
    throw error
  }
}

async function readQuickAnswer(userId: string, identity: SQL) {
  const [row] = await db.select({
    id: responses.id, chatId: chats.id, modelName: models.name, output: responses.output, status: responses.status,
    fingerprint: responses.idempotencyFingerprint,
  }).from(responses).innerJoin(chats, eq(chats.id, responses.chatId)).innerJoin(models, eq(models.id, responses.modelId))
    .where(and(
      identity, eq(responses.userId, userId), eq(chats.userId, userId),
      eq(responses.agentMode, true), eq(responses.idempotencyScope, searchQuickAnswerScope),
      isNull(chats.deletedAt), isNull(chats.purgeStartedAt), isNull(responses.deletedAt), accessibleChatCondition(),
    )).limit(1)
  return row
}

function requestConflict() {
  return new AppError(409, 'idempotency_conflict', 'This Quick Answer request ID was already used for another question.')
}

async function admitQuickAnswer(userId: string, input: QuickAnswerInput, fingerprint: string, requestReceivedAt?: Date | null): Promise<QuickAnswerStart> {
  const recover = async () => {
    const existing = await readQuickAnswer(userId, eq(responses.idempotencyKey, input.requestId))
    if (!existing) return
    if (existing.fingerprint !== fingerprint) throw requestConflict()
    return { responseId: existing.id, chatId: existing.chatId, modelName: existing.modelName }
  }
  const existing = await recover()
  if (existing) return existing
  const model = await resolveQuickAnswerModel(userId)
  const chatId = newId()
  await db.insert(chats).values({
    id: chatId, userId, modelId: model.id, title: 'Quick Answer', temporary: true, expiresAt: temporaryChatExpiresAt(),
    fileScopeIds: [], fileScopeAccess: {}, filesBrowseAllowed: false, fileChangeMode: 'read',
  })
  try {
    const created = await createResponse({
      requestReceivedAt, ownerUserId: userId, chatId, parentResponseId: null, publiclyStored: false,
      idempotencyScope: searchQuickAnswerScope, idempotencyKey: input.requestId, idempotencyFingerprint: fingerprint,
      client: { platform: 'web', version: null, features: [] },
      input: { input: input.query, modelId: model.id, presetSelections: {}, attachmentIds: [], agentMode: true, executionMode: 'stream', maxOutputTokens: 1200 },
    })
    if (created.chatId === chatId) return { responseId: created.id, chatId, modelName: model.name }
  } catch (error) {
    await db.delete(chats).where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    const raced = await recover()
    if (raced) return raced
    throw error
  }
  await db.delete(chats).where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
  const raced = await recover()
  if (raced) return raced
  throw new AppError(409, 'quick_answer_admission_conflict', 'Quick Answer couldn’t be started. Try again.')
}

export async function startQuickAnswer(userId: string, input: QuickAnswerInput, requestReceivedAt?: Date | null): Promise<QuickAnswerStart> {
  const fingerprint = createHash('sha256').update(input.query).digest('hex')
  const key = `${userId}:${input.requestId}`
  const pending = inFlight.get(key)
  if (pending) {
    if (pending.fingerprint !== fingerprint) throw requestConflict()
    return pending.result
  }
  const result = admitQuickAnswer(userId, input, fingerprint, requestReceivedAt).finally(() => inFlight.delete(key))
  inFlight.set(key, { fingerprint, result })
  return result
}

function activeAnswer(status: string) {
  return status === 'queued' || status === 'in_progress'
}

export async function cancelQuickAnswer(userId: string, responseId: string) {
  const response = await readQuickAnswer(userId, eq(responses.id, responseId))
  if (!response) throw notFound('Quick Answer')
  if (!activeAnswer(response.status)) return
  const accepted = await Promise.race([
    requestCancellation(responseId).then(() => true),
    delay(2_000, false, { ref: false }),
  ]).catch(() => false)
  if (!accepted) throw new AppError(503, 'quick_answer_cancel_unavailable', 'Couldn’t stop Quick Answer. Try again.', 'server_error')
}

export function quickAnswerText(output: unknown): string {
  if (!Array.isArray(output)) return ''
  const text: string[] = []
  let length = 0
  for (const item of output) {
    if (item?.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content)) continue
    const part = (item.content as Array<{ type?: string; text?: unknown } | null>)
      .flatMap(value => value?.type === 'output_text' && typeof value.text === 'string' ? [value.text] : []).join('')
    if (part) {
      const snippet = part.slice(0, maximumAnswerLength - length).replace(/[\uD800-\uDBFF]$/, '')
      text.push(snippet)
      length += snippet.length + 2
      if (length >= maximumAnswerLength) break
    }
  }
  return text.join('\n\n')
}

type QuickAnswerFrame = { type: 'text'; text: string } | { type: 'done' } | { type: 'error'; message: string; retryable?: true }
function frame(payload: QuickAnswerFrame) {
  return `data: ${JSON.stringify(payload)}\n\n`
}

export async function streamQuickAnswer(reply: FastifyReply, userId: string, responseId: string) {
  const load = () => readQuickAnswer(userId, eq(responses.id, responseId))
  const first = await load()
  if (!first) throw notFound('Quick Answer')
  const disconnect = new AbortController()
  const close = () => disconnect.abort()
  reply.raw.once('close', close)
  if (reply.raw.destroyed) close()
  const timeLimit = AbortSignal.timeout(streamLifetimeMs)
  const signal = AbortSignal.any([disconnect.signal, timeLimit])

  async function* events() {
    let row: Awaited<ReturnType<typeof load>> = first
    let sent = ''
    let lastPing = Date.now()
    try {
      yield ': connected\n\n'
      while (!signal.aborted) {
        if (!row) {
          yield frame({ type: 'error', message: 'This Quick Answer is no longer available.' })
          return
        }
        const text = quickAnswerText(row.output)
        if (text.startsWith(sent) && text.length > sent.length) {
          for (let offset = sent.length; offset < text.length;) {
            const chunk = text.slice(offset, offset + 4_096).replace(/[\uD800-\uDBFF]$/, '')
            yield frame({ type: 'text', text: chunk })
            offset += chunk.length
          }
          sent = text
          lastPing = Date.now()
        }
        if (!activeAnswer(row.status)) {
          if ((row.status === 'completed' || row.status === 'incomplete') && sent.trim() && text.startsWith(sent)) yield frame({ type: 'done' })
          else yield frame({ type: 'error', message: row.status === 'cancelled' ? 'Quick Answer was stopped.' : 'Pulpo couldn’t complete this Quick Answer.' })
          return
        }
        if (Date.now() - lastPing >= heartbeatMs) {
          yield ': keep-alive\n\n'
          lastPing = Date.now()
        }
        await delay(pollIntervalMs, undefined, { signal })
        row = await load()
      }
    } catch {
      if (!signal.aborted) yield frame({ type: 'error', message: 'Quick Answer temporarily lost its connection.', retryable: true })
    } finally {
      reply.raw.off('close', close)
    }
    if (timeLimit.aborted && !disconnect.signal.aborted) {
      yield frame({ type: 'error', message: 'Quick Answer is still running. Reconnect to check its status.', retryable: true })
    }
  }
  return reply.header('content-type', 'text/event-stream; charset=utf-8')
    .header('cache-control', 'no-store, no-transform').header('x-accel-buffering', 'no')
    .send(Readable.from(events(), { objectMode: false }))
}
