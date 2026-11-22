import { once } from 'node:events'
import type { Server } from 'node:http'
import { mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HELD, NO_SCREEN } from './desktop.js'
import { frameId } from './desktop-screen.js'
import { alive, fakeDesktop, until, type FakeDesktop } from './desktop.fixture.js'

// The daemon starts on import, so it runs here in-process against a scratch root and a fake pulpo-desktop.
const token = 'desktop-test-token-'.padEnd(40, 'x')
let root: string
let fake: FakeDesktop
let base: string
let daemon: { server: Server; relayServer: Server; desktop: { shutdown: () => void } }

type Operation = { id: string; status: string; output: string; error?: string; details?: { result?: any } }

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pulpo-daemon-desktop-'))
  fake = await fakeDesktop({ frames: ['the screen'] })
  Object.assign(process.env, {
    PULPO_WORKSPACE_TOKEN: token, PORT: '0', PULPO_WORKSPACE_ROOT: root, PULPO_RELAY_SOCKET: join(root, 'relay.sock'),
    PULPO_WORKSPACE_TOOL_OUTPUT_DIR: join(root, 'tool-output'),
    PULPO_DESKTOP_COMMAND: fake.command, PULPO_DESKTOP_VERSION_FILE: fake.versionFile, PULPO_DESKTOP_IMAGE_DIR: fake.imageDir,
  })
  daemon = await import('./index.js')
  if (!daemon.server.listening) await once(daemon.server, 'listening')
  base = `http://127.0.0.1:${(daemon.server.address() as import('node:net').AddressInfo).port}`
})

