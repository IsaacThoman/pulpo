import { once } from 'node:events'
import { request, type Server } from 'node:http'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The daemon is a single-file server that starts on import, so it runs here in-process against a scratch root.
const token = 'relay-test-token-'.padEnd(40, 'x')
let root: string
let socket: string
let base: string
let servers: { server: Server; relayServer: Server }
const started: string[] = []

type Operation = { id: string; status: string; output: string; relay: { version: number; pending: Array<{ id: string; command: string; args: unknown }> } }

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pulpo-daemon-'))
  socket = join(root, 'relay.sock')
  Object.assign(process.env, {
    PULPO_WORKSPACE_TOKEN: token, PORT: '0', PULPO_WORKSPACE_ROOT: root, PULPO_RELAY_SOCKET: socket,
    PULPO_WORKSPACE_TOOL_OUTPUT_DIR: join(root, 'tool-output'), PULPO_RELAY_TIMEOUT_MS: '1500', PULPO_RELAY_HANDSHAKE_MS: '500',
  })
  // A tiny relay client for bash commands; the real CLI is covered by cli-main.test.ts.
  await writeFile(join(root, 'client.mjs'), `
    import { request } from 'node:http'
    const payload = JSON.stringify({ operationId: process.env.PULPO_OPERATION_ID, command: process.argv[2], args: JSON.parse(process.argv[3] ?? '{}') })
    const outgoing = request({ socketPath: process.env.PULPO_RELAY_SOCKET, path: '/v1/requests', method: 'POST', headers: { 'content-length': Buffer.byteLength(payload) } }, (response) => {
      let text = ''; response.on('data', (chunk) => { text += chunk }); response.on('end', () => console.log(response.statusCode, text))
    })
    outgoing.end(payload)
  `)
  const daemon = await import('./index.js')
  servers = daemon
  expect(await daemon.relayReady).toBe(true)
  if (!daemon.server.listening) await once(daemon.server, 'listening')
  base = `http://127.0.0.1:${(daemon.server.address() as import('node:net').AddressInfo).port}`
})

afterAll(async () => {
  await Promise.all(started.map((id) => api('POST', `/v1/operations/${id}/cancel`).catch(() => undefined)))
  servers.server.closeAllConnections(); servers.relayServer.closeAllConnections()
  await Promise.all([servers.server, servers.relayServer].map((server) => new Promise((resolve) => server.close(resolve))))
  await rm(root, { recursive: true, force: true })
})

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, body: await response.json() }
}

async function bash(command: string): Promise<Operation> {
  const id = randomUUID(); started.push(id)
  return (await api('POST', '/v1/operations', { id, type: 'bash', args: { command } })).body as Operation
}

const client = (command: string, args: unknown) => `${JSON.stringify(process.execPath)} ${JSON.stringify(join(root, 'client.mjs'))} ${command} '${JSON.stringify(args)}'`

async function poll(id: string, waitMs?: number): Promise<{ operation: Operation; elapsedMs: number }> {
  const startedAt = Date.now()
  const { body } = await api('GET', `/v1/operations/${id}${waitMs === undefined ? '' : `?waitMs=${waitMs}`}`)
  return { operation: body as Operation, elapsedMs: Date.now() - startedAt }
}

async function finished(id: string): Promise<Operation> {
  for (;;) {
    const { operation } = await poll(id, 5_000)
    if (operation.status !== 'running') return operation
  }
}

async function pendingRequest(id: string) {
  for (;;) {
    const { operation } = await poll(id, 5_000)
    if (operation.relay.pending.length) return operation.relay.pending
    if (operation.status !== 'running') throw new Error(`operation stopped: ${operation.output}`)
  }
}

/** Sends a relay request from this process, as a CLI in some bash command would. */
function socketRequest(body: string, onRequest?: (destroy: () => void) => void): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ socketPath: socket, path: '/v1/requests', method: 'POST', headers: { 'content-length': Buffer.byteLength(body) } }, (response) => {
      let text = ''
      response.on('data', (chunk) => { text += chunk })
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(text) }))
    })
    outgoing.on('error', reject)
    outgoing.end(body)
    onRequest?.(() => outgoing.destroy())
  })
}

