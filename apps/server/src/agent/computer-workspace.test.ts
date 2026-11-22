import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPUTER_INLINE_MAX_BYTES, type ComputerDescription } from '@pulpo/contracts'

const tunnel = vi.hoisted(() => ({ computerCall: vi.fn(), createComputerUpload: vi.fn(), createComputerDownload: vi.fn() }))
const manifest = vi.hoisted(() => ({ loadWorkspaceAttachments: vi.fn() }))
const blobs = vi.hoisted(() => ({ get: vi.fn(), getStream: vi.fn() }))
vi.mock('../computer/tunnel.js', async (importOriginal) => ({ ...await importOriginal<typeof import('../computer/tunnel.js')>(), ...tunnel }))
vi.mock('./attachment-manifest.js', () => manifest)
vi.mock('../storage/index.js', () => ({ getBlobStore: () => blobs }))

const { ComputerRequestError, ComputerUnavailableError } = await import('../computer/tunnel.js')
const { boundRelayResult, COMPUTER_RELAY_OUTPUT_MAX_BYTES, COMPUTER_UNAVAILABLE_MESSAGE, ComputerWorkspace, computerPath, computerWorkspacePaths } = await import('./computer-workspace.js')

const mac: ComputerDescription = {
  os: 'macos', osVersion: 'macOS 15.1', arch: 'arm64', shell: 'zsh', home: '/Users/ada',
  cwd: '/Users/ada/Pulpo', attachmentsDir: '/Users/ada/Pulpo/.pulpo/attachments',
}
const windows: ComputerDescription = {
  os: 'windows', osVersion: 'Windows 11 (10.0.26100)', arch: 'x64', shell: 'pwsh', home: 'C:\\Users\\Ada',
  cwd: 'C:\\Users\\Ada\\Pulpo', attachmentsDir: 'C:\\Users\\Ada\\Pulpo\\.pulpo\\attachments',
}
const session = { userId: 'user-1', sessionId: '00000000-0000-4000-8000-000000000001' }
type Handler = (params: Record<string, unknown>, options: { signal?: AbortSignal; timeoutMs?: number }) => unknown

function serve(handlers: Record<string, Handler>) {
  tunnel.computerCall.mockImplementation(async (_session: unknown, method: string, params: Record<string, unknown>, options = {}) => {
    const handler = handlers[method]
    if (!handler) throw new Error(`unexpected ${method}`)
    return handler(params, options)
  })
}
const calls = (method: string) => tunnel.computerCall.mock.calls.filter((call) => call[1] === method)

function workspace(description: ComputerDescription = mac) {
  const events: Array<[string, Record<string, unknown> | undefined]> = []
  const instance = new ComputerWorkspace({
    responseId: 'resp-1', chatId: 'chat-1', userId: 'user-1', session,
    described: Promise.resolve(description),
    onLeaseEvent: async (state, details) => { events.push([state, details]) },
  })
  return { instance, events }
}

beforeEach(() => {
  vi.clearAllMocks()
  manifest.loadWorkspaceAttachments.mockResolvedValue([])
  tunnel.createComputerDownload.mockResolvedValue({ transfer: { url: '/api/computer/transfers/down' }, dispose: vi.fn().mockResolvedValue(undefined) })
})

