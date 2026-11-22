import { createHash } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  process.env.WORKSPACE_CONTROLLER_URL = 'http://controller.test'
  process.env.WORKSPACE_CONTROLLER_TOKEN = 'controller-token-'.padEnd(40, 'x')
  return { selects: [] as unknown[][], updates: [] as Array<Record<string, unknown>>, request: vi.fn() }
})

vi.mock('../database/client.js', () => ({
  db: {
    select: vi.fn(() => {
      const builder = { from: () => builder, where: () => builder, limit: async () => mocks.selects.shift() ?? [] }
      return builder
    }),
    update: vi.fn(() => ({ set: (values: Record<string, unknown>) => ({ where: async () => { mocks.updates.push(values) } }) })),
  },
}))
vi.mock('../auth/service.js', () => ({ requireUser: (request: { user: unknown }) => request.user }))
vi.mock('../agent/controller-http.js', () => ({ workspaceControllerRequest: mocks.request }))

import { AppError } from '../lib/errors.js'
import { registerWorkspaceScreenRoutes, touchScreenLease, workspaceScreenFrameId, WORKSPACE_SCREEN_FRAME_MAX_BYTES } from './routes.js'

const chatId = '9db9ea5a-3af7-4b66-9f2a-c179278a0998'
const base = `/api/chats/${chatId}/workspace-screen`
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6, 5])
const frameId = createHash('sha256').update(jpeg).digest('hex').slice(0, 32)
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000)

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const settings = (value: Record<string, unknown> = {}) => [{ key: 'agent', value: { enabled: true, workspaceDesktop: true, ...value } }]
/** A chat with a running workspace whose lease was last used `usedMinutesAgo`, with a 30-minute idle timeout. */
function running(usedMinutesAgo = 5) {
  const lastUsedAt = minutesAgo(usedMinutesAgo)
  mocks.selects = [[{ scopeId: 'scope-1' }], settings(), [{ id: 'lease-row', controllerLeaseId: 'lease-1', lastUsedAt, expiresAt: new Date(lastUsedAt.getTime() + 30 * 60_000) }]]
}

type Upstream = { path: string; method: string; body?: unknown; signal?: AbortSignal }
let upstream: Upstream[]
function daemon(handler: (path: string, init: { method?: string; body?: string; signal?: AbortSignal }) => Response | Promise<Response>) {
  mocks.request.mockImplementation(async (path: string, init: { method?: string; body?: string; signal?: AbortSignal } = {}) => {
    upstream.push({ path, method: init.method ?? 'GET', body: init.body === undefined ? undefined : JSON.parse(init.body), signal: init.signal })
    return handler(path, init)
  })
}

const apps: FastifyInstance[] = []
async function server(): Promise<FastifyInstance> {
  const app = Fastify()
  app.decorateRequest('user', null)
  app.decorateRequest('adminChatAccess', null)
  app.addHook('onRequest', async (request) => {
    request.user = { id: 'user-1', role: 'user' } as never
    if (request.headers['x-test-admin-access']) request.adminChatAccess = { accessId: 'access-1' } as never
  })
  // As in app.ts.
  app.setErrorHandler((error, _request, reply) => error instanceof AppError
    ? reply.code(error.statusCode).send({ error: { message: error.message, type: error.type, code: error.code, param: error.param } })
    : reply.code(500).send({ error: { message: String(error) } }))
  await registerWorkspaceScreenRoutes(app)
  apps.push(app)
  return app
}

beforeEach(() => { mocks.selects = []; mocks.updates = []; mocks.request.mockReset(); upstream = [] })
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

describe('workspace screen access', () => {
  it('is only for the chat\'s owner, never for an admin looking at the chat', async () => {
    const app = await server()
    running()
    const admin = await app.inject({ url: base, headers: { 'x-test-admin-access': '1' } })
    expect(admin.statusCode).toBe(403)
    expect(mocks.request).not.toHaveBeenCalled()

    // Not the user's, deleted, purging or expired: the chat query finds nothing.
    mocks.selects = [[]]
    expect((await app.inject({ url: base })).json()).toMatchObject({ error: { code: 'not_found' } })
    mocks.selects = [[]]
    expect((await app.inject({ method: 'POST', url: `${base}/control`, payload: { held: true } })).statusCode).toBe(404)
    expect((await app.inject({ url: '/api/chats/not-a-chat/workspace-screen' })).statusCode).toBe(404)
  })

  it('is unavailable when the instance has the screen off', async () => {
    const app = await server()
    mocks.selects = [[{ scopeId: 'scope-1' }], settings({ workspaceDesktop: false })]
    expect((await app.inject({ url: base })).json()).toEqual({ state: 'unavailable', width: 1280, height: 800, controlled: false })
    mocks.selects = [[{ scopeId: 'scope-1' }], settings({ workspaceDesktop: false })]
    expect((await app.inject({ url: `${base}/frame` })).json()).toMatchObject({ error: { code: 'workspace_screen_unavailable' } })
    expect(mocks.request).not.toHaveBeenCalled()
  })
})