describe('workspace daemon relay', () => {
  it('gives bash commands the operation id and relay socket', async () => {
    const operation = await bash('echo "$PULPO_OPERATION_ID $PULPO_RELAY_SOCKET"')
    expect((await finished(operation.id)).output).toBe(`${operation.id} ${socket}\n`)
  })

  it('holds a CLI request until Pulpo answers it, and keeps relay state out of the journal', async () => {
    const operation = await bash(client('ls', { path: 'Projects' }))
    expect(operation.relay).toEqual({ version: 1, pending: [] })

    const [pending] = await pendingRequest(operation.id)
    expect(pending).toEqual({ id: expect.any(String), command: 'ls', args: { path: 'Projects' } })
    const journal = await Promise.all((await readdir(join(root, '.pulpo', 'operations'))).map((name) => readFile(join(root, '.pulpo', 'operations', name), 'utf8')))
    expect(journal.join('\n')).not.toContain(pending!.id)
    expect(journal.join('\n')).not.toContain('"relay"')

    expect(await api('POST', `/v1/relay/${pending!.id}`, { ok: true, output: 'Projects/\n  Plan.md' })).toEqual({ status: 200, body: { ok: true } })
    expect(await api('POST', `/v1/relay/${pending!.id}`, { ok: true, output: 'again' })).toEqual({ status: 404, body: { error: 'not_found' } })
    expect((await finished(operation.id)).output).toBe('200 {"ok":true,"output":"Projects/\\n  Plan.md"}\n')
  })

  it('serves several requests from one command, including background jobs', async () => {
    const operation = await bash(`${client('cat', { path: 'a' })} & ${client('cat', { path: 'b' })}; wait`)
    const seen = new Set<string>()
    while (seen.size < 2) {
      for (const request of await pendingRequest(operation.id)) {
        seen.add((request.args as { path: string }).path)
        await api('POST', `/v1/relay/${request.id}`, { ok: true, output: `text of ${(request.args as { path: string }).path}` })
      }
    }
    const output = (await finished(operation.id)).output
    expect(output).toContain('"output":"text of a"')
    expect(output).toContain('"output":"text of b"')
  })

  it('refuses requests for operations that are not running bash commands', async () => {
    const done = await bash('true')
    await finished(done.id)
    for (const operationId of ['unknown', done.id]) {
      expect(await socketRequest(JSON.stringify({ operationId, command: 'ls', args: {} }))).toEqual({
        status: 409, body: { ok: false, error: 'pulpo files only works while the bash command that started it is running' },
      })
    }
    expect((await socketRequest('{"operationId":"x"')).status).toBe(400)
    expect((await socketRequest(JSON.stringify({ operationId: 'x', command: 'ls', args: [] }))).status).toBe(400)
    expect(await socketRequest(JSON.stringify({ operationId: 'x', command: 'push', args: { pad: 'x'.repeat(1024 * 1024) } }))).toEqual({
      status: 413, body: { ok: false, error: 'Request body is too large' },
    })
  })

  it('fails held requests when the command is cancelled', async () => {
    const operation = await bash('sleep 30')
    const held = socketRequest(JSON.stringify({ operationId: operation.id, command: 'ls', args: {} }))
    await pendingRequest(operation.id)
    await api('POST', `/v1/operations/${operation.id}/cancel`)
    expect(await held).toEqual({ status: 409, body: { ok: false, error: 'pulpo files only works while the bash command that started it is running' } })
  })

  it('times out requests Pulpo never answers', async () => {
    const operation = await bash('sleep 30')
    await poll(operation.id, 50)
    const startedAt = Date.now()
    expect(await socketRequest(JSON.stringify({ operationId: operation.id, command: 'ls', args: {} }))).toEqual({ status: 504, body: { ok: false, error: 'Pulpo did not answer in time' } })
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_400)
    expect((await poll(operation.id)).operation.relay.pending).toEqual([])
    await api('POST', `/v1/operations/${operation.id}/cancel`)
  })

  it('fails fast when the server polling the command cannot answer relay requests', async () => {
    const operation = await bash('sleep 30')
    await poll(operation.id)
    const startedAt = Date.now()
    const held = socketRequest(JSON.stringify({ operationId: operation.id, command: 'ls', args: {} }))
    await new Promise((resolve) => setTimeout(resolve, 100))
    await poll(operation.id)
    expect(await held).toEqual({ status: 503, body: { ok: false, error: 'This Pulpo server does not support pulpo files yet' } })
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(450)
    expect(Date.now() - startedAt).toBeLessThan(1_400)
    expect((await poll(operation.id)).operation.relay.pending).toEqual([])
    await api('POST', `/v1/operations/${operation.id}/cancel`)
  })

  it('waits for a relay-aware server that starts long-polling after the request', async () => {
    const operation = await bash('sleep 30')
    const held = socketRequest(JSON.stringify({ operationId: operation.id, command: 'ls', args: {} }))
    await new Promise((resolve) => setTimeout(resolve, 300))
    const [pending] = await pendingRequest(operation.id)
    await new Promise((resolve) => setTimeout(resolve, 400))
    await api('POST', `/v1/relay/${pending!.id}`, { ok: true, output: 'answered' })
    expect(await held).toEqual({ status: 200, body: { ok: true, output: 'answered' } })
    await api('POST', `/v1/operations/${operation.id}/cancel`)
  })

  it('forgets requests whose CLI went away', async () => {
    const operation = await bash('sleep 30')
    let destroy!: () => void
    void socketRequest(JSON.stringify({ operationId: operation.id, command: 'ls', args: {} }), (close) => { destroy = close }).catch(() => undefined)
    const [pending] = await pendingRequest(operation.id)
    destroy()
    await expect.poll(async () => (await poll(operation.id)).operation.relay.pending).toEqual([])
    expect((await api('POST', `/v1/relay/${pending!.id}`, { ok: true, output: 'late' })).status).toBe(404)
    await api('POST', `/v1/operations/${operation.id}/cancel`)
  })

  it('rejects malformed answers', async () => {
    expect((await api('POST', '/v1/relay/anything', { output: 'no ok flag' })).status).toBe(400)
  })
})

