import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  process.env.WORKSPACE_CONTROLLER_URL = 'http://controller.test'
  process.env.WORKSPACE_CONTROLLER_TOKEN = 'controller-token-'.padEnd(40, 'x')
  return { request: vi.fn() }
})
vi.mock('./controller-http.js', () => ({ workspaceControllerRequest: mocks.request }))
vi.mock('../database/client.js', () => ({ db: {} }))

import { createAppTools } from './app-tools.js'
import { MAX_VIEW_IMAGE_BYTES } from './workspace.js'
import { isNoScreenFailure, WORKSPACE_NO_SCREEN_MESSAGE, WorkspaceManager } from './controller.js'

type Call = { path: string; method: string; body?: unknown }

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
const picture = '/tmp/pulpo-desktop/pictures/1.jpg'
const state = {
  app: 'Chromium', window: 'Example Domain', windows: ['Example Domain'], note: 'Clicked the link.',
  image: { path: picture, mimeType: 'image/jpeg', width: 1280, height: 800, sizeBytes: jpeg.byteLength },
  elements: [{ index: 1, depth: 0, role: 'link', label: 'More information', x: 10, y: 20, width: 100, height: 18 }],
  truncated: false,
}

let calls: Call[]

/** A manager already holding lease `lease-1`; each operation completes at once with `result`, or fails with `error`. */
function manager(outcome: { result?: unknown; error?: string }, image: () => Response = () => new Response(jpeg)): WorkspaceManager {
  mocks.request.mockImplementation(async (path: string, init: { method?: string; body?: unknown } = {}) => {
    calls.push({ path, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body })
    if (path.endsWith('/v1/operations') && init.method === 'POST') {
      const id = (JSON.parse(String(init.body)) as { id: string }).id
      return json(outcome.error
        ? { id, status: 'failed', output: '', exitCode: null, error: outcome.error }
        : { id, status: 'completed', output: 'Done', exitCode: 0, details: { result: outcome.result } })
    }
    if (path.includes('/v1/images')) return image()
    return json({ error: 'not_found' }, 404)
  })
  return Object.assign(new WorkspaceManager('response', 'chat', 'user'), { controllerLeaseId: 'lease-1', staged: true })
}

const operations = () => calls.filter((call) => call.path.endsWith('/v1/operations'))
const noop = () => undefined

beforeEach(() => { calls = []; mocks.request.mockReset() })

