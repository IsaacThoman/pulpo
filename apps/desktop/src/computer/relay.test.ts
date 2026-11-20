import { EventEmitter } from 'node:events'
import { request } from 'node:http'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComputerOperation } from '@pulpo/contracts'
import { sendRelayRequest } from '../../../../packages/workspace-daemon/src/cli-relay'
import { Operations, RELAY_UNAVAILABLE, type OperationContext } from './operations'
import { commandShell } from './platform'
import { fitsSocketPath, relayEndpoint, startRelayServer, type RelayServer } from './relay'

const windows = process.platform === 'win32'

/** One raw request on the endpoint, for the statuses `sendRelayRequest` does not expose. */
function post(endpoint: string, payload: string, urlPath = '/v1/requests'): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ socketPath: endpoint, path: urlPath, method: 'POST', agent: false, headers: { 'content-type': 'application/json' } }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.once('end', () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }))
    })
    outgoing.once('error', reject)
    outgoing.end(payload)
  })
}

const relayRequest = (operationId: string, command = 'ls', args: Record<string, unknown> = { path: 'notes' }) => JSON.stringify({ operationId, command, args })

describe('relayEndpoint', () => {
  it('uses a named pipe on Windows and a private socket elsewhere, when the path fits', () => {
    expect(relayEndpoint('win32', 'C:\\Users\\First Last\\AppData\\Roaming\\Pulpo\\computer', 'abc')).toBe('\\\\.\\pipe\\pulpo-relay-abc')
    expect(relayEndpoint('darwin', '/Users/me/Library/Application Support/Pulpo/computer')).toBe('/Users/me/Library/Application Support/Pulpo/computer/relay/pulpo.sock')
    expect(relayEndpoint('linux', `/home/${'x'.repeat(80)}/.config/Pulpo/computer`)).toBeNull()
    expect(fitsSocketPath(`/${'a'.repeat(102)}`)).toBe(true)
    expect(fitsSocketPath(`/${'a'.repeat(103)}`)).toBe(false)
    // Bytes, not characters.
    expect(fitsSocketPath(`/${'é'.repeat(52)}`)).toBe(false)
  })
})

