import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  process.env.WORKSPACE_CONTROLLER_URL = 'http://controller.test'
  process.env.WORKSPACE_CONTROLLER_TOKEN = 'controller-token-'.padEnd(40, 'x')
  return { request: vi.fn() }
})
vi.mock('./controller-http.js', () => ({ workspaceControllerRequest: mocks.request }))
vi.mock('../database/client.js', () => ({ db: {} }))

import { WorkspaceManager, type RelayResult } from './controller.js'

type Call = { path: string; method: string; body?: unknown; aborted: boolean; at: number }
type Handler = (path: string, init: { method?: string; body?: unknown; signal?: AbortSignal }) => Response | Promise<Response>

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const running = (relay?: unknown, output = '') => ({ id: 'op', status: 'running', output, exitCode: null, ...(relay ? { relay } : {}) })
const completed = (output: string) => ({ id: 'op', status: 'completed', output, exitCode: 0, relay: { version: 1, pending: [] } })
const ls = { id: 'req-1', command: 'ls', args: { path: 'Projects' } }

let calls: Call[]

/** A manager already holding lease `lease-1`, talking to a scripted controller. */
function manager(handler: Handler): WorkspaceManager {
  mocks.request.mockImplementation(async (path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}) => {
    calls.push({ path, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body, aborted: init.signal?.aborted ?? false, at: Date.now() })
    return handler(path, init)
  })
  return Object.assign(new WorkspaceManager('response', 'chat', 'user'), { controllerLeaseId: 'lease-1', staged: true })
}

/** Scripts a daemon: POST starts the operation, each poll returns the next state, relay answers are recorded. */
function daemon(states: unknown[], relayStatus = 200): Handler {
  let next = 0
  return (path, init) => {
    if (path.endsWith('/v1/operations') && init.method === 'POST') return json(states[0])
    if (path.includes('/v1/relay/')) return relayStatus === 200 ? json({ ok: true }) : json({ error: 'not_found' }, relayStatus)
    if (path.endsWith('/cancel')) return json({ id: 'op', status: 'cancelled' }, 202)
    next = Math.min(next + 1, states.length - 1)
    return json(states[next])
  }
}

const polls = () => calls.filter((call) => call.method === 'GET' && call.path.includes('/v1/operations/op'))
const relayPosts = () => calls.filter((call) => call.path.includes('/v1/relay/'))

beforeEach(() => { calls = []; mocks.request.mockReset() })

