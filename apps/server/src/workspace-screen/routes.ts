import { createHash } from 'node:crypto'
import { and, eq, gt, isNotNull, isNull, lt, or } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  WORKSPACE_SCREEN_FRAME_HEADER, WORKSPACE_SCREEN_HEIGHT, WORKSPACE_SCREEN_PRESENCE_SUFFIX, WORKSPACE_SCREEN_WIDTH,
  workspaceScreenControlSchema, workspaceScreenFrameQuerySchema, workspaceScreenInputSchema,
  type WorkspaceScreenPresence, type WorkspaceScreenStatus,
} from '@pulpo/contracts'
import { db } from '../database/client.js'
import { agentRuns, applicationSettings, chats, responses, workspaceLeases } from '../database/schema.js'
import { requireUser } from '../auth/service.js'
import { AppError, forbidden, notFound } from '../lib/errors.js'
import { getConfig } from '../config.js'
import { parseAgentSettings } from '../settings/application-settings.js'
import { accessibleChatCondition } from '../chats/temporary.js'
import { workspaceControllerRequest } from '../agent/controller-http.js'
import { announceMeteredUsage, chargeMeteredUsageIn } from '../accounting/service.js'
import { boundedBody } from '../agent/controller.js'
import { detectImageMime } from '../agent/images.js'

/** How long the status waits for the daemon; a viewer asks again soon, so a slow one counts as gone. */
const STATUS_TIMEOUT_MS = 5_000
/** A frame's answer may take its whole wait plus an ordinary request's allowance. */
const FRAME_TIMEOUT_EXTRA_MS = 10_000
const CONTROL_TIMEOUT_MS = 10_000
/** Input is answered once it was carried out; the daemon gives a batch of long texts a minute. */
const INPUT_TIMEOUT_MS = 70_000
/** A full-screen JPEG is a few hundred KB; anything far larger is not a frame. */
export const WORKSPACE_SCREEN_FRAME_MAX_BYTES = 4 * 1_048_576
/** The most often watching extends the workspace's idle expiry; the controller counts every request anyway. */
export const WORKSPACE_SCREEN_LEASE_TOUCH_MS = 30_000
/** 64 events of at most 2,000 characters each, in JSON even when every character is escaped. */
const INPUT_BODY_LIMIT = 1_048_576
/** Having the screen open is paid for a minute at a time, each when it starts. */
export const WORKSPACE_SCREEN_BILLED_MS = 60_000

/*
 * A viewer asks for a frame about five times a second at most and sends input about twenty times
 * a second at most; the limits allow that, and little more, per address.
 */
const statusRoute = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }
const frameRoute = { compress: false as const, config: { rateLimit: { max: 360, timeWindow: '1 minute' } } }
const controlRoute = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }
const inputRoute = { bodyLimit: INPUT_BODY_LIMIT, config: { rateLimit: { max: 1_500, timeWindow: '1 minute' } } }
// Asked when a chat is shown and when its workspace is due to go, not on an interval.
const presenceRoute = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }

const unavailable = () => new AppError(404, 'workspace_screen_unavailable', 'No workspace with a screen is running for this chat')
const unreachable = () => new AppError(502, 'workspace_screen_unreachable', 'The workspace\'s screen could not be reached', 'server_error')
const notControlled = () => new AppError(409, 'workspace_screen_not_controlled', 'Take control of the workspace\'s screen first')

const chatParams = z.object({ chatId: z.uuid() })

// What the daemon answers is the agent's to forge, so it is read as untrusted.
const daemonStatusSchema = z.object({
  available: z.boolean(),
  width: z.number().int().positive().max(10_000).optional(),
  height: z.number().int().positive().max(10_000).optional(),
  controlled: z.boolean().optional(),
})
const daemonControlSchema = z.object({ held: z.boolean() })

interface ScreenLease {
  id: string
  controllerLeaseId: string
  lastUsedAt: Date | null
  expiresAt: Date | null
  hardExpiresAt: Date | null
  /** Up to when the owner has paid for having the screen open. */
  screenBilledUntil: Date | null
}