describe('workspace screen status', () => {
  it('is none without a running workspace, and never starts one', async () => {
    const app = await server()
    mocks.selects = [[{ scopeId: 'scope-1' }], settings(), []]
    expect((await app.inject({ url: base })).json()).toEqual({ state: 'none', width: 1280, height: 800, controlled: false })
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('is ready with whether a viewer holds control', async () => {
    const app = await server()
    running()
    daemon(() => json({ available: true, running: true, width: 1280, height: 800, controlled: true }))
    expect((await app.inject({ url: base })).json()).toEqual({ state: 'ready', width: 1280, height: 800, controlled: true })
    expect(upstream).toEqual([expect.objectContaining({ path: '/v1/leases/lease-1/v1/desktop', method: 'GET' })])
  })

  it('tells an image without a screen from a workspace that is gone', async () => {
    const app = await server()
    const state = async (answer: () => Response | Promise<Response>) => {
      running(); daemon(answer)
      return (await app.inject({ url: base })).json().state
    }
    // An image from before the screen has no such endpoint; a newer one without the desktop says so.
    expect(await state(() => json({ error: 'not_found' }, 404))).toBe('unavailable')
    expect(await state(() => json({ available: false, running: false, width: 1280, height: 800, controlled: false }))).toBe('unavailable')
    // The controller no longer holds the lease, cannot be reached, or the daemon answers nonsense.
    expect(await state(() => json({ error: 'lease_not_found' }, 404))).toBe('none')
    expect(await state(() => { throw new TypeError('fetch failed') })).toBe('none')
    expect(await state(() => json({ error: 'boom' }, 503))).toBe('none')
    expect(await state(() => json({ available: 'yes' }))).toBe('none')
  })

  it('gives up on a daemon that does not answer quickly', async () => {
    const app = await server()
    running()
    let signal: AbortSignal | undefined
    daemon((_path, init) => {
      signal = init.signal
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    expect((await app.inject({ url: base })).json().state).toBe('none')
    expect(signal).toBeInstanceOf(AbortSignal)
  })
})

describe('workspace screen frames', () => {
  it('relay a new frame with its id, and nothing when it did not change', async () => {
    const app = await server()
    running()
    daemon(() => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } }))
    const frame = await app.inject({ url: `${base}/frame?after=${'a'.repeat(32)}&waitMs=8000` })
    expect(frame.statusCode).toBe(200)
    expect(frame.headers['content-type']).toBe('image/jpeg')
    expect(frame.headers['x-pulpo-frame']).toBe(frameId)
    expect(workspaceScreenFrameId(jpeg)).toBe(frameId)
    expect(frame.headers['cache-control']).toBe('no-store')
    expect(frame.rawPayload.equals(jpeg)).toBe(true)
    expect(upstream[0]?.path).toBe(`/v1/leases/lease-1/v1/desktop/frame?after=${'a'.repeat(32)}&waitMs=8000`)

    running()
    daemon(() => new Response(null, { status: 204 }))
    const unchanged = await app.inject({ url: `${base}/frame?after=${frameId}&waitMs=10000` })
    expect(unchanged.statusCode).toBe(204)
    expect(unchanged.headers['x-pulpo-frame']).toBeUndefined()
  })

  it('check the query before reaching the workspace', async () => {
    const app = await server()
    for (const query of ['after=xyz', 'waitMs=10001', 'waitMs=-1']) {
      running()
      expect((await app.inject({ url: `${base}/frame?${query}` })).statusCode).toBe(400)
    }
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('are unavailable without a running workspace with a screen', async () => {
    const app = await server()
    mocks.selects = [[{ scopeId: 'scope-1' }], settings(), []]
    expect((await app.inject({ url: `${base}/frame` })).json()).toMatchObject({ error: { code: 'workspace_screen_unavailable' } })
    for (const answer of [json({ error: 'This workspace has no screen' }, 409), json({ error: 'not_found' }, 404), json({ error: 'lease_not_found' }, 404)]) {
      running(); daemon(() => answer)
      const response = await app.inject({ url: `${base}/frame` })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toMatchObject({ error: { code: 'workspace_screen_unavailable' } })
    }
  })

  it('relay only a JPEG of a bounded size', async () => {
    const app = await server()
    running(); daemon(() => new Response(Buffer.from('<html>not a frame</html>')))
    expect((await app.inject({ url: `${base}/frame` })).statusCode).toBe(502)
    running(); daemon(() => new Response(Buffer.concat([jpeg, Buffer.alloc(WORKSPACE_SCREEN_FRAME_MAX_BYTES)])))
    expect((await app.inject({ url: `${base}/frame` })).json()).toMatchObject({ error: { code: 'workspace_screen_unreachable' } })
  })

  it('stop waiting on the workspace when the viewer goes away', async () => {
    const app = await server()
    running()
    let signal: AbortSignal | undefined
    const asked = new Promise<void>((resolve) => daemon((_path, init) => {
      signal = init.signal
      resolve()
      return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted'))))
    }))
    const address = await app.listen({ port: 0, host: '127.0.0.1' })
    const viewer = new AbortController()
    const request = fetch(`${address}${base}/frame?waitMs=10000`, { signal: viewer.signal }).catch(() => undefined)
    await asked
    expect(signal?.aborted).toBe(false)
    viewer.abort()
    await request
    await vi.waitFor(() => expect(signal?.aborted).toBe(true))
  })
})

describe('workspace screen control and input', () => {
  it('take and give back control', async () => {
    const app = await server()
    running()
    daemon((_path, init) => json({ held: (JSON.parse(String(init.body)) as { held: boolean }).held }))
    const taken = await app.inject({ method: 'POST', url: `${base}/control`, payload: { held: true } })
    expect(taken.json()).toEqual({ held: true })
    expect(upstream[0]).toMatchObject({ path: '/v1/leases/lease-1/v1/desktop/control', method: 'POST', body: { held: true } })

    expect((await app.inject({ method: 'POST', url: `${base}/control`, payload: { held: 'yes' } })).statusCode).toBe(400)
    running(); daemon(() => json({ held: 'maybe' }))
    expect((await app.inject({ method: 'POST', url: `${base}/control`, payload: { held: false } })).statusCode).toBe(502)
  })

  it('forward input with its defaults, and say when control is not held', async () => {
    const app = await server()
    running()
    daemon(() => json({ ok: true }))
    const sent = await app.inject({ method: 'POST', url: `${base}/input`, payload: { events: [{ type: 'click', x: 10, y: 20 }, { type: 'text', text: 'hunter2' }, { type: 'key', keys: 'enter' }] } })
    expect(sent.statusCode).toBe(204)
    expect(upstream[0]).toMatchObject({
      path: '/v1/leases/lease-1/v1/desktop/input', method: 'POST',
      body: { events: [{ type: 'click', x: 10, y: 20, button: 'left', count: 1 }, { type: 'text', text: 'hunter2' }, { type: 'key', keys: 'enter' }] },
    })

    running(); daemon(() => json({ error: 'not_controlled' }, 409))
    const refused = await app.inject({ method: 'POST', url: `${base}/input`, payload: { events: [{ type: 'key', keys: 'enter' }] } })
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toMatchObject({ error: { code: 'workspace_screen_not_controlled' } })
  })

  it('refuse input that is not valid without repeating it', async () => {
    const app = await server()
    const secret = 'correct horse battery staple'
    for (const events of [[], [{ type: 'text', text: secret.repeat(100) }], [{ type: 'click', x: 5_000, y: 0 }], [{ type: 'paste', text: secret }], Array.from({ length: 65 }, () => ({ type: 'key', keys: 'a' }))]) {
      running()
      const response = await app.inject({ method: 'POST', url: `${base}/input`, payload: { events } })
      expect(response.statusCode).toBe(400)
      expect(response.body).not.toContain('horse')
    }
    expect(mocks.request).not.toHaveBeenCalled()
  })
})

describe('watching keeps the workspace', () => {
  it('extends the idle expiry at most every 30 seconds, with the lease\'s own idle timeout', async () => {
    const app = await server()
    running(5)
    daemon(() => new Response(null, { status: 204 }))
    const before = Date.now()
    await app.inject({ url: `${base}/frame` })
    expect(mocks.updates).toHaveLength(1)
    const { lastUsedAt, expiresAt } = mocks.updates[0] as { lastUsedAt: Date; expiresAt: Date }
    expect(lastUsedAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(expiresAt.getTime() - lastUsedAt.getTime()).toBe(30 * 60_000)
    expect(mocks.updates[0]).not.toHaveProperty('hardExpiresAt')

    // Used 10 seconds ago: nothing to do.
    const lastUsed = new Date(Date.now() - 10_000)
    mocks.selects = [[{ scopeId: 'scope-1' }], settings(), [{ id: 'lease-row', controllerLeaseId: 'lease-1', lastUsedAt: lastUsed, expiresAt: new Date(lastUsed.getTime() + 60_000) }]]
    await app.inject({ url: `${base}/frame` })
    expect(mocks.updates).toHaveLength(1)
  })

  it('does not extend a lease the controller no longer holds', async () => {
    const app = await server()
    running(5)
    daemon(() => json({ error: 'lease_not_found' }, 404))
    await app.inject({ url: `${base}/frame` })
    expect(mocks.updates).toEqual([])
  })

  it('follows the throttle on its own clock', async () => {
    const now = Date.now()
    const lease = { id: 'lease-row', controllerLeaseId: 'lease-1', lastUsedAt: new Date(now - 29_000), expiresAt: new Date(now + 60_000) }
    expect(await touchScreenLease(lease, 1_800_000, now)).toBe(false)
    expect(await touchScreenLease(lease, 1_800_000, now + 1_000)).toBe(true)
    // A lease never used before takes the instance's idle timeout.
    expect(await touchScreenLease({ ...lease, lastUsedAt: null, expiresAt: null }, 1_800_000, now)).toBe(true)
    expect((mocks.updates.at(-1) as { expiresAt: Date }).expiresAt.getTime()).toBe(now + 1_800_000)
  })
})