describe('computer paths', () => {
  it('keeps attachments in the attachments folder with the computer\'s separators', () => {
    const macPaths = computerWorkspacePaths(mac)
    expect(macPaths.attachment('my report.pdf', 'id-1')).toBe('/Users/ada/Pulpo/.pulpo/attachments/id-1-my_report.pdf')
    expect(macPaths.file('generated-x.png')).toBe('/Users/ada/Pulpo/.pulpo/attachments/generated-x.png')
    expect(macPaths.readable('/etc/hosts')).toBe(true)
    expect(macPaths.readable('notes.txt')).toBe(false)
    const winPaths = computerWorkspacePaths(windows)
    expect(winPaths.attachment('my report.pdf', 'id-1')).toBe('C:\\Users\\Ada\\Pulpo\\.pulpo\\attachments\\id-1-my_report.pdf')
    expect(winPaths.readable('D:\\data\\a.png')).toBe(true)
  })

  it('never restores a deliverable where it was attached from', () => {
    const restored = computerWorkspacePaths(mac).restoredAttachment({ id: 'id-2', originalName: 'out.csv', origin: 'assistant', workspacePath: '/Users/ada/Documents/out.csv' })
    expect(restored).toBe('/Users/ada/Pulpo/.pulpo/attachments/id-2-out.csv')
  })

  it('resolves relative and home paths the way the computer does', () => {
    expect(computerPath(mac, 'src/a.ts')).toBe('/Users/ada/Pulpo/src/a.ts')
    expect(computerPath(mac, '~/Desktop/x.png')).toBe('/Users/ada/Desktop/x.png')
    expect(computerPath(mac, '/tmp/../tmp/y')).toBe('/tmp/y')
    expect(computerPath(windows, 'out\\b.txt')).toBe('C:\\Users\\Ada\\Pulpo\\out\\b.txt')
    expect(computerPath(windows, '~\\Desktop')).toBe('C:\\Users\\Ada\\Desktop')
  })
})

describe('ComputerWorkspace.ensureLease', () => {
  it('stages missing attachments inline or through a transfer, and reports the computer ready', async () => {
    const small = new Uint8Array([1, 2, 3])
    const checksum = createHash('sha256').update(small).digest('base64url')
    const paths = computerWorkspacePaths(mac)
    manifest.loadWorkspaceAttachments.mockImplementation(async (_reply, given) => [
      { path: given.attachment('a.txt', 'a'), objectKey: 'k-a', mimeType: 'text/plain', checksum, sizeBytes: 3 },
      { path: given.attachment('big.bin', 'b'), objectKey: 'k-b', mimeType: 'application/octet-stream', checksum: null, sizeBytes: COMPUTER_INLINE_MAX_BYTES + 1 },
      { path: given.attachment('same.txt', 'c'), objectKey: 'k-c', mimeType: 'text/plain', checksum: null, sizeBytes: 1 },
    ])
    blobs.get.mockResolvedValue(small)
    const stream = Readable.from([Buffer.alloc(1)])
    blobs.getStream.mockResolvedValue(stream)
    serve({
      'file.missing': () => ({ missing: [paths.attachment('a.txt', 'a'), paths.attachment('big.bin', 'b')] }),
      'file.receive': (params) => ({ path: params.path }),
    })
    const { instance, events } = workspace()

    await expect(instance.ensureLease()).resolves.toBe(`computer:${session.sessionId}`)
    await expect(instance.ensureLease()).resolves.toBe(`computer:${session.sessionId}`)

    expect(events.map(([state]) => state)).toEqual(['provisioning', 'ready'])
    expect(calls('file.missing')).toHaveLength(1)
    expect(calls('file.missing')[0]![2]).toEqual({ files: [
      { path: paths.attachment('a.txt', 'a'), sizeBytes: 3, sha256: Buffer.from(checksum, 'base64url').toString('hex') },
      { path: paths.attachment('big.bin', 'b'), sizeBytes: COMPUTER_INLINE_MAX_BYTES + 1, sha256: null },
      { path: paths.attachment('same.txt', 'c'), sizeBytes: 1, sha256: null },
    ] })
    const [inline, transfer] = calls('file.receive').map((call) => call[2])
    expect(inline).toEqual({ path: paths.attachment('a.txt', 'a'), data: Buffer.from(small).toString('base64'), sizeBytes: 3, sha256: Buffer.from(checksum, 'base64url').toString('hex') })
    expect(transfer).toEqual({ path: paths.attachment('big.bin', 'b'), transfer: { url: '/api/computer/transfers/down' }, sizeBytes: COMPUTER_INLINE_MAX_BYTES + 1 })
    expect(tunnel.createComputerDownload).toHaveBeenCalledWith(session, stream, COMPUTER_INLINE_MAX_BYTES + 1)
    expect((await tunnel.createComputerDownload.mock.results[0]!.value).dispose).toHaveBeenCalled()
    expect(stream.destroyed).toBe(true)
    expect(instance.leaseId).toBeUndefined()
    const notice = await instance.contextNotice()
    expect(notice).toContain('user\'s own computer')
    expect(notice).toContain('Historical tool results may describe a different environment')
    expect(notice).toContain(JSON.stringify(paths.attachment('same.txt', 'c')))
  })

  it('keeps going when the computer refuses one attachment, and says which', async () => {
    manifest.loadWorkspaceAttachments.mockImplementation(async (_reply, given) => [
      { path: given.attachment('a.txt', 'a'), objectKey: 'k-a', mimeType: 'text/plain', checksum: null, sizeBytes: 1 },
    ])
    blobs.get.mockResolvedValue(new Uint8Array([1]))
    serve({
      'file.missing': (params) => ({ missing: (params.files as Array<{ path: string }>).map((file) => file.path) }),
      'file.receive': () => { throw new ComputerRequestError('failed', 'Disk full') },
    })
    const { instance, events } = workspace()
    await instance.ensureLease()
    expect(events.map(([state]) => state)).toEqual(['provisioning', 'ready'])
    expect(await instance.contextNotice()).toContain('could not be saved on the computer')
  })

  it('reports a computer that is not connected once and turns its tools off', async () => {
    serve({ describe: () => { throw new ComputerUnavailableError() } })
    const events: Array<[string, Record<string, unknown> | undefined]> = []
    const instance = new ComputerWorkspace({
      responseId: 'resp-1', chatId: 'chat-1', userId: 'user-1', session,
      onLeaseEvent: async (state, details) => { events.push([state, details]) },
    })

    await expect(instance.ensureLease()).rejects.toThrow(COMPUTER_UNAVAILABLE_MESSAGE)
    expect(events).toEqual([['provisioning', undefined], ['unavailable', { error: COMPUTER_UNAVAILABLE_MESSAGE }]])
    expect(instance.continuedWithoutAgent).toBe(true)
    await expect(instance.execute('op-1', 'bash', { command: 'ls' })).rejects.toThrow(COMPUTER_UNAVAILABLE_MESSAGE)
    expect(calls('describe')).toHaveLength(1)
    expect(tunnel.computerCall).toHaveBeenCalledTimes(1)
    expect(events).toHaveLength(2)
  })
})