interface ScreenContext {
  userId: string
  chatId: string
  /** Agent mode is available and the instance gives workspaces a screen. */
  enabled: boolean
  idleTimeoutMs: number
  /** What a minute with the screen open costs; 0 where the instance does not bill for workspaces. */
  pricePerMinuteMicros: number
  /** The chat's current workspace: the ready, unexpired lease of its workspace scope. */
  lease?: ScreenLease
}

/** A validation failure, told without the value that failed: input can be a password being typed. */
function invalid(error: z.ZodError): AppError {
  const issue = error.issues[0]
  return new AppError(400, 'validation_error', issue?.message ?? 'Invalid request', 'invalid_request_error', issue?.path.join('.') || null)
}

/**
 * The signed-in owner of the chat, and the chat's current workspace. An admin looking at another
 * user's chat is refused: the screen can show that user signed in to a site. Never provisions.
 */
async function screenContext(request: FastifyRequest): Promise<ScreenContext> {
  if (request.adminChatAccess) throw forbidden('The workspace screen is unavailable during admin chat access')
  const user = requireUser(request)
  const params = chatParams.safeParse(request.params)
  if (!params.success) throw notFound('Chat')
  const { chatId } = params.data
  const now = new Date()
  const [chat] = await db.select({ scopeId: chats.workspaceScopeId }).from(chats).where(and(
    eq(chats.id, chatId), eq(chats.userId, user.id), isNull(chats.deletedAt), isNull(chats.purgeStartedAt), accessibleChatCondition(now),
  )).limit(1)
  if (!chat) throw notFound('Chat')
  const [settingsRow] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'agent')).limit(1)
  const settings = parseAgentSettings(settingsRow?.value)
  const config = getConfig()
  const enabled = settings.enabled && settings.workspaceDesktop && Boolean(config.WORKSPACE_CONTROLLER_URL && config.WORKSPACE_CONTROLLER_TOKEN)
  const idleTimeoutMs = settings.idleTimeoutSeconds * 1000
  const pricePerMinuteMicros = settings.billWorkspaces ? settings.workspacePricePerMinuteMicros : 0
  const context = { userId: user.id, chatId, enabled, idleTimeoutMs, pricePerMinuteMicros }
  if (!enabled) return context
  const [lease] = await db.select({
    id: workspaceLeases.id, controllerLeaseId: workspaceLeases.controllerLeaseId, lastUsedAt: workspaceLeases.lastUsedAt, expiresAt: workspaceLeases.expiresAt,
    hardExpiresAt: workspaceLeases.hardExpiresAt, screenBilledUntil: workspaceLeases.screenBilledUntil,
  }).from(workspaceLeases).where(and(
    eq(workspaceLeases.workspaceScopeId, chat.scopeId), eq(workspaceLeases.chatId, chatId), eq(workspaceLeases.userId, user.id),
    eq(workspaceLeases.status, 'ready'), isNotNull(workspaceLeases.controllerLeaseId),
    or(isNull(workspaceLeases.expiresAt), gt(workspaceLeases.expiresAt, now)),
    or(isNull(workspaceLeases.hardExpiresAt), gt(workspaceLeases.hardExpiresAt, now)),
  )).limit(1)
  return { ...context, ...(lease?.controllerLeaseId ? { lease: { ...lease, controllerLeaseId: lease.controllerLeaseId } } : {}) }
}

/** The workspace for a request that needs its screen. */
async function screenLease(request: FastifyRequest): Promise<ScreenContext & { lease: ScreenLease }> {
  const context = await screenContext(request)
  if (!context.enabled || !context.lease) throw unavailable()
  return { ...context, lease: context.lease }
}

/**
 * Charges the owner for having the screen open, a minute at a time and each when it starts, on
 * instances that bill for workspaces. A reply that has the workspace pays for it itself (from when
 * it has it until it ends), so nothing is charged while one does; and with nobody watching no
 * request comes, so an idle workspace costs nothing. The lease remembers up to when is paid. The
 * request that finds that passed locks the lease row, charges and writes the new time in one
 * transaction: requests arriving together wait on the lock and find the minute paid, or, when the
 * user cannot pay, each gets the accounting error (402 `insufficient_balance`) and none is carried
 * out. One transaction, so a burst of requests never holds two connections apiece.
 */