afterAll(async () => {
  daemon.desktop.shutdown()
  daemon.server.closeAllConnections(); daemon.relayServer.closeAllConnections()
  await Promise.all([daemon.server, daemon.relayServer].map((server) => new Promise((resolve) => server.close(resolve))))
  await rm(root, { recursive: true, force: true })
  await fake.remove()
})

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; type: string | null; body: any }> {
  const response = await fetch(`${base}${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const type = response.headers.get('content-type')
  const bytes = Buffer.from(await response.arrayBuffer())
  return { status: response.status, type, body: type === 'application/json' ? JSON.parse(bytes.toString('utf8')) : bytes }
}

async function finished(id: string): Promise<Operation> {
  for (;;) {
    const { body } = await api('GET', `/v1/operations/${id}?waitMs=5000`)
    if (body.status !== 'running') return body as Operation
  }
}

async function operation(type: string, args: Record<string, unknown>, id = randomUUID()): Promise<Operation> {
  await api('POST', '/v1/operations', { id, type, args })
  return finished(id)
}

const helperCalls = async (method: string) => (await fake.calls()).filter((call) => call.command === 'helper' && call.method === method)

describe('workspace daemon screen operations', () => {
  it('lists apps and shows a window as an operation', async () => {
    const listed = await operation('app_list', {})
    expect(listed).toMatchObject({ status: 'completed', output: "Apps with a window open on the workspace's screen: Chromium, XTerm." })
    expect(listed.details!.result.apps[0]).toEqual({ name: 'Chromium', allowed: true, frontmost: true, windows: ['Example Domain'] })
    const shown = await operation('app_act', { app: 'chromium', action: { type: 'view' } })
    expect(shown.status).toBe('completed')
    expect(shown.details!.result).toMatchObject({ app: 'Chromium', window: 'Example Domain', image: { mimeType: 'image/jpeg', width: 1280, height: 800, sizeBytes: 100 }, elements: [], truncated: false })
    // The server reads the picture right away through the existing images route.
    const picture = await api('GET', `/v1/images?path=${encodeURIComponent(shown.details!.result.image.path)}`)
    expect(picture.status).toBe(200)
    expect(picture.body).toHaveLength(100)
  })

  it('never does one action twice for a repeated request', async () => {
    await operation('app_act', { app: 'Chromium', action: { type: 'view' } })
    const id = randomUUID()
    const args = { app: 'Chromium', action: { type: 'click', x: 1, y: 2, button: 'left', count: 1 } }
    const before = (await helperCalls('act')).length
    const first = await operation('app_act', args, id)
    const again = await api('POST', '/v1/operations', { id, type: 'app_act', args })
    expect(again.body).toMatchObject({ id, status: 'completed', details: first.details })
    expect((await helperCalls('act')).length).toBe(before + 1)
  })

  it('reports what the agent did wrong as the operation error', async () => {
    expect(await operation('app_act', { app: 'Gimp', action: { type: 'view' } })).toMatchObject({ status: 'failed', error: expect.stringMatching(/^No app named "Gimp"/) })
    expect(await operation('app_act', { app: 'Chromium', action: { type: 'click' } })).toMatchObject({ status: 'failed', error: 'Invalid app action: name an element or give both x and y.' })
  })

  it('stops the helper when a running action is cancelled', async () => {
    await operation('app_act', { app: 'Chromium', action: { type: 'view' } })
    await fake.set({ actDelayMs: 10_000 })
    const id = randomUUID()
    const before = (await helperCalls('act')).length
    await api('POST', '/v1/operations', { id, type: 'app_act', args: { app: 'Chromium', action: { type: 'type', text: 'x'.repeat(2_000) } } })
    await until(async () => (await helperCalls('act')).length > before)
    const helper = (await helperCalls('act')).at(-1)!
    expect((await api('POST', `/v1/operations/${id}/cancel`)).status).toBe(202)
    expect(await finished(id)).toMatchObject({ status: 'cancelled' })
    await until(() => !alive(helper.pid))
    await fake.set({ actDelayMs: 0 })
    expect((await operation('app_list', {})).status).toBe('completed')
  })
})

describe('workspace daemon screen routes', () => {
  it('reports the screen without starting it', async () => {
    const before = (await fake.calls()).filter((call) => call.command !== 'status').length
    expect(await api('GET', '/v1/desktop')).toMatchObject({ status: 200, body: { available: true, running: true, width: 1280, height: 800, controlled: false } })
    expect((await fake.calls()).filter((call) => call.command !== 'status').length).toBe(before)
  })

  it('serves the latest frame, and 204 when it did not change', async () => {
    const frame = await api('GET', '/v1/desktop/frame')
    expect(frame).toMatchObject({ status: 200, type: 'image/jpeg' })
    expect(frame.body.toString()).toBe('the screen')
    const id = frameId(frame.body)
    const unchanged = await api('GET', `/v1/desktop/frame?after=${id}&waitMs=100`)
    expect(unchanged.status).toBe(204)
    expect(unchanged.body).toHaveLength(0)
    expect((await api('GET', '/v1/desktop/frame?after=nope')).status).toBe(400)
  })

  it('takes input only while the owner holds control, and refuses the agent meanwhile', async () => {
    const events = { events: [{ type: 'click', x: 100, y: 100, button: 'left', count: 1 }, { type: 'text', text: 'secret' }] }
    expect(await api('POST', '/v1/desktop/input', events)).toMatchObject({ status: 409, body: { error: 'not_controlled' } })
    expect(await api('POST', '/v1/desktop/control', { held: true })).toMatchObject({ status: 200, body: { held: true } })
    expect((await api('GET', '/v1/desktop')).body.controlled).toBe(true)
    expect(await api('POST', '/v1/desktop/input', events)).toMatchObject({ status: 200, body: { ok: true } })
    expect((await helperCalls('input')).at(-1)!.params).toEqual(events)
    expect(await api('POST', '/v1/desktop/input', { events: [{ type: 'move', x: 2_000, y: 0 }] })).toMatchObject({ status: 400, body: { error: 'Invalid input: event 1 needs x from 0 to 1280.' } })
    expect(await operation('app_act', { app: 'Chromium', action: { type: 'key', keys: 'enter' } })).toMatchObject({ status: 'failed', error: HELD })
    expect((await operation('app_act', { app: 'Chromium', action: { type: 'view' } })).status).toBe('completed')
    expect(await api('POST', '/v1/desktop/control', { held: false })).toMatchObject({ status: 200, body: { held: false } })
    expect((await api('POST', '/v1/desktop/control', {})).status).toBe(400)
    expect((await operation('app_act', { app: 'Chromium', action: { type: 'key', keys: 'enter' } })).status).toBe('completed')
  })

  it('answers politely on an image without a screen', async () => {
    await rename(fake.versionFile, `${fake.versionFile}.away`)
    try {
      expect(await api('GET', '/v1/desktop')).toMatchObject({ status: 200, body: { available: false, running: false, controlled: false } })
      for (const [method, path, body] of [['GET', '/v1/desktop/frame'], ['POST', '/v1/desktop/control', { held: true }], ['POST', '/v1/desktop/input', { events: [{ type: 'move', x: 0, y: 0 }] }]] as const) {
        expect(await api(method, path, body)).toMatchObject({ status: 409, body: { error: 'no_screen' } })
      }
      expect(await operation('app_list', {})).toMatchObject({ status: 'failed', error: NO_SCREEN })
      expect(await operation('app_act', { app: 'Chromium', action: { type: 'view' } })).toMatchObject({ status: 'failed', error: NO_SCREEN })
    } finally { await rename(`${fake.versionFile}.away`, fake.versionFile) }
  })

  it('knows no other screen paths', async () => {
    expect(await api('GET', '/v1/desktop/elsewhere')).toMatchObject({ status: 404, body: { error: 'not_found' } })
    expect((await fetch(`${base}/v1/desktop`)).status).toBe(401)
  })
})
