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
const { COMPUTER_UNAVAILABLE_MESSAGE, ComputerWorkspace, computerPath, computerWorkspacePaths } = await import('./computer-workspace.js')

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