describe('the relay endpoint', () => {
  let base: string
  let operations: Operations
  let relay: RelayServer
  let context: OperationContext
  const longCommand = windows ? 'Write-Output ready; Start-Sleep -Seconds 30' : 'echo ready; sleep 30'

  beforeEach(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), 'pulpo-relay-'))
    operations = new Operations({ platform: process.platform, savedOutputDir: path.join(base, 'saved'), scriptDir: path.join(base, 'scripts'), killGraceMs: 200 })
    operations.enableRelay(true)
    relay = await startRelayServer({ platform: process.platform, computerDir: path.join(base, 'computer'), tmpdir: os.tmpdir(), operations })
    context = {
      sessionId: 's1', cwd: base,
      shell: windows ? commandShell('win32', process.env) : { path: '/bin/sh', name: 'sh' },
      env: async () => (windows ? process.env : { PATH: '/usr/bin:/bin' }),
    }
  })

  afterEach(async () => {
    operations.cancelSession('s1', { now: true })
    operations.cancelSession('s2', { now: true })
    await relay.close()
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })

  /** Starts a command and returns once it is running (it printed `ready`), long-polling as the server does. */
  async function running(id: string, sessionContext = context): Promise<void> {
    operations.start(sessionContext, id, 'bash', { command: longCommand })
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const operation = await operations.get(sessionContext.sessionId, id, 2_000)
      if (operation.output.includes('ready')) return
      if (operation.status !== 'running') throw new Error(`command stopped: ${operation.error ?? operation.output}`)
    }
    throw new Error('command never became ready')
  }

  it.skipIf(windows)('listens on a socket only its owner can use, and removes it on close', async () => {
    expect((await stat(relay.endpoint)).mode & 0o777).toBe(0o600)
    expect((await stat(path.dirname(relay.endpoint))).mode & 0o777).toBe(0o700)
    await relay.close()
    await expect(stat(relay.endpoint)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.skipIf(windows)('falls back to a private temporary folder when the usual socket path is too long', async () => {
    const long = await startRelayServer({ platform: process.platform, computerDir: path.join(base, 'x'.repeat(100)), tmpdir: os.tmpdir(), operations })
    try {
      expect(fitsSocketPath(long.endpoint)).toBe(true)
      expect(long.endpoint.startsWith(path.join(base, 'x'.repeat(100)))).toBe(false)
      expect((await stat(path.dirname(long.endpoint))).mode & 0o777).toBe(0o700)
    } finally { await long.close() }
    await expect(stat(path.dirname(long.endpoint))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('holds a request, lists it as pending, returns a long-poll early and delivers the answer', async () => {
    await running('op')
    const poll = operations.get('s1', 'op', 20_000)
    const startedAt = Date.now()
    // The CLI's own client, as `pulpo files ls notes` sends it.
    const answer = sendRelayRequest(relay.endpoint, 'op', 'ls', { path: 'notes' })
    const view = await poll
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expect(view.relay).toEqual({ version: 1, pending: [{ id: expect.any(String), command: 'ls', args: { path: 'notes' } }] })
    const requestId = view.relay!.pending[0]!.id
    // A poll while something is pending returns at once.
    const again = Date.now()
    expect((await operations.get('s1', 'op', 20_000)).relay?.pending).toHaveLength(1)
    expect(Date.now() - again).toBeLessThan(1_000)

    expect(operations.answerRelay('s2', requestId, { ok: true, output: 'not yours' })).toBe(false)
    expect(operations.answerRelay('s1', requestId, { ok: true, output: 'notes/a.txt', data: { n: 1 } })).toBe(true)
    expect(await answer).toEqual({ ok: true, output: 'notes/a.txt', data: { n: 1 } })
    expect(operations.answerRelay('s1', requestId, { ok: true, output: 'twice' })).toBe(false)
    expect((await operations.get('s1', 'op')).relay).toEqual({ version: 1, pending: [] })
  })

  it('finds the operation by id whatever session runs it', async () => {
    const other = { ...context, sessionId: 's2' }
    await running('theirs', other)
    const answer = post(relay.endpoint, relayRequest('theirs', 'cat'))
    const view = await operations.get('s2', 'theirs', 10_000)
    expect(view.relay?.pending).toHaveLength(1)
    expect(operations.answerRelay('s1', view.relay!.pending[0]!.id, { ok: true, output: '' })).toBe(false)
    expect(operations.answerRelay('s2', view.relay!.pending[0]!.id, { ok: false, error: 'No such file' })).toBe(true)
    expect(await answer).toEqual({ status: 200, body: { ok: false, error: 'No such file' } })
  })

  it('refuses with 409 when no command is running under the id', async () => {
    expect(await post(relay.endpoint, relayRequest('unknown'))).toEqual({ status: 409, body: { ok: false, error: RELAY_UNAVAILABLE } })
    operations.start(context, 'read', 'list', {})
    let finished: ComputerOperation
    do finished = await operations.get('s1', 'read', 2_000); while (finished.status === 'running')
    expect(await post(relay.endpoint, relayRequest('read'))).toEqual({ status: 409, body: { ok: false, error: RELAY_UNAVAILABLE } })

    await running('later')
    operations.enableRelay(false)
    expect(await post(relay.endpoint, relayRequest('later'))).toMatchObject({ status: 409 })
  })

  it('fails held requests when their command stops', async () => {
    await running('op')
    const held = post(relay.endpoint, relayRequest('op'))
    expect((await operations.get('s1', 'op', 10_000)).relay?.pending).toHaveLength(1)
    expect(operations.cancel('s1', 'op').relay).toEqual({ version: 1, pending: [] })
    expect(await held).toEqual({ status: 409, body: { ok: false, error: RELAY_UNAVAILABLE } })
  })

  it('drops a request whose CLI hung up', async () => {
    await running('op')
    const outgoing = request({ socketPath: relay.endpoint, path: '/v1/requests', method: 'POST', agent: false })
    outgoing.on('error', () => undefined)
    outgoing.end(relayRequest('op'))
    expect((await operations.get('s1', 'op', 10_000)).relay?.pending).toHaveLength(1)
    outgoing.destroy()
    for (let attempt = 0; attempt < 50 && (await operations.get('s1', 'op')).relay?.pending.length; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20))
    expect((await operations.get('s1', 'op')).relay?.pending).toEqual([])
  })

  it('rejects malformed, oversized and misdirected requests', async () => {
    expect(await post(relay.endpoint, '{')).toMatchObject({ status: 400 })
    expect(await post(relay.endpoint, JSON.stringify({ operationId: 'op', command: '', args: {} }))).toEqual({ status: 400, body: { ok: false, error: 'Invalid relay request' } })
    expect(await post(relay.endpoint, JSON.stringify({ operationId: 'op', command: 'ls', args: [] }))).toMatchObject({ status: 400 })
    expect(await post(relay.endpoint, JSON.stringify({ operationId: 'op', command: 'x'.repeat(201), args: {} }))).toMatchObject({ status: 400 })
    expect(await post(relay.endpoint, relayRequest('op', 'ls', { pad: 'x'.repeat(1024 * 1024) }))).toEqual({ status: 413, body: { ok: false, error: 'Request body is too large' } })
    expect(await post(relay.endpoint, relayRequest('op'), '/v1/other')).toMatchObject({ status: 404 })
  })
})

/** A command that never ends, without a real process, so timers can be faked. */
function fakeSpawn(): ChildProcess {
  const child = new EventEmitter() as unknown as ChildProcess & { exitCode: number | null; signalCode: null; pid: number }
  Object.assign(child, { exitCode: null, signalCode: null, pid: undefined, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true })
  return child
}

describe('relay timeouts', () => {
  let operations: Operations
  const context: OperationContext = { sessionId: 's1', cwd: os.tmpdir(), shell: { path: '/bin/sh', name: 'sh' }, env: async () => ({}) }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let spawned = false
    operations = new Operations({ platform: 'linux', savedOutputDir: os.tmpdir(), scriptDir: os.tmpdir(), spawn: () => { spawned = true; return fakeSpawn() } })
    operations.enableRelay(true)
    operations.start(context, 'op', 'bash', { command: 'forever' })
    // The command spawns after a stat of its folder, which is real I/O: on a busy machine it takes
    // more turns of the loop than any fixed count, so wait for the spawn itself.
    const deadline = Date.now() + 5_000
    while (!spawned && Date.now() < deadline) await new Promise((resolve) => setImmediate(resolve))
    expect(spawned).toBe(true)
  })

  afterEach(() => {
    operations.failRelay()
    vi.useRealTimers()
  })

  const hold = () => {
    const answers: Array<{ status: number; value: unknown }> = []
    operations.holdRelay({ operationId: 'op', command: 'ls', args: {} }, (status, value) => answers.push({ status, value }))
    return answers
  }

  it('fails a request nobody answers after 15 minutes', async () => {
    const poll = operations.get('s1', 'op', 1)
    await vi.advanceTimersByTimeAsync(1)
    await poll
    const answers = hold()
    await vi.advanceTimersByTimeAsync(899_999)
    expect(answers).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(answers).toEqual([{ status: 504, value: { ok: false, error: 'Pulpo did not answer in time' } }])
    expect((await operations.get('s1', 'op')).relay?.pending).toEqual([])
  })

  it('fails fast when nobody long-polls the operation', async () => {
    const answers = hold()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(answers).toEqual([{ status: 503, value: { ok: false, error: 'This Pulpo server does not support pulpo files yet' } }])
  })

  it('keeps waiting when a long-poll arrives within the handshake', async () => {
    const answers = hold()
    await vi.advanceTimersByTimeAsync(1_000)
    expect((await operations.get('s1', 'op', 25_000)).relay?.pending).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(answers).toEqual([])
  })
})