describe('ComputerWorkspace.execute', () => {
  const running = (output: string) => ({ id: 'op-1', status: 'running', output, exitCode: null })

  it('starts the operation and long-polls it, reporting new output', async () => {
    const answers = [running('a'), running('a'), running('ab'), { id: 'op-1', status: 'completed', output: 'abc', exitCode: 0 }]
    serve({ 'file.missing': () => ({ missing: [] }), 'operation.start': () => running(''), 'operation.get': () => answers.shift() })
    const { instance } = workspace()
    const onUpdate = vi.fn(); const onStarted = vi.fn()

    const result = await instance.execute('op-1', 'bash', { command: 'make' }, undefined, onUpdate, onStarted)

    expect(result).toMatchObject({ status: 'completed', output: 'abc', exitCode: 0 })
    expect(calls('operation.start')[0]![2]).toEqual({ id: 'op-1', type: 'bash', args: { command: 'make' } })
    expect(onStarted).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls.map(([output]) => output)).toEqual(['a', 'ab', 'abc'])
    for (const call of calls('operation.get')) {
      expect(call[2]).toEqual({ id: 'op-1', waitMs: 10_000 })
      expect(call[3].timeoutMs).toBeGreaterThan(10_000)
    }
  })

  it('retries a lost poll before giving up', async () => {
    let failures = 1
    serve({
      'file.missing': () => ({ missing: [] }),
      'operation.start': () => running(''),
      'operation.get': () => {
        if (failures-- > 0) throw new ComputerUnavailableError()
        return { id: 'op-1', status: 'completed', output: 'done', exitCode: 0 }
      },
    })
    const { instance, events } = workspace()
    await expect(instance.execute('op-1', 'bash', { command: 'true' })).resolves.toMatchObject({ output: 'done' })
    expect(calls('operation.get')).toHaveLength(2)
    expect(events.map(([state]) => state)).toEqual(['provisioning', 'ready'])
  })

  it('cancels the operation and turns tools off when the computer stays away', async () => {
    serve({
      'file.missing': () => ({ missing: [] }),
      'operation.start': () => running(''),
      'operation.get': () => { throw new ComputerUnavailableError() },
      'operation.cancel': () => { throw new ComputerUnavailableError() },
    })
    const { instance, events } = workspace()
    await expect(instance.execute('op-1', 'bash', { command: 'sleep 9' })).rejects.toThrow(COMPUTER_UNAVAILABLE_MESSAGE)
    expect(calls('operation.get')).toHaveLength(3)
    expect(calls('operation.cancel')).toHaveLength(1)
    expect(events.at(-1)).toEqual(['unavailable', { error: COMPUTER_UNAVAILABLE_MESSAGE }])
    expect(instance.continuedWithoutAgent).toBe(true)
  }, 10_000)

  it('does not retry a refusal from the app', async () => {
    serve({
      'file.missing': () => ({ missing: [] }),
      'operation.start': () => running(''),
      'operation.get': () => { throw new ComputerRequestError('not_found', 'No such operation') },
      'operation.cancel': () => running(''),
    })
    const { instance } = workspace()
    await expect(instance.execute('op-1', 'bash', { command: 'x' })).rejects.toThrow('No such operation')
    expect(calls('operation.get')).toHaveLength(1)
    expect(instance.continuedWithoutAgent).toBe(false)
  })

  it('turns tools off when the app no longer knows the session, instead of failing call after call', async () => {
    serve({
      'file.missing': () => ({ missing: [] }),
      'operation.start': () => { throw new ComputerRequestError('unknown_session', 'The Pulpo app was restarted') },
    })
    const { instance, events } = workspace()
    await expect(instance.execute('op-1', 'bash', { command: 'x' })).rejects.toThrow('The Pulpo app was restarted')
    expect(instance.continuedWithoutAgent).toBe(true)
    expect(events.at(-1)).toEqual(['unavailable', { error: expect.stringContaining('The Pulpo app was restarted') }])
    // The next tool call is refused at once, without asking the computer again.
    await expect(instance.execute('op-2', 'bash', { command: 'y' })).rejects.toThrow()
    expect(calls('operation.start')).toHaveLength(1)
  })

  it('cancels on the computer when the reply is stopped', async () => {
    const controller = new AbortController()
    serve({
      'file.missing': () => ({ missing: [] }),
      'operation.start': () => running(''),
      'operation.get': (_params, options) => new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        setTimeout(() => controller.abort(new Error('Generation cancelled')), 10)
      }),
      'operation.cancel': () => ({ id: 'op-1', status: 'cancelled', output: '', exitCode: null }),
    })
    const { instance } = workspace()
    await expect(instance.execute('op-1', 'bash', { command: 'sleep 60' }, controller.signal)).rejects.toThrow('Generation cancelled')
    expect(calls('operation.cancel')[0]![2]).toEqual({ id: 'op-1' })
  })

  it('surfaces a failed operation', async () => {
    serve({ 'file.missing': () => ({ missing: [] }), 'operation.start': () => ({ id: 'op-1', status: 'failed', output: '', exitCode: null, error: 'ENOENT: no such file' }) })
    const { instance } = workspace()
    await expect(instance.execute('op-1', 'read', { path: 'x' })).rejects.toThrow('ENOENT: no such file')
  })
})