export async function chargeScreenTime(context: Pick<ScreenContext, 'userId' | 'chatId' | 'pricePerMinuteMicros'> & { lease: ScreenLease }, now = Date.now()): Promise<boolean> {
  const { lease, pricePerMinuteMicros } = context
  if (pricePerMinuteMicros <= 0) return false
  if (lease.screenBilledUntil && lease.screenBilledUntil.getTime() > now) return false
  // A reply pays once its run has this workspace; one that is queued, or never uses it, does not.
  const [paying] = await db.select({ id: agentRuns.id }).from(agentRuns).innerJoin(responses, eq(responses.id, agentRuns.responseId))
    .where(and(eq(agentRuns.workspaceLeaseId, lease.id), eq(agentRuns.status, 'running'), eq(responses.status, 'in_progress'))).limit(1)
  if (paying) return false
  const charged = await db.transaction(async (tx) => {
    const [current] = await tx.select({ screenBilledUntil: workspaceLeases.screenBilledUntil }).from(workspaceLeases)
      .where(and(eq(workspaceLeases.id, lease.id), eq(workspaceLeases.status, 'ready'))).for('update')
    // Gone meanwhile (the request finds that out next), or paid by the request that held the lock before this one.
    if (!current || (current.screenBilledUntil && current.screenBilledUntil.getTime() > now)) return null
    const changes = await chargeMeteredUsageIn(tx, {
      userId: context.userId, costMicros: pricePerMinuteMicros, type: 'workspace_screen',
      metadata: { chatId: context.chatId, workspaceLeaseId: lease.id, minutes: 1, pricePerMinuteMicros },
    })
    await tx.update(workspaceLeases).set({ screenBilledUntil: new Date(now + WORKSPACE_SCREEN_BILLED_MS) }).where(eq(workspaceLeases.id, lease.id))
    return changes
  })
  if (!charged) return false
  // After the commit; telling clients must not undo a charge that went through.
  await announceMeteredUsage(charged).catch((error: unknown) => {
    console.warn('Workspace screen charge was not announced', { leaseId: lease.id, error: error instanceof Error ? error.message : String(error) })
  })
  return true
}

/**
 * Watching counts as using the workspace: its idle expiry moves on, as after an agent operation,
 * but at most every `WORKSPACE_SCREEN_LEASE_TOUCH_MS`. The controller moves its own idle clock on
 * every request it relays, so the two keep agreeing that the workspace is alive. The hard timeout
 * never moves.
 */
export async function touchScreenLease(lease: ScreenLease, idleTimeoutMs: number, now = Date.now()): Promise<boolean> {
  if (lease.lastUsedAt && now - lease.lastUsedAt.getTime() < WORKSPACE_SCREEN_LEASE_TOUCH_MS) return false
  // The lease keeps the idle timeout it was given (as `WorkspaceManager` does when it reuses one).
  const idleMs = lease.expiresAt && lease.lastUsedAt ? Math.max(60_000, lease.expiresAt.getTime() - lease.lastUsedAt.getTime()) : idleTimeoutMs
  await db.update(workspaceLeases).set({ lastUsedAt: new Date(now), expiresAt: new Date(now + idleMs), updatedAt: new Date(now) }).where(and(
    eq(workspaceLeases.id, lease.id), eq(workspaceLeases.status, 'ready'),
    or(isNull(workspaceLeases.lastUsedAt), lt(workspaceLeases.lastUsedAt, new Date(now - WORKSPACE_SCREEN_LEASE_TOUCH_MS))),
  ))
  return true
}

type DaemonAnswer = { kind: 'gone' } | { kind: 'answered'; response: Response }

/**
 * One request to the workspace daemon's screen endpoints, through the controller. `gone` is a lease
 * the controller no longer holds (the workspace was removed); anything the daemon answers, the
 * lease's use is noted.
 */
