import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComputerAppState, ComputerMethod, ComputerResponse } from '@pulpo/contracts'
import { AccountResolver } from './account'
import { ComputerService, type ComputerServiceOptions } from './service'

/**
 * The helper's place is taken by Node speaking its protocol: two apps, one of them the Pulpo app
 * itself, and a picture written for every snapshot.
 */
const FAKE_HELPER = `
const fs = require('node:fs')
const path = require('node:path')
const log = process.argv[2]
let config = null
let shots = 0
let buffered = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffered += chunk
  for (let end = buffered.indexOf('\\n'); end >= 0; end = buffered.indexOf('\\n')) {
    const request = JSON.parse(buffered.slice(0, end)); buffered = buffered.slice(end + 1)
    fs.appendFileSync(log, request.method + '\\n')
    const answer = (result) => process.stdout.write(JSON.stringify({ id: request.id, ok: true, result }) + '\\n')
    if (request.method === 'configure') { config = request.params; answer({ protocol: 1, platform: 'macos', background: true }) }
    else if (request.method === 'apps') answer({ apps: [
      { id: 'com.apple.TextEdit', name: 'TextEdit', pid: 500, frontmost: true, windows: [{ id: 11, title: 'Notes.txt', minimized: false }] },
      { id: 'com.isaacthoman.pulpo.desktop', name: 'Pulpo', pid: 700, frontmost: false, windows: [{ id: 31, title: 'Pulpo', minimized: false }] },
    ] })
    else if (request.method === 'snapshot') {
      const file = path.join(config.imageDir, 'shot-' + (++shots) + '.jpg')
      fs.writeFileSync(file, Buffer.from('picture'))
      answer({ window: { id: 11, title: 'Notes.txt', minimized: false }, image: { path: file, width: 640, height: 480, mimeType: 'image/jpeg' }, elements: [{ index: 1, depth: 0, role: 'textarea', value: 'hello', x: 0, y: 28, width: 640, height: 452 }], truncated: false })
    }
    else if (request.method === 'act') answer({})
    else answer({})
  }
})
process.stdin.on('end', () => process.exit(0))
`

const USER = '00000000-0000-4000-8000-00000000000a'
const ORIGIN = 'https://pulpo.example'

let base: string
let services: ComputerService[] = []