describe('ComputerWorkspace relay', () => {
  type Listed = { id: string; command: string; args: unknown }
  const request = (id: string, command = 'ls'): Listed => ({ id, command, args: { path: id } })
  const running = (...pending: Listed[]) => ({ id: 'op-1', status: 'running', output: '', exitCode: null, relay: { version: 1, pending } })
  const done = { id: 'op-1', status: 'completed', output: 'done', exitCode: 0, relay: { version: 1, pending: [] } }
  const delivered = () => calls('operation.relay').map((call) => call[2] as { requestId: string; result: { ok: boolean; output?: string; error?: string } })

  /** The app's side: each poll takes the next listing (the last one repeats), each delivery the next outcome. */
  function app(listings: unknown[], relay: Handler = () => ({ delivered: true }), extra: Record<string, Handler> = {}) {
    serve({
      'file.missing': () => ({ missing: [] }),
      'operation.start': () => running(),
      'operation.get': () => listings.length > 1 ? listings.shift() : listings[0],
      'operation.relay': relay,
      'operation.cancel': () => ({ id: 'op-1', status: 'cancelled', output: '', exitCode: null }),
      ...extra,
    })
  }

  it('answers a relay request and delivers the answer', async () => {
    app([running(request('r1', 'cat')), done])
    const onRelay = vi.fn().mockResolvedValue({ ok: true, output: '# Notes' })
    const { instance } = workspace()
    await expect(instance.execute('op-1', 'bash', { command: 'pulpo files cat r1' }, undefined, undefined, undefined, onRelay)).resolves.toMatchObject({ output: 'done' })
    expect(onRelay).toHaveBeenCalledTimes(1)
    expect(onRelay).toHaveBeenCalledWith(request('r1', 'cat'), undefined)
    expect(delivered()).toEqual([{ requestId: 'r1', result: { ok: true, output: '# Notes' } }])
    expect(calls('operation.relay')[0]![3]).toMatchObject({ timeoutMs: expect.any(Number) })
    expect(calls('operation.cancel')).toHaveLength(0)
  })

  it('answers several requests once each, including ones listed again or arriving later', async () => {
    // r2 is still listed after its answer (the app was slow to drop it); r3 arrives meanwhile.
    app([running(request('r1'), request('r2')), running(request('r2'), request('r3')), running(request('r3')), done])
    const onRelay = vi.fn(async (relayed: Listed) => ({ ok: true as const, output: `answer ${relayed.id}` }))
    const { instance } = workspace()
    await instance.execute('op-1', 'bash', { command: 'x' }, undefined, undefined, undefined, onRelay)
    expect(onRelay.mock.calls.map(([relayed]) => relayed.id)).toEqual(['r1', 'r2', 'r3'])
    expect(delivered().map((answer) => answer.requestId)).toEqual(['r1', 'r2', 'r3'])
  })

  it('drops a request the command stopped waiting for', async () => {
    app([running(request('r1')), running(request('r1')), done], () => ({ delivered: false }))
    const onRelay = vi.fn().mockResolvedValue({ ok: true, output: 'late' })
    const { instance } = workspace()
    await instance.execute('op-1', 'bash', { command: 'x' }, undefined, undefined, undefined, onRelay)
    expect(onRelay).toHaveBeenCalledTimes(1)
    expect(delivered()).toHaveLength(1)
  })

  it('resends an answer whose delivery failed, without answering again, and gives up on a refusal', async () => {
    const outcomes: Array<() => unknown> = [
      () => { throw new ComputerUnavailableError('The user\'s computer did not answer in time') },
      () => ({ delivered: true }),
      () => { throw new ComputerRequestError('invalid_request', 'No') },
    ]
    app([running(request('r1')), running(request('r1')), running(request('r2')), running(request('r2')), done], () => outcomes.shift()!())
    const onRelay = vi.fn(async (relayed: Listed) => ({ ok: true as const, output: relayed.id }))
    const { instance } = workspace()
    await instance.execute('op-1', 'bash', { command: 'x' }, undefined, undefined, undefined, onRelay)
    expect(onRelay.mock.calls.map(([relayed]) => relayed.id)).toEqual(['r1', 'r2'])
    expect(delivered()).toEqual([
      { requestId: 'r1', result: { ok: true, output: 'r1' } },
      { requestId: 'r1', result: { ok: true, output: 'r1' } },
      { requestId: 'r2', result: { ok: true, output: 'r2' } },
    ])
  })

  it('refuses requests when the reply has no Files', async () => {
    app([running(request('r1')), done])
    const { instance } = workspace()
    await instance.execute('op-1', 'bash', { command: 'pulpo files ls' })
    expect(delivered()).toEqual([{ requestId: 'r1', result: { ok: false, error: 'Files are not available in this chat' } }])
  })

  it('waits out a slow answer without polling or cancelling the command meanwhile', async () => {
    app([running(request('r1')), running(request('r2')), done])
    let pollsDuringAnswer = -1
    const onRelay = vi.fn(async (relayed: Listed) => {
      if (relayed.id === 'r1') {
        const before = calls('operation.get').length
        await new Promise((resolve) => setTimeout(resolve, 400))
        pollsDuringAnswer = calls('operation.get').length - before
      }
      return { ok: true as const, output: relayed.id }
    })
    const { instance } = workspace()
    await expect(instance.execute('op-1', 'bash', { command: 'x' }, undefined, undefined, undefined, onRelay)).resolves.toMatchObject({ status: 'completed' })
    expect(pollsDuringAnswer).toBe(0)
    expect(onRelay.mock.calls.map(([relayed]) => relayed.id)).toEqual(['r1', 'r2'])
    expect(calls('operation.cancel')).toHaveLength(0)
  })

  it('does not spin while the app keeps listing an answered request', async () => {
    let polls = 0
    app([running(request('r1'))], () => ({ delivered: false }), {
      'operation.get': () => (++polls > 3 ? done : running(request('r1'))),
    })
    const startedAt = Date.now()
    const { instance } = workspace()
    await instance.execute('op-1', 'bash', { command: 'x' }, undefined, undefined, undefined, vi.fn().mockResolvedValue({ ok: true, output: '' }))
    // The first answer is followed at once by a poll; the stale listings after it are a second apart.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_900)
  }, 10_000)

  it('cuts an answer to what one socket message should carry', async () => {
    const huge = 'é'.repeat(COMPUTER_RELAY_OUTPUT_MAX_BYTES)
    app([running(request('r1'), request('r2')), done])
    const onRelay = vi.fn(async (relayed: Listed) => relayed.id === 'r1' ? { ok: true as const, output: huge, data: { files: [] } } : { ok: false as const, error: huge })
    const { instance } = workspace()
    await instance.execute('op-1', 'bash', { command: 'x' }, undefined, undefined, undefined, onRelay)
    const [first, second] = delivered()
    for (const text of [first!.result.output!, second!.result.error!]) {
      expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(COMPUTER_RELAY_OUTPUT_MAX_BYTES)
      expect(text).toMatch(/^é+\n\[Output truncated; pull the file or narrow the command to see the rest\.\]$/)
    }
    expect(calls('operation.relay')[0]![2].result.data).toEqual({ files: [] })
    expect(boundRelayResult({ ok: true, output: 'small' })).toEqual({ ok: true, output: 'small' })
  })

  it('delivers the answer in progress when the reply is stopped, answers nothing more and cancels the command', async () => {
    const controller = new AbortController()
    app([running(request('r1'), request('r2')), done])
    const onRelay = vi.fn((_relayed: Listed, signal?: AbortSignal) => new Promise<{ ok: false; error: string }>((resolve) => {
      signal?.addEventListener('abort', () => resolve({ ok: false, error: 'The command was stopped' }))
      setTimeout(() => controller.abort(new Error('Generation cancelled')), 10)
    }))
    const { instance } = workspace()
    await expect(instance.execute('op-1', 'bash', { command: 'x' }, controller.signal, undefined, undefined, onRelay)).rejects.toThrow('Generation cancelled')
    expect(onRelay).toHaveBeenCalledTimes(1)
    expect(delivered()).toEqual([{ requestId: 'r1', result: { ok: false, error: 'The command was stopped' } }])
    expect(calls('operation.cancel')[0]![2]).toEqual({ id: 'op-1' })
  })
})