describe('workspace relay while a bash command runs', () => {
  it('answers pending requests through onRelay and long-polls without sleeping', async () => {
    const onRelay = vi.fn(async (): Promise<RelayResult> => ({ ok: true, output: 'Projects/\n  Plan.md' }))
    const workspace = manager(daemon([running({ version: 1, pending: [] }), running({ version: 1, pending: [ls] }), completed('done')]))
    const startedAt = Date.now()

    const operation = await workspace.execute('op', 'bash', { command: 'pulpo files ls Projects' }, undefined, undefined, undefined, onRelay)

    expect(operation.output).toBe('done')
    expect(onRelay).toHaveBeenCalledExactlyOnceWith(ls, undefined)
    expect(relayPosts()).toEqual([expect.objectContaining({ path: '/v1/leases/lease-1/v1/relay/req-1', method: 'POST', body: { ok: true, output: 'Projects/\n  Plan.md' } })])
    expect(polls().map((call) => call.path)).toEqual(['/v1/leases/lease-1/v1/operations/op?waitMs=10000', '/v1/leases/lease-1/v1/operations/op?waitMs=10000'])
    expect(Date.now() - startedAt).toBeLessThan(200)
  })

  it('keeps the 250 ms sleep for daemons without relay support', async () => {
    const workspace = manager(daemon([running(), running(), completed('done')]))
    const startedAt = Date.now()
    await workspace.execute('op', 'bash', { command: 'true' })
    expect(polls().map((call) => call.path)).toEqual(['/v1/leases/lease-1/v1/operations/op', '/v1/leases/lease-1/v1/operations/op'])
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(480)
  })

  it('turns onRelay failures and missing Files access into error answers', async () => {
    const failing = manager(daemon([running({ version: 1, pending: [ls] }), completed('')]))
    await failing.execute('op', 'bash', {}, undefined, undefined, undefined, async () => { throw new Error('Projects is not attached to this chat') })
    expect(relayPosts()[0]?.body).toEqual({ ok: false, error: 'Projects is not attached to this chat' })

    calls = []
    const without = manager(daemon([running({ version: 1, pending: [ls] }), completed('')]))
    await without.execute('op', 'bash', {})
    expect(relayPosts()[0]?.body).toEqual({ ok: false, error: 'Files are not available in this chat' })
  })

  it('treats a 404 for an answer as a vanished CLI, not an expired lease', async () => {
    const onRelay = vi.fn(async (): Promise<RelayResult> => ({ ok: true, output: 'late' }))
    const workspace = manager(daemon([running({ version: 1, pending: [ls] }), completed('ok')], 404))
    expect((await workspace.execute('op', 'bash', {}, undefined, undefined, undefined, onRelay)).output).toBe('ok')
    expect(calls.filter((call) => call.path === '/v1/leases')).toEqual([])
    expect((workspace as unknown as { controllerLeaseId?: string }).controllerLeaseId).toBe('lease-1')
  })

  it('redelivers the same result when an answer fails and the request is still pending', async () => {
    const onRelay = vi.fn(async (): Promise<RelayResult> => ({ ok: true, output: 'once' }))
    const states = [running({ version: 1, pending: [ls] }), running({ version: 1, pending: [ls] }), completed('ok')]
    let relayFailures = 1
    const scripted = daemon(states)
    const workspace = manager((path, init) => path.includes('/v1/relay/') && relayFailures-- > 0 ? json({ error: 'boom' }, 502) : scripted(path, init))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await workspace.execute('op', 'bash', {}, undefined, undefined, undefined, onRelay)

    expect(onRelay).toHaveBeenCalledOnce()
    expect(relayPosts().map((call) => call.body)).toEqual([{ ok: true, output: 'once' }, { ok: true, output: 'once' }])
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('spaces polls when a daemon answers instantly without news', async () => {
    let polled = 0
    const workspace = manager((path, init) => {
      if (init.method === 'POST') return json(running({ version: 1, pending: [] }))
      polled += 1
      return json(polled >= 4 ? completed('') : running({ version: 1, pending: [] }))
    })
    const startedAt = Date.now()
    await workspace.execute('op', 'bash', {})
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(700)
  })

  it('cancels the operation when aborted during a long-poll', async () => {
    const workspace = manager((path, init) => {
      if (init.method === 'POST' && path.endsWith('/v1/operations')) return json(running({ version: 1, pending: [] }))
      if (path.endsWith('/cancel')) return json({ id: 'op', status: 'cancelled' }, 202)
      return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)))
    })
    const controller = new AbortController()
    setTimeout(() => controller.abort(new Error('Generation cancelled')), 50)

    await expect(workspace.execute('op', 'bash', {}, controller.signal)).rejects.toThrow('Generation cancelled')
    expect(calls.at(-1)).toMatchObject({ path: '/v1/leases/lease-1/v1/operations/op/cancel', method: 'POST' })
  })

  it('still delivers an answer whose change committed while the reply was stopped, then cancels', async () => {
    const controller = new AbortController()
    const push = { id: 'req-2', command: 'push', args: { items: [] } }
    const workspace = manager(daemon([running({ version: 1, pending: [push, ls] }), completed('ok')]))
    const onRelay = vi.fn(async (): Promise<RelayResult> => { controller.abort(new Error('Generation cancelled')); return { ok: true, output: 'updated Plan.md' } })

    await expect(workspace.execute('op', 'bash', {}, controller.signal, undefined, undefined, onRelay)).rejects.toThrow('Generation cancelled')

    expect(onRelay).toHaveBeenCalledOnce()
    expect(relayPosts()).toEqual([expect.objectContaining({ path: '/v1/leases/lease-1/v1/relay/req-2', body: { ok: true, output: 'updated Plan.md' }, aborted: false })])
    expect(calls.at(-1)?.path).toBe('/v1/leases/lease-1/v1/operations/op/cancel')
  })

  it('treats other 4xx answers as final instead of retrying them', async () => {
    const onRelay = vi.fn(async (): Promise<RelayResult> => ({ ok: true, output: 'x' }))
    const listed = running({ version: 1, pending: [ls] })
    const workspace = manager(daemon([listed, listed, listed, completed('ok')], 400))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await workspace.execute('op', 'bash', {}, undefined, undefined, undefined, onRelay)

    expect(onRelay).toHaveBeenCalledOnce()
    expect(relayPosts()).toHaveLength(1)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('keeps no answer once it is delivered or its request is gone', async () => {
    const onRelay = vi.fn(async (): Promise<RelayResult> => ({ ok: true, output: 'x' }))
    const listed = running({ version: 1, pending: [ls] })
    // A daemon listing a delivered request again gets a fresh answer: nothing was retained.
    await manager(daemon([listed, listed, completed('ok')])).execute('op', 'bash', {}, undefined, undefined, undefined, onRelay)
    expect(onRelay).toHaveBeenCalledTimes(2)

    // An undelivered answer is dropped once the daemon stops listing its request.
    onRelay.mockClear(); calls = []
    let relayFailures = 1
    const scripted = daemon([listed, running({ version: 1, pending: [] }), listed, completed('ok')])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await manager((path, init) => path.includes('/v1/relay/') && relayFailures-- > 0 ? json({ error: 'boom' }, 502) : scripted(path, init))
      .execute('op', 'bash', {}, undefined, undefined, undefined, onRelay)
    expect(onRelay).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('retries a transient poll failure', async () => {
    let failures = 1
    const scripted = daemon([running({ version: 1, pending: [] }), completed('ok')])
    const workspace = manager((path, init) => init.method !== 'POST' && failures-- > 0 ? json({ error: 'bad gateway' }, 502) : scripted(path, init))
    expect((await workspace.execute('op', 'bash', {})).output).toBe('ok')
    expect(polls()).toHaveLength(2)
  })

  it('cancels the command when polling fails for good, so held pulpo files calls end', async () => {
    for (const status of [503, 404]) {
      calls = []
      const workspace = manager((path, init) => {
        if (init.method === 'POST' && path.endsWith('/v1/operations')) return json(running({ version: 1, pending: [] }))
        if (path.endsWith('/cancel')) return json({ id: 'op', status: 'cancelled' }, 202)
        return json({ error: 'unavailable' }, status)
      })
      await expect(workspace.execute('op', 'bash', {})).rejects.toThrow(`(${status})`)
      expect(polls()).toHaveLength(status === 404 ? 1 : 3)
      expect(calls.at(-1)).toMatchObject({ path: '/v1/leases/lease-1/v1/operations/op/cancel', method: 'POST' })
    }
  })
})

describe('workspace file transfer for Files relay', () => {
  it('writes bytes or streams to the current lease', async () => {
    const received: Array<{ path: string; length: string | undefined; body: string }> = []
    const workspace = manager(async (path, init) => {
      const chunks: Buffer[] = []
      const body = init.body as Uint8Array | AsyncIterable<Uint8Array>
      if (body instanceof Uint8Array) chunks.push(Buffer.from(body))
      else for await (const chunk of body) chunks.push(Buffer.from(chunk))
      received.push({ path, length: (init as { headers?: Record<string, string> }).headers?.['content-length'], body: Buffer.concat(chunks).toString('utf8') })
      return json({ path: '/workspace/files/a b.md' }, 201)
    })

    await workspace.writeWorkspaceFile('/workspace/files/a b.md', new TextEncoder().encode('# A'), 3)
    await workspace.writeWorkspaceFile('/workspace/files/c.txt', Readable.from([Buffer.from('he'), Buffer.from('llo')]), 5)

    expect(received).toEqual([
      { path: '/v1/leases/lease-1/v1/files?path=%2Fworkspace%2Ffiles%2Fa%20b.md', length: '3', body: '# A' },
      { path: '/v1/leases/lease-1/v1/files?path=%2Fworkspace%2Ffiles%2Fc.txt', length: '5', body: 'hello' },
    ])
  })

  it('refuses paths outside /workspace, mismatched sizes and a missing lease', async () => {
    const workspace = manager(() => json({}, 201))
    await expect(workspace.writeWorkspaceFile('/etc/passwd', new Uint8Array(1), 1)).rejects.toThrow('inside /workspace')
    await expect(workspace.writeWorkspaceFile('/workspace/../etc/passwd', new Uint8Array(1), 1)).rejects.toThrow('inside /workspace')
    await expect(workspace.readWorkspaceFile('workspace/x', 10)).rejects.toThrow('inside /workspace')
    await expect(workspace.writeWorkspaceFile('/workspace/x', new Uint8Array(2), 1)).rejects.toThrow('size is invalid')
    const unleased = new WorkspaceManager('response', 'chat', 'user')
    await expect(unleased.readWorkspaceFile('/workspace/x', 10)).rejects.toThrow('The workspace is not available')
    expect(calls).toEqual([])
  })

  it('reads files up to the caller limit and explains daemon errors', async () => {
    const workspace = manager((path) => {
      if (path.includes('big')) return new Response('x'.repeat(20), { headers: { 'content-length': '20' } })
      if (path.includes('chunked')) return new Response(Readable.toWeb(Readable.from([Buffer.alloc(8), Buffer.alloc(8)])) as ReadableStream)
      if (path.includes('missing')) return json({ error: 'ENOENT: no such file or directory' }, 400)
      return new Response('hello')
    })
    expect(Buffer.from(await workspace.readWorkspaceFile('/workspace/files/ok.txt', 10)).toString()).toBe('hello')
    await expect(workspace.readWorkspaceFile('/workspace/big.bin', 10)).rejects.toThrow('/workspace/big.bin is larger than the 10 byte limit')
    await expect(workspace.readWorkspaceFile('/workspace/chunked.bin', 10)).rejects.toThrow('larger than')
    await expect(workspace.readWorkspaceFile('/workspace/missing.txt', 1_048_576)).rejects.toThrow('Could not read /workspace/missing.txt: ENOENT: no such file or directory')
  })
})