async function harness(extra: Partial<ComputerServiceOptions> = {}, platform: NodeJS.Platform = 'darwin') {
  const script = path.join(base, 'fake-helper.cjs')
  await writeFile(script, FAKE_HELPER)
  const confirmApp = vi.fn(async (_message: string, _detail: string, _signal: AbortSignal) => true)
  const service = new ComputerService({
    userData: path.join(base, 'userData'),
    home: path.join(base, 'home'),
    platform,
    arch: 'arm64',
    osVersion: () => '15.1',
    allowHttpLocalhost: true,
    accounts: new AccountResolver({ loadSession: async () => ({ instanceUrl: ORIGIN, token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00Z' }), fetchUserId: async () => USER }),
    chooseFolder: async () => path.join(base, 'home'),
    confirm: async () => true,
    trash: async () => undefined,
    onChangesChanged: () => undefined,
    env: { PATH: '/usr/bin:/bin', SHELL: '/bin/sh' },
    appControl: { helper: { file: process.execPath, args: [script, path.join(base, 'requests.log')] }, excludePids: [process.pid], confirmApp },
    ...extra,
  })
  services.push(service)
  const asked = async () => (await readFile(path.join(base, 'requests.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean)
  return { service, confirmApp, asked }
}

async function begin(service: ComputerService, access: 'full' | 'read' = 'full'): Promise<string> {
  const sessionId = randomUUID()
  if (access === 'full') expect(await service.allowFullAccess()).toBe(true)
  else await service.chooseFolder()
  expect(await service.begin({ sessionId, access, folder: access === 'full' ? null : path.join(base, 'home') })).toEqual({ ok: true })
  return sessionId
}

const call = (service: ComputerService, sessionId: string, method: ComputerMethod, params: unknown): Promise<ComputerResponse> => (
  service.handle({ id: randomUUID(), sessionId, method, params, timeoutMs: 210_000 })
)

async function ok<T>(response: Promise<ComputerResponse>): Promise<T> {
  const answer = await response
  if (!answer.ok) throw new Error(`${answer.code}: ${answer.message}`)
  return answer.result as T
}

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pulpo-computer-apps-')))
  await mkdir(path.join(base, 'home'), { recursive: true })
})

afterEach(async () => {
  await Promise.all(services.map((service) => service.shutdown()))
  services = []
  // A helper that was just told to leave may still be writing its last line into the folder.
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

describe('apps in a full-access session', () => {
  it('describes app control only where there is a helper for the system', async () => {
    const describeWith = async (extra: Partial<ComputerServiceOptions>, platform: NodeJS.Platform) => {
      const { service } = await harness(extra, platform)
      return ok<{ apps?: unknown }>(call(service, await begin(service), 'describe', {}))
    }
    expect((await describeWith({}, 'darwin')).apps).toEqual({ version: 1, background: true })
    expect((await describeWith({}, 'win32')).apps).toEqual({ version: 1, background: false })
    expect((await describeWith({}, 'linux')).apps).toBeUndefined()
    expect((await describeWith({ appControl: undefined }, 'darwin')).apps).toBeUndefined()
  })

  it('shows an app\'s window once the user allowed the app, and lists it in what was allowed', async () => {
    const { service, confirmApp, asked } = await harness()
    const sessionId = await begin(service)
    expect(await ok(call(service, sessionId, 'app.list', {}))).toEqual({ apps: [{ name: 'TextEdit', allowed: false, frontmost: true, windows: [] }] })
    expect((await service.status()).apps).toEqual([])

    const state = await ok<ComputerAppState>(call(service, sessionId, 'app.act', { app: 'TextEdit', action: { type: 'view' } }))
    expect(confirmApp).toHaveBeenCalledTimes(1)
    expect(state).toMatchObject({ app: 'TextEdit', window: 'Notes.txt', elements: [{ index: 1, role: 'textarea', value: 'hello' }] })
    expect(Buffer.from(state.image.data!, 'base64').toString()).toBe('picture')
    expect((await service.status()).apps).toEqual([{ id: 'com.apple.TextEdit', name: 'TextEdit' }])

    // Defaults are filled in before the helper is asked: a click is a single left click.
    await ok(call(service, sessionId, 'app.act', { app: 'TextEdit', action: { type: 'click', element: 1 } }))
    expect(await asked()).toEqual(['configure', 'apps', 'apps', 'snapshot', 'apps', 'act', 'apps', 'snapshot'])

    // Taken back, the app is asked about again.
    await service.forgetApp('com.apple.textedit')
    expect((await service.status()).apps).toEqual([])
    await ok(call(service, sessionId, 'app.act', { app: 'TextEdit', action: { type: 'view' } }))
    expect(confirmApp).toHaveBeenCalledTimes(2)
  })

  it('puts the agent\'s pointer away when the reply ends', async () => {
    const { service, asked } = await harness()
    const sessionId = await begin(service)
    await ok(call(service, sessionId, 'app.act', { app: 'TextEdit', action: { type: 'view' } }))
    await service.end(sessionId)
    await vi.waitFor(async () => expect((await asked()).at(-1)).toBe('release'))
    expect(await call(service, sessionId, 'app.list', {})).toMatchObject({ ok: false, code: 'unknown_session' })
  })

  it('is not part of the folder modes', async () => {
    const { service, asked } = await harness()
    const sessionId = await begin(service, 'read')
    expect(await call(service, sessionId, 'app.list', {})).toMatchObject({ ok: false, code: 'not_allowed' })
    expect(await call(service, sessionId, 'app.act', { app: 'TextEdit', action: { type: 'view' } })).toMatchObject({ ok: false, code: 'not_allowed' })
    expect(await asked()).toEqual([])
  })

  it('refuses a malformed action before anything is asked of the helper', async () => {
    const { service, asked } = await harness()
    const sessionId = await begin(service)
    expect(await call(service, sessionId, 'app.act', { app: 'TextEdit', action: { type: 'click' } })).toMatchObject({ ok: false, code: 'invalid_request' })
    expect(await asked()).toEqual([])
  })
})