describe('ComputerWorkspace.localPath', () => {
  it('accepts absolute macOS paths anywhere, normalised', async () => {
    const { instance } = workspace()
    await instance.describe()
    expect(instance.localPath('/Users/ada/Pulpo Files/Plan.md')).toBe('/Users/ada/Pulpo Files/Plan.md')
    expect(instance.localPath('/Users/ada/x/../Pulpo Files//notes/')).toBe('/Users/ada/Pulpo Files/notes')
    expect(instance.localPath('/tmp/a')).toBe('/tmp/a')
    expect(instance.localPath('/')).toBe('/')
    for (const path of ['Pulpo Files/a', '~/a', 'C:\\Users\\a', '/tmp/a\0b', '']) expect(() => instance.localPath(path), path).toThrow('not an absolute path on the user\'s computer')
  })

  it('accepts absolute Windows paths with drive letters or shares, in Windows form', async () => {
    const { instance } = workspace(windows)
    await instance.describe()
    expect(instance.localPath('C:\\Users\\Ada\\Pulpo Files\\Plan.md')).toBe('C:\\Users\\Ada\\Pulpo Files\\Plan.md')
    expect(instance.localPath('C:/Users/Ada/Pulpo Files/notes/')).toBe('C:\\Users\\Ada\\Pulpo Files\\notes')
    expect(instance.localPath('d:\\data\\..\\out\\a.csv')).toBe('d:\\out\\a.csv')
    expect(instance.localPath('C:\\')).toBe('C:\\')
    expect(instance.localPath('\\\\server\\share\\a')).toBe('\\\\server\\share\\a')
    for (const path of ['Pulpo Files\\a', '\\Users\\a', 'C:relative', '/Users/ada', 'C:\\a\0b']) expect(() => instance.localPath(path), path).toThrow('not an absolute path on the user\'s computer')
  })

  it('refuses before the computer was reached', () => {
    expect(() => workspace().instance.localPath('/tmp/a')).toThrow('not available')
  })
})