async function daemonRequest(lease: ScreenLease, idleTimeoutMs: number, path: string, init: { method?: string; body?: string; signal: AbortSignal }): Promise<DaemonAnswer> {
  const response = await workspaceControllerRequest(`/v1/leases/${encodeURIComponent(lease.controllerLeaseId)}/v1/desktop${path}`, {
    method: init.method ?? 'GET', signal: init.signal,
    ...(init.body !== undefined ? { body: init.body, headers: { 'content-type': 'application/json' } } : {}),
  })
  if (response.status === 404 && await errorCode(response.clone()) === 'lease_not_found') {
    await response.body?.cancel().catch(() => undefined)
    return { kind: 'gone' }
  }
  await touchScreenLease(lease, idleTimeoutMs).catch((error: unknown) => {
    console.warn('Workspace lease use was not recorded', { leaseId: lease.id, error: error instanceof Error ? error.message : String(error) })
  })
  return { kind: 'answered', response }
}

/** The `error` of a JSON error body, the way the controller and the daemon write them. */
async function errorCode(response: Response): Promise<string | undefined> {
  try {
    const body = await boundedBody(response, 16_384, () => new Error('Error body is too large'))
    const error = (JSON.parse(Buffer.from(body).toString('utf8')) as { error?: unknown }).error
    return typeof error === 'string' ? error : undefined
  } catch { return undefined }
}

async function readJson(response: Response): Promise<unknown> {
  try { return JSON.parse(Buffer.from(await boundedBody(response, 16_384, () => new Error('Body is too large'))).toString('utf8')) } catch { return undefined }
}

/** Requests that did not reach the daemon (a timeout, the controller down) are reported as one. */
async function reaching<T>(work: () => Promise<T>): Promise<T> {
  try { return await work() } catch (error) {
    if (error instanceof AppError) throw error
    throw unreachable()
  }
}

/** The id of a frame: the first 32 hex characters of the SHA-256 of its bytes, as the daemon computes it. */
export function workspaceScreenFrameId(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 32)
}

/**
 * The screen of the chat's current cloud workspace, for its owner to watch and take over. The
 * daemon in the workspace holds the picture and who has control; these routes check who asks,
 * find the workspace, and relay. Watching counts as use: it keeps the workspace from idling out
 * (up to its hard timeout) and, where workspaces are billed, is charged by the minute. Input bodies
 * may carry a password being typed: they are never logged, and no error here repeats them.
 */
