import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagementScope } from '@pulpo/contracts'

const mocks = vi.hoisted(() => ({ select: vi.fn(), transaction: vi.fn() }))
vi.mock('../database/client.js', () => ({ db: mocks }))
import { registerAdminUsagePayloadRoutes } from './usage-payloads.js'
import { registerManagementRoutes } from '../management/routes.js'
import { AppError } from '../lib/errors.js'

const callId = '00000000-0000-4000-8000-000000000001'
const logId = '00000000-0000-4000-8000-000000000002'
const endpoint = `/api/management/v1/usage/requests/${callId}/payloads`
const now = new Date('2026-09-10T12:00:00Z')
let app: ReturnType<typeof Fastify>
let role: 'admin' | 'user' | null
let scopes: ManagementScope[]
function queryResult(rows: unknown[], onRead?: () => void) {
  const query = { from: () => query, where: () => query, for: () => query, limit: async () => rows, orderBy: async () => { onRead?.(); return rows } }
  return query
}
function seed(policy: { captureDetailedPayloads: boolean; payloadExpiresAt: Date | null }, options: { direct?: boolean; empty?: boolean; onOcrRead?: () => void } = {}) {
  mocks.select
    .mockReturnValueOnce(queryResult(options.direct ? [] : [{ id: callId, requestLogId: logId }]))
    .mockReturnValueOnce(queryResult([{ id: logId, responseId: 'response', createdAt: now, ...policy, requestPayload: options.empty ? null : [{ turn: 1, payload: { input: 'secret' } }], responsePayload: options.empty ? null : { output: 'secret' } }]))
    .mockReturnValueOnce(queryResult(options.empty ? [] : [{ id: 'ocr', status: 'completed', requestPayload: { image: 'secret' }, responsePayload: { text: 'secret' } }], options.onOcrRead))
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now)
  role = 'admin'; scopes = ['usage:read']
  mocks.transaction.mockImplementation(async (callback) => callback({ select: mocks.select }))
  app = Fastify()
  app.setErrorHandler((error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ message: error.message }))
  app.addHook('preHandler', async (request: FastifyRequest) => {
    request.user = role ? { id: 'admin', role, blocked: false } as FastifyRequest['user'] : null
    request.managementTokenId = role ? 'token' : null
    request.managementScopes = scopes
  })
  registerAdminUsagePayloadRoutes(app)
  await registerManagementRoutes(app)
})
afterEach(async () => { await app.close(); vi.useRealTimers(); vi.resetAllMocks() })

describe('detailed payload reads through the management API', () => {
  it.each([false, true])('accepts model-call and direct request-log IDs (direct=%s)', async (direct) => {
    seed({ captureDetailedPayloads: true, payloadExpiresAt: null }, { direct })
    const response = await app.inject(direct ? endpoint.replace(callId, logId) : endpoint)
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toMatchObject({ scope: 'request', modelCallId: direct ? null : callId, requestLogId: logId, available: true, captureActive: true, unavailableReason: null, requestPayload: [{ turn: 1, payload: { input: 'secret' } }], responsePayload: { output: 'secret' }, ocrAttempts: [{ requestPayload: { image: 'secret' }, responsePayload: { text: 'secret' } }] })
  })
  it.each([
    { captureDetailedPayloads: true, payloadExpiresAt: now, reason: 'expired' },
    { captureDetailedPayloads: false, payloadExpiresAt: null, reason: 'not_captured_or_cleared' },
    { captureDetailedPayloads: false, payloadExpiresAt: now, reason: 'expired' },
  ])('withholds stored bodies when $reason', async ({ reason, ...policy }) => {
    seed(policy)
    const response = await app.inject(endpoint)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ available: false, captureActive: false, unavailableReason: reason, requestPayload: null, responsePayload: null, ocrAttempts: [{ status: 'completed', requestPayload: null, responsePayload: null }] })
    expect(response.body).not.toContain('secret')
  })
  it('checks expiry again after reading OCR', async () => {
    seed({ captureDetailedPayloads: true, payloadExpiresAt: new Date(now.getTime() + 1) }, { onOcrRead: () => vi.setSystemTime(now.getTime() + 1) })
    expect((await app.inject(endpoint)).json()).toMatchObject({ available: false, unavailableReason: 'expired', requestPayload: null })
  })
  it('distinguishes enabled capture with no bodies yet', async () => {
    seed({ captureDetailedPayloads: true, payloadExpiresAt: null }, { empty: true })
    expect((await app.inject(endpoint)).json()).toMatchObject({ available: false, captureActive: true, unavailableReason: 'not_yet_captured' })
  })
  it('returns 404 for a missing request and 400 for malformed IDs', async () => {
    mocks.select.mockReturnValue(queryResult([]))
    expect((await app.inject(endpoint)).statusCode).toBe(404)
    mocks.select.mockClear()
    expect((await app.inject(endpoint.replace(callId, 'bad-id'))).statusCode).toBe(400)
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it.each([
    { role: null, scopes: [], status: 401 },
    { role: 'user', scopes: ['usage:read'], status: 403 },
    { role: 'admin', scopes: ['account:read'], status: 403 },
  ] as const)('rejects $role / $scopes before reading bodies', async (identity) => {
    role = identity.role; scopes = [...identity.scopes]
    expect((await app.inject(endpoint)).statusCode).toBe(identity.status)
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it('advertises capability and protects the admin endpoint too', async () => {
    expect((await app.inject('/api/management/v1/info')).json().capabilities).toContain('detailedPayloads')
    role = 'user'
    expect((await app.inject(`/api/admin/usage/requests/${logId}/payloads`)).statusCode).toBe(403)
    expect(mocks.select).not.toHaveBeenCalled()
  })
})