describe('ComputerWorkspace files', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

  it('views a small image sent inline, resolving relative paths against the starting folder', async () => {
    const upload = { transfer: { url: '/api/computer/transfers/up' }, bytes: vi.fn(), open: vi.fn(), dispose: vi.fn().mockResolvedValue(undefined) }
    tunnel.createComputerUpload.mockResolvedValue(upload)
    serve({ 'file.missing': () => ({ missing: [] }), 'file.send': () => ({ sizeBytes: png.byteLength, data: png.toString('base64') }) })
    const { instance } = workspace()
    const image = await instance.viewImage('shots/a.png')
    expect(image).toMatchObject({ mimeType: 'image/png', sizeBytes: png.byteLength })
    expect(calls('file.send')[0]![2]).toEqual({ path: '/Users/ada/Pulpo/shots/a.png', transfer: upload.transfer, maxBytes: 20 * 1024 * 1024 })
    expect(upload.bytes).not.toHaveBeenCalled()
    expect(upload.dispose).toHaveBeenCalled()
  })

  it('exports a large file through the upload and refuses one over the limit', async () => {
    const data = new Uint8Array(COMPUTER_INLINE_MAX_BYTES + 10)
    const upload = { transfer: { url: '/api/computer/transfers/up' }, bytes: vi.fn().mockResolvedValue(data), open: vi.fn(), dispose: vi.fn().mockResolvedValue(undefined) }
    tunnel.createComputerUpload.mockResolvedValue(upload)
    let size = data.byteLength
    serve({ 'file.missing': () => ({ missing: [] }), 'file.send': () => ({ sizeBytes: size }) })
    const { instance } = workspace(windows)
    await expect(instance.exportFile('C:\\Users\\Ada\\report.docx')).resolves.toEqual({ data, sizeBytes: data.byteLength })
    expect(upload.bytes).toHaveBeenCalledWith(25 * 1024 * 1024)
    size = 26 * 1024 * 1024
    await expect(instance.exportFile('C:\\Users\\Ada\\huge.bin')).rejects.toThrow('byte limit')
    expect(upload.dispose).toHaveBeenCalledTimes(2)
  })

  it('saves generated files only for its own session', async () => {
    serve({ 'file.missing': () => ({ missing: [] }), 'file.receive': (params) => ({ path: params.path }) })
    const { instance } = workspace()
    const leaseId = await instance.ensureLease()
    const path = instance.paths.file('generated-1-cat.png')
    await expect(instance.saveGeneratedFile(path, png, 'image/png', 'other-lease')).rejects.toThrow('unavailable')
    await instance.saveGeneratedFile(path, png, 'image/png', leaseId)
    expect(calls('file.receive')[0]![2]).toEqual({ path, data: png.toString('base64'), sizeBytes: png.byteLength, sha256: createHash('sha256').update(png).digest('hex') })
    await expect(instance.readGeneratedFile(path, 'other-lease')).rejects.toThrow('unavailable')
  })
})