export async function registerWorkspaceScreenRoutes(app: FastifyInstance): Promise<void> {
  const base = '/api/chats/:chatId/workspace-screen'

  app.get(base, statusRoute, async (request): Promise<WorkspaceScreenStatus> => {
    const context = await screenContext(request)
    const status = (state: WorkspaceScreenStatus['state'], details: Partial<WorkspaceScreenStatus> = {}): WorkspaceScreenStatus => ({
      state, width: WORKSPACE_SCREEN_WIDTH, height: WORKSPACE_SCREEN_HEIGHT, controlled: false, ...details,
    })
    if (!context.enabled) return status('unavailable')
    if (!context.lease) return status('none')
    let answer: DaemonAnswer
    try { answer = await daemonRequest(context.lease, context.idleTimeoutMs, '', { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) }) } catch {
      return status('none')
    }
    if (answer.kind === 'gone') return status('none')
    const { response } = answer
    // An image from before the screen has no such endpoint.
    if (response.status === 404) { await response.body?.cancel().catch(() => undefined); return status('unavailable') }
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); return status('none') }
    const parsed = daemonStatusSchema.safeParse(await readJson(response))
    if (!parsed.success) return status('none')
    if (!parsed.data.available) return status('unavailable')
    return status('ready', {
      ...(parsed.data.width && parsed.data.height ? { width: parsed.data.width, height: parsed.data.height } : {}),
      controlled: parsed.data.controlled ?? false,
      ...(context.pricePerMinuteMicros > 0 ? { pricePerMinuteMicros: context.pricePerMinuteMicros } : {}),
    })
  })

  // Whether the workspace is still there, from the lease alone: nothing is asked of the workspace,
  // so knowing costs nothing and does not keep it alive.
  app.get(`${base}${WORKSPACE_SCREEN_PRESENCE_SUFFIX}`, presenceRoute, async (request): Promise<WorkspaceScreenPresence> => {
    const context = await screenContext(request)
    if (!context.enabled || !context.lease) return { live: false, expiresAt: null }
    const ends = [context.lease.expiresAt, context.lease.hardExpiresAt].flatMap((date) => date ? [date.getTime()] : [])
    return { live: true, expiresAt: ends.length ? new Date(Math.min(...ends)).toISOString() : null }
  })

  app.get(`${base}/frame`, frameRoute, async (request, reply) => {
    const query = workspaceScreenFrameQuerySchema.safeParse(request.query)
    if (!query.success) throw invalid(query.error)
    const context = await screenLease(request)
    const { lease, idleTimeoutMs } = context
    await chargeScreenTime(context)
    const search = new URLSearchParams()
    if (query.data.after) search.set('after', query.data.after)
    if (query.data.waitMs !== undefined) search.set('waitMs', String(query.data.waitMs))
    // A viewer that goes away stops the long-poll, so the daemon is not left answering nobody.
    const upstream = new AbortController()
    const left = () => { if (!reply.raw.writableFinished) upstream.abort() }
    reply.raw.once('close', left)
    const timeout = setTimeout(() => upstream.abort(), (query.data.waitMs ?? 0) + FRAME_TIMEOUT_EXTRA_MS)
    try {
      const frame = await reaching(async () => {
        const answer = await daemonRequest(lease, idleTimeoutMs, `/frame${search.size ? `?${search}` : ''}`, { signal: upstream.signal })
        if (answer.kind === 'gone') throw unavailable()
        const { response } = answer
        if (response.status === 204) { await response.body?.cancel().catch(() => undefined); return null }
        // 409: the image has no screen; 404: it predates the screen.
        if (response.status === 404 || response.status === 409) { await response.body?.cancel().catch(() => undefined); throw unavailable() }
        if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw unreachable() }
        const bytes = await boundedBody(response, WORKSPACE_SCREEN_FRAME_MAX_BYTES, unreachable)
        if (detectImageMime(bytes) !== 'image/jpeg') throw unreachable()
        return bytes
      })
      reply.header('cache-control', 'no-store')
      if (!frame) return reply.code(204).send()
      return reply.header('content-type', 'image/jpeg').header(WORKSPACE_SCREEN_FRAME_HEADER, workspaceScreenFrameId(frame)).send(Buffer.from(frame))
    } finally {
      clearTimeout(timeout)
      reply.raw.off('close', left)
    }
  })

  app.post(`${base}/control`, controlRoute, async (request) => {
    const body = workspaceScreenControlSchema.safeParse(request.body)
    if (!body.success) throw invalid(body.error)
    const context = await screenLease(request)
    const { lease, idleTimeoutMs } = context
    // Giving control back is never refused for want of credit.
    if (body.data.held) await chargeScreenTime(context)
    return reaching(async () => {
      const answer = await daemonRequest(lease, idleTimeoutMs, '/control', { method: 'POST', body: JSON.stringify(body.data), signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS) })
      if (answer.kind === 'gone') throw unavailable()
      const { response } = answer
      if (response.status === 404 || response.status === 409) { await response.body?.cancel().catch(() => undefined); throw unavailable() }
      if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw unreachable() }
      const parsed = daemonControlSchema.safeParse(await readJson(response))
      if (!parsed.success) throw unreachable()
      return { held: parsed.data.held }
    })
  })

  app.post(`${base}/input`, inputRoute, async (request, reply) => {
    const body = workspaceScreenInputSchema.safeParse(request.body)
    if (!body.success) throw invalid(body.error)
    const context = await screenLease(request)
    const { lease, idleTimeoutMs } = context
    await chargeScreenTime(context)
    await reaching(async () => {
      const answer = await daemonRequest(lease, idleTimeoutMs, '/input', { method: 'POST', body: JSON.stringify(body.data), signal: AbortSignal.timeout(INPUT_TIMEOUT_MS) })
      if (answer.kind === 'gone') throw unavailable()
      const { response } = answer
      if (response.status === 409) {
        if (await errorCode(response) === 'not_controlled') throw notControlled()
        throw unavailable()
      }
      await response.body?.cancel().catch(() => undefined)
      if (response.status === 404) throw unavailable()
      if (!response.ok) throw unreachable()
    })
    return reply.code(204).send()
  })
}
