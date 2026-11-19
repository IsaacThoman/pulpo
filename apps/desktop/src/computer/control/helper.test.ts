import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ControlHelper, ControlHelperError, controlHelperCommand, type ControlHelperOptions } from './helper'

/**
 * A stand-in helper: Node speaking the protocol. It answers `apps` with its own pid (so a restart
 * shows), fails `snapshot`, never answers `act`, and dies on `release`.
 */
const FAKE_HELPER = `
const fs = require('node:fs')
const log = process.argv[2]
let buffered = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffered += chunk
  for (let end = buffered.indexOf('\\n'); end >= 0; end = buffered.indexOf('\\n')) {
    const request = JSON.parse(buffered.slice(0, end)); buffered = buffered.slice(end + 1)
    fs.appendFileSync(log, JSON.stringify(request) + '\\n')
    const answer = (value) => process.stdout.write(JSON.stringify({ id: request.id, ...value }) + '\\n')
    if (request.method === 'configure') answer({ ok: true, result: { protocol: Number(process.env.FAKE_PROTOCOL || 1), platform: 'macos', background: true } })
    else if (request.method === 'apps') { process.stdout.write('not json\\n'); answer({ ok: true, result: { apps: [{ id: 'fake', name: 'Fake', pid: process.pid, frontmost: true, windows: [] }] } }) }
    else if (request.method === 'snapshot') answer({ ok: false, code: 'not_found', message: 'The window is gone.' })
    else if (request.method === 'release') process.exit(3)
  }
})
process.stdin.on('end', () => { fs.appendFileSync(log, 'closed\\n'); process.exit(0) })
`

let base: string
let helper: ControlHelper | undefined

async function start(extra: Partial<ControlHelperOptions> = {}, env: Record<string, string> = {}) {
  const script = path.join(base, 'fake-helper.cjs')
  await writeFile(script, FAKE_HELPER)
  const errors = vi.fn()
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  helper = new ControlHelper({
    command: { file: process.execPath, args: [script, path.join(base, 'requests.log')] },
    excludePids: [4242], imageDir: path.join(base, 'images'), maxImageEdge: 1280,
    prepare: async () => { await mkdir(path.join(base, 'images'), { recursive: true }) },
    onError: errors,
    ...extra,
  })
  const requests = async () => (await readFile(path.join(base, 'requests.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean)
  return { helper, errors, requests }
}

beforeEach(async () => { base = await mkdtemp(path.join(os.tmpdir(), 'pulpo-control-')) })
afterEach(async () => {
  helper?.stop()
  helper = undefined
  vi.unstubAllEnvs()
  // A helper that was just told to leave may still be writing its last line into the folder.
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

describe('the helper that controls apps', () => {
  it('is started on first use, configured, then asked', async () => {
    const { helper, requests } = await start()
    expect(helper.started).toBe(false)
    const first = await helper.call('apps', {})
    expect(first.apps[0]).toMatchObject({ id: 'fake', name: 'Fake' })
    expect((await helper.call('apps', {})).apps[0]!.pid).toBe(first.apps[0]!.pid)
    expect(helper.started).toBe(true)
    const sent = (await requests()).map((line) => JSON.parse(line) as { method: string; params: unknown })
    expect(sent.map((request) => request.method)).toEqual(['configure', 'apps', 'apps'])
    expect(sent[0]!.params).toEqual({ excludePids: [4242], imageDir: path.join(base, 'images'), maxImageEdge: 1280 })
  })

  it('passes on what the helper refused, with its code', async () => {
    const { helper } = await start()
    const refusal = await helper.call('snapshot', { pid: 1, windowId: 2 }).catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(ControlHelperError)
    expect(refusal).toMatchObject({ code: 'not_found', message: 'The window is gone.' })
  })

  it('replaces a helper that does not answer in time', async () => {
    const { helper } = await start({ requestTimeoutMs: 150 })
    const before = (await helper.call('apps', {})).apps[0]!.pid
    await expect(helper.call('act', { pid: 1, windowId: 2, action: { type: 'key', keys: 'enter' } })).rejects.toMatchObject({ code: 'failed', message: expect.stringContaining('did not answer act in time') })
    expect((await helper.call('apps', {})).apps[0]!.pid).not.toBe(before)
  })

  it('starts another when one died, and says that it did', async () => {
    const { helper, errors } = await start()
    const before = (await helper.call('apps', {})).apps[0]!.pid
    await expect(helper.call('release', {})).rejects.toMatchObject({ code: 'failed' })
    expect(errors).toHaveBeenCalledWith('The helper that controls apps stopped', expect.any(Error))
    expect((await helper.call('apps', {})).apps[0]!.pid).not.toBe(before)
  })

  it('does not send a request nobody wants any more by the time its turn comes', async () => {
    const { helper, requests } = await start()
    let wanted = true
    const first = helper.call('apps', {})
    const second = helper.call('act', { pid: 1, windowId: 2, action: { type: 'type', text: 'never typed' } }, { stillWanted: () => wanted })
    wanted = false
    await first
    await expect(second).rejects.toMatchObject({ code: 'failed', message: expect.stringContaining('withdrawn') })
    expect((await requests()).map((line) => (JSON.parse(line) as { method: string }).method)).toEqual(['configure', 'apps'])
    // The helper is still there for the next request.
    expect((await helper.call('apps', {})).apps).toHaveLength(1)
  })

  it('refuses a helper that speaks another version', async () => {
    const { helper } = await start({}, { FAKE_PROTOCOL: '2' })
    await expect(helper.call('apps', {})).rejects.toMatchObject({ code: 'failed', message: expect.stringContaining('different version') })
    expect(helper.started).toBe(false)
  })

  it('says so when it cannot be started', async () => {
    const { helper } = await start({ command: { file: path.join(base, 'missing-helper'), args: [] } })
    await expect(helper.call('apps', {})).rejects.toBeInstanceOf(ControlHelperError)
  })

  it('is told to leave by closing its input', async () => {
    const { helper, requests } = await start()
    await helper.call('apps', {})
    helper.stop()
    expect(helper.started).toBe(false)
    await vi.waitFor(async () => expect(await requests()).toContain('closed'))
  })
})

describe('where the helper is', () => {
  it('is the built binary on macOS', () => {
    expect(controlHelperCommand('darwin', '/Applications/Pulpo.app/Contents/Resources', {}, () => true))
      .toEqual({ file: '/Applications/Pulpo.app/Contents/Resources/pulpo-control', args: [] })
    expect(controlHelperCommand('darwin', '/nowhere', {}, () => false)).toBeNull()
  })

  it('is the loader script run by the built-in Windows PowerShell', () => {
    const command = controlHelperCommand('win32', 'C:\\Program Files\\Pulpo\\resources\\pulpo-control', { SystemRoot: 'D:\\Windows' }, () => true)
    expect(command?.file).toBe('D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(command?.args.slice(-2)).toEqual(['-File', 'C:\\Program Files\\Pulpo\\resources\\pulpo-control\\host.ps1'])
    expect(command?.args).toContain('-NoProfile')
    expect(controlHelperCommand('win32', 'C:\\x', {}, (file) => !file.endsWith('host.ps1'))).toBeNull()
  })

  it('does not exist on other systems', () => {
    expect(controlHelperCommand('linux', '/opt/pulpo', {}, () => true)).toBeNull()
  })
})