describe('workspace daemon uploads', () => {
  it('stages uploads under a short hidden name, so long names fit and status never sees them', async () => {
    const directory = join(root, 'files', 'Uploads')
    const target = join(directory, `${'n'.repeat(240)}.md`)
    const firstHalf = Buffer.from('# Up'); const secondHalf = Buffer.from('load\n')
    const uploaded = new Promise<number>((resolve, reject) => {
      const outgoing = request(`${base}/v1/files?path=${encodeURIComponent(target)}`, {
        method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-length': firstHalf.length + secondHalf.length },
      }, (response) => { response.resume(); response.on('end', () => resolve(response.statusCode ?? 0)) })
      outgoing.on('error', reject)
      outgoing.write(firstHalf)
      void (async () => {
        await expect.poll(async () => (await readdir(directory).catch(() => [])).length).toBe(1)
        const [temporary] = await readdir(directory)
        expect(temporary).toMatch(/^\.[0-9a-f]{12}\.pulpo-upload$/)
        outgoing.end(secondHalf)
      })().catch(reject)
    })
    expect(await uploaded).toBe(201)
    expect(await readdir(directory)).toEqual([`${'n'.repeat(240)}.md`])
    expect(await readFile(target, 'utf8')).toBe('# Upload\n')
  })
})

describe('workspace daemon long-poll', () => {
  it('answers at once without waitMs or when the operation is not running', async () => {
    const operation = await bash('sleep 30')
    const plain = await poll(operation.id)
    expect(plain.operation.status).toBe('running')
    expect(plain.elapsedMs).toBeLessThan(200)
    await api('POST', `/v1/operations/${operation.id}/cancel`)
    const stopped = await poll(operation.id, 5_000)
    expect(stopped.operation.status).toBe('cancelled')
    expect(stopped.elapsedMs).toBeLessThan(200)
  })

  it('waits for waitMs when nothing happens', async () => {
    const operation = await bash('sleep 30')
    const { operation: current, elapsedMs } = await poll(operation.id, 400)
    expect(current.status).toBe('running')
    expect(elapsedMs).toBeGreaterThanOrEqual(350)
    expect(elapsedMs).toBeLessThan(1_500)
    await api('POST', `/v1/operations/${operation.id}/cancel`)
  })

  it('returns new output no sooner than 250 ms into the poll, and only once', async () => {
    const operation = await bash('sleep 0.6; echo hello; sleep 30')
    const first = await poll(operation.id, 5_000)
    expect(first.operation.output).toBe('hello\n')
    expect(first.elapsedMs).toBeGreaterThanOrEqual(400)
    expect(first.elapsedMs).toBeLessThan(2_500)
    const second = await poll(operation.id, 400)
    expect(second.elapsedMs).toBeGreaterThanOrEqual(350)
    await api('POST', `/v1/operations/${operation.id}/cancel`)
  })

  it('returns output produced between polls after 250 ms instead of waiting for more', async () => {
    const operation = await bash('echo between; sleep 30')
    await new Promise((resolve) => setTimeout(resolve, 500))
    const { operation: current, elapsedMs } = await poll(operation.id, 5_000)
    expect(current.output).toBe('between\n')
    expect(elapsedMs).toBeGreaterThanOrEqual(200)
    expect(elapsedMs).toBeLessThan(1_000)
    await api('POST', `/v1/operations/${operation.id}/cancel`)
  })

  it('returns as soon as the command finishes or a relay request arrives', async () => {
    const quick = await bash('sleep 0.3')
    const done = await poll(quick.id, 5_000)
    expect(done.operation.status).toBe('completed')
    expect(done.elapsedMs).toBeLessThan(2_000)

    const operation = await bash('sleep 30')
    const waiting = poll(operation.id, 5_000)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const held = socketRequest(JSON.stringify({ operationId: operation.id, command: 'tree', args: {} }))
    const { operation: current, elapsedMs } = await waiting
    expect(current.relay.pending).toEqual([{ id: expect.any(String), command: 'tree', args: {} }])
    expect(elapsedMs).toBeLessThan(1_500)
    await api('POST', `/v1/relay/${current.relay.pending[0]!.id}`, { ok: false, error: 'nope' })
    expect(await held).toEqual({ status: 200, body: { ok: false, error: 'nope' } })
    await api('POST', `/v1/operations/${operation.id}/cancel`)
  })
})