describe('app tools on a cloud workspace', () => {
  it('act through an operation named by the tool call and read the picture it names', async () => {
    const started = vi.fn()
    const workspace = manager({ result: state })
    const view = await workspace.useApp({ app: 'Chromium', action: { type: 'click', element: 1 } }, undefined, started, 'call-1')
    // Defaults are applied before the workspace sees the action.
    expect(operations()).toEqual([{ path: '/v1/leases/lease-1/v1/operations', method: 'POST', body: { id: 'call-1', type: 'app_act', args: { app: 'Chromium', action: { type: 'click', element: 1, button: 'left', count: 1 } } } }])
    expect(calls.at(-1)?.path).toBe(`/v1/leases/lease-1/v1/images?path=${encodeURIComponent(picture)}`)
    expect(started).toHaveBeenCalledOnce()
    expect(view).toEqual({
      state: { app: 'Chromium', window: 'Example Domain', windows: ['Example Domain'], note: 'Clicked the link.', elements: state.elements, truncated: false },
      image: { data: jpeg.toString('base64'), mimeType: 'image/jpeg', sizeBytes: jpeg.byteLength, width: 1280, height: 800 },
    })
  })

  it('list the apps the workspace reports', async () => {
    const apps = [{ name: 'Chromium', allowed: true, frontmost: true, windows: ['Example Domain'] }]
    const workspace = manager({ result: { apps } })
    expect(await workspace.listApps(undefined, noop, 'call-2')).toEqual(apps)
    expect(operations()[0]?.body).toEqual({ id: 'call-2', type: 'app_list', args: {} })
  })

  it('refuse an answer that is not a description of the windows', async () => {
    const unreadable = 'The workspace answered with something that is not a description of its windows. Look again with app_view before doing anything else.'
    for (const result of [undefined, { ...state, elements: 'none' }, { ...state, image: { ...state.image, path: undefined, data: 'AAAA' } }, { ...state, image: { ...state.image, path: 'relative.jpg' } }]) {
      calls = []
      await expect(manager({ result }).useApp({ app: 'Chromium', action: { type: 'view' } }, undefined, noop, 'call-3')).rejects.toThrow(unreadable)
      expect(calls.some((call) => call.path.includes('/v1/images'))).toBe(false)
    }
    await expect(manager({ result: { apps: [{ name: 1 }] } }).listApps(undefined, noop, 'call-4')).rejects.toThrow(unreadable)
  })

  it('refuse a picture that is too large or not a PNG or JPEG', async () => {
    const big = manager({ result: { ...state, image: { ...state.image, sizeBytes: MAX_VIEW_IMAGE_BYTES + 1 } } })
    await expect(big.useApp({ app: 'Chromium', action: { type: 'view' } }, undefined, noop, 'call-5')).rejects.toThrow(`exceeds the ${MAX_VIEW_IMAGE_BYTES} byte limit`)
    expect(calls.some((call) => call.path.includes('/v1/images'))).toBe(false)

    // The size the daemon claims is not trusted: the bytes are counted as they arrive.
    const lying = manager({ result: state }, () => new Response(new Uint8Array(MAX_VIEW_IMAGE_BYTES + 1)))
    await expect(lying.useApp({ app: 'Chromium', action: { type: 'view' } }, undefined, noop, 'call-6')).rejects.toThrow(`exceeds the ${MAX_VIEW_IMAGE_BYTES} byte limit`)

    const gif = manager({ result: state }, () => new Response(Buffer.from('GIF89a-not-allowed')))
    await expect(gif.useApp({ app: 'Chromium', action: { type: 'view' } }, undefined, noop, 'call-7')).rejects.toThrow('not a PNG or JPEG image')
  })

  it('say once, for the model, that an image without a screen needs an administrator, and stop asking', async () => {
    expect(isNoScreenFailure('Unknown operation type: app_act')).toBe(true)
    expect(isNoScreenFailure('This workspace has no screen: its image does not include the desktop.')).toBe(true)
    expect(isNoScreenFailure('Unknown operation type: bash')).toBe(false)

    const old = manager({ error: 'Unknown operation type: app_list' })
    await expect(old.listApps(undefined, noop, 'call-8')).rejects.toThrow(WORKSPACE_NO_SCREEN_MESSAGE)
    await expect(old.useApp({ app: 'Chromium', action: { type: 'view' } }, undefined, noop, 'call-9')).rejects.toThrow(WORKSPACE_NO_SCREEN_MESSAGE)
    expect(operations()).toHaveLength(1)
    expect(WORKSPACE_NO_SCREEN_MESSAGE).toContain('An administrator has to update the workspace image')

    const withoutDesktop = manager({ error: 'This workspace has no screen: its image does not include the desktop.' })
    await expect(withoutDesktop.useApp({ app: 'Chromium', action: { type: 'view' } }, undefined, noop, 'call-10')).rejects.toThrow(WORKSPACE_NO_SCREEN_MESSAGE)
  })

  it('pass on what the workspace says when a person holds the screen', async () => {
    const held = 'The user is using the workspace\'s screen themselves right now, so nothing was done. Wait until they say they are finished; you can still look with app_view.'
    await expect(manager({ error: held }).useApp({ app: 'Chromium', action: { type: 'type', text: 'hi' } }, undefined, noop, 'call-11')).rejects.toThrow(held)
  })

  it('are offered through the same tools as on a computer', async () => {
    const workspace = manager({ result: state })
    const tools = createAppTools(workspace, 'workspace')
    const result = await tools.find((tool) => tool.name === 'app_click')!.execute('call-12', { app: 'Chromium', element: 1 })
    expect(operations()[0]?.body).toMatchObject({ id: 'call-12', type: 'app_act' })
    expect(result.content[1]).toEqual({ type: 'image', data: jpeg.toString('base64'), mimeType: 'image/jpeg' })
  })
})