describe('ComputerWorkspace apps', () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('a window')])
  const state = { app: 'TextEdit', window: 'Notes.txt', windows: ['Notes.txt'], elements: [{ index: 1, depth: 0, role: 'button', label: 'Save', x: 1, y: 2, width: 3, height: 4 }], truncated: false }
  const picture = { mimeType: 'image/jpeg', width: 800, height: 600, sizeBytes: jpeg.byteLength }
  const withApps = { ...mac, apps: { version: 1, background: true } }

  it('knows whether the computer offers its apps once it was described', async () => {
    const plain = workspace().instance
    expect(plain.controlsApps).toBe(false)
    await plain.describe()
    expect(plain.controlsApps).toBe(false)
    const { instance } = workspace(withApps)
    await instance.describe()
    expect(instance.controlsApps).toBe(true)
  })

  it('lists the running apps', async () => {
    const apps = [{ name: 'TextEdit', allowed: true, frontmost: true, windows: ['Notes.txt'] }]
    serve({ 'file.missing': () => ({ missing: [] }), 'app.list': () => ({ apps }) })
    const started = vi.fn()
    expect(await workspace(withApps).instance.listApps(undefined, started)).toEqual(apps)
    expect(started).toHaveBeenCalledTimes(1)
  })

  it('acts in a window and returns it with its picture sent inline, waiting long enough for the user to allow the app', async () => {
    serve({ 'file.missing': () => ({ missing: [] }), 'app.act': () => ({ ...state, note: 'Pressed the Save button', image: { ...picture, data: jpeg.toString('base64') } }) })
    const view = await workspace(withApps).instance.useApp({ app: 'TextEdit', action: { type: 'click', element: 1 } })
    expect(view.state).toEqual({ ...state, note: 'Pressed the Save button' })
    expect(view.image).toEqual({ data: jpeg.toString('base64'), mimeType: 'image/jpeg', sizeBytes: jpeg.byteLength, width: 800, height: 600 })
    const [, , params, options] = calls('app.act')[0]!
    expect(params).toEqual({ app: 'TextEdit', action: { type: 'click', element: 1 } })
    expect(options.timeoutMs).toBe(210_000)
    expect(calls('file.send')).toHaveLength(0)
  })

  it('fetches a large picture from the path the computer named', async () => {
    const dispose = vi.fn().mockResolvedValue(undefined)
    tunnel.createComputerUpload.mockResolvedValue({ transfer: { url: '/api/computer/transfers/up' }, bytes: vi.fn().mockResolvedValue(new Uint8Array(jpeg)), dispose })
    serve({
      'file.missing': () => ({ missing: [] }),
      'app.act': () => ({ ...state, image: { ...picture, path: '/Users/ada/Library/Application Support/Pulpo/computer/app-images/shot-1.jpg' } }),
      'file.send': () => ({ sizeBytes: jpeg.byteLength }),
    })
    const view = await workspace(withApps).instance.useApp({ app: 'TextEdit', action: { type: 'view' } })
    expect(view.image.data).toBe(jpeg.toString('base64'))
    expect(calls('file.send')[0]![2]).toMatchObject({ path: '/Users/ada/Library/Application Support/Pulpo/computer/app-images/shot-1.jpg' })
    expect(dispose).toHaveBeenCalled()
  })

  it('refuses something that is not a picture, and passes on the app\'s refusal', async () => {
    serve({ 'file.missing': () => ({ missing: [] }), 'app.act': () => ({ ...state, image: { ...picture, data: Buffer.from('not an image').toString('base64') } }) })
    await expect(workspace(withApps).instance.useApp({ app: 'TextEdit', action: { type: 'view' } })).rejects.toThrow('not a PNG or JPEG image')
    serve({ 'file.missing': () => ({ missing: [] }), 'app.act': () => { throw new ComputerRequestError('not_allowed', 'The user has not allowed Pulpo Agent to use Safari.') } })
    const { instance } = workspace(withApps)
    await expect(instance.useApp({ app: 'Safari', action: { type: 'view' } })).rejects.toThrow('has not allowed Pulpo Agent to use Safari')
    // A refusal is about one app; the computer is still there.
    expect(instance.continuedWithoutAgent).toBe(false)
  })
})
