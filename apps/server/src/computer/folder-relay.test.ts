import { Readable } from 'node:stream'
import { COMPUTER_INLINE_MAX_BYTES, COMPUTER_PULL_MAX_BYTES, COMPUTER_PULL_MAX_FILES, type ComputerFolderMode } from '@pulpo/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computerCall, ComputerRequestError, ComputerUnavailableError, createComputerDownload, createComputerUpload } from './tunnel.js'
import { createComputerFolderRelay, describeComputerFolder } from './folder-relay.js'

vi.mock('./tunnel.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./tunnel.js')>(),
  computerCall: vi.fn(),
  createComputerUpload: vi.fn(),
  createComputerDownload: vi.fn(),
}))

const callMock = vi.mocked(computerCall)
const session = { userId: 'user-1', sessionId: '6f1c1a9e-8a4e-4f7e-9d43-3c2f6b2b1a10' }
const responseId = '0b6c9b0e-1d0e-4d7a-9a55-6f3f5d1a2b3c'
type Answer = (method: string, params: Record<string, unknown>) => unknown

function setup(mode: ComputerFolderMode = 'write', answer: Answer = () => ({}), maxOutputBytes = 10_000) {
  callMock.mockImplementation((async (_session: unknown, method: string, params: Record<string, unknown>) => answer(method, params)) as never)
  const written = new Map<string, Buffer>()
  const workspace = {
    writeWorkspaceFile: vi.fn(async (path: string, body: Uint8Array | NodeJS.ReadableStream) => {
      if (body instanceof Uint8Array) { written.set(path, Buffer.from(body)); return }
      const chunks: Buffer[] = []
      for await (const chunk of body as Readable) chunks.push(Buffer.from(chunk as Uint8Array))
      written.set(path, Buffer.concat(chunks))
    }),
    readWorkspaceFile: vi.fn(async (path: string) => new Uint8Array(Buffer.from(`local ${path}`))),
  }
  const onChanged = vi.fn()
  const relay = createComputerFolderRelay({ session, responseId, mode, folder: '/Users/me/Projects/site', workspace, maxOutputBytes, onChanged })
  const run = (command: string, args: unknown) => relay('op-1', { id: 'r-1', command, args })
  return { run, workspace, written, onChanged }
}

const methods = () => callMock.mock.calls.map(([, method]) => method)
const file = (path: string, sizeBytes = 10) => ({ path, kind: 'file' as const, sizeBytes, modifiedAt: '2026-11-18T10:00:00.000Z' })
const folder = (path: string) => ({ path, kind: 'folder' as const, sizeBytes: 0, modifiedAt: '2026-11-18T10:00:00.000Z' })

beforeEach(() => {
  vi.mocked(createComputerUpload).mockReset()
  vi.mocked(createComputerDownload).mockReset()
  callMock.mockReset()
})

describe('pulpo computer relay: validation', () => {
  it('refuses unknown commands, unprefixed names and arguments outside the schema', async () => {
    const { run } = setup()
    expect(await run('ls', {})).toEqual({ ok: false, error: expect.stringContaining('Unknown command "ls"') })
    expect(await run('computer:chmod', {})).toEqual({ ok: false, error: expect.stringContaining('run pulpo computer --help') })
    expect(await run('computer:ls', { path: 'a', extra: true })).toMatchObject({ ok: false, error: expect.stringContaining('Invalid arguments for ls') })
    expect(await run('computer:pull', { path: 'a' })).toMatchObject({ ok: false })
    expect(callMock).not.toHaveBeenCalled()
  })

  it('stops paths that leave the folder before they reach the computer', async () => {
    const { run } = setup()
    for (const path of ['../secret', 'a/../../b', 'a\\b', 'C:/Windows', './x']) {
      expect(await run('computer:cat', { path }), path).toMatchObject({ ok: false, error: expect.stringContaining('not a valid path') })
    }
    expect(await run('computer:pull', { path: 'a', dest: '/etc/passwd' })).toMatchObject({ ok: false, error: expect.stringContaining('inside /workspace') })
    expect(await run('computer:pull', { path: 'a', dest: '/workspace/../etc' })).toMatchObject({ ok: false })
    expect(callMock).not.toHaveBeenCalled()
  })
})

describe('pulpo computer relay: reading', () => {
  it('lists entries with kind and size, noting truncation and skipped folders', async () => {
    const { run } = setup('read', () => ({ entries: [folder('src'), file('src/app.ts', 2048)], truncated: true, skipped: ['.git', 'src/node_modules'] }))
    const answer = await run('computer:ls', { path: '/src/', recursive: true })
    expect(callMock.mock.calls[0]?.[2]).toEqual({ path: 'src', depth: 8, limit: 300 })
    expect(answer).toEqual({ ok: true, output: [
      'src/  (folder)',
      'src/app.ts  (file, 2.0 KB, modified 2026-11-18)',
      '[Only the first 2 items are shown; list a folder inside to see more.]',
      '[Left out 2 folders ".git", "src/node_modules": folders named .git and node_modules are skipped. List one directly to look inside.]',
    ].join('\n') })
  })

  it('names the shared folder when it is empty, and ignores entries outside the listed path', async () => {
    const { run } = setup('read', () => ({ entries: [file('elsewhere.txt')], truncated: false }))
    expect(await run('computer:ls', { path: 'src' })).toEqual({ ok: true, output: '"src" is empty' })
    expect(await run('computer:ls', {})).toEqual({ ok: true, output: 'elsewhere.txt  (file, 10 B, modified 2026-11-18)' })
  })

  it('draws a tree relative to the path', async () => {
    const { run } = setup('read', () => ({ entries: [folder('src/lib'), file('src/lib/a.ts'), file('src/main.ts')], truncated: false }))
    expect(await run('computer:tree', { path: 'src', depth: 20 })).toEqual({ ok: true, output: 'src/\n  lib/\n    a.ts\n  main.ts' })
    expect(callMock.mock.calls[0]?.[2]).toEqual({ path: 'src', depth: 8, limit: 500 })
    expect(await run('computer:tree', {})).toMatchObject({ output: expect.stringMatching(/^site\/\n {4}lib\/\n {6}a\.ts\n {4}main\.ts$/) })
  })

  it('prints text files and search matches', async () => {
    const { run } = setup('read', (method) => method === 'folder.read'
      ? { text: 'hello', sizeBytes: 50_000, truncated: true }
      : { matches: [{ path: 'src/a.ts', line: 3, text: `// TODO ${'x'.repeat(400)}` }, { path: 'b.md', line: 1, text: 'todo' }], truncated: true })
    expect(await run('computer:cat', { path: 'notes.txt' })).toEqual({ ok: true, output: 'hello\n[Output truncated (48.8 KB in all); pull the file to see the rest.]' })
    expect(callMock.mock.calls[0]?.[2]).toEqual({ path: 'notes.txt', maxBytes: 10_000 })
    const grep = await run('computer:grep', { pattern: 'todo', ignoreCase: true })
    expect(callMock.mock.calls[1]?.[2]).toEqual({ pattern: 'todo', path: '', ignoreCase: true, limit: 200 })
    expect(grep).toMatchObject({ ok: true, output: expect.stringMatching(/^src\/a\.ts:3:\/\/ TODO x+…\nb\.md:1:todo\n\[Stopped after 2 matches/) })
  })

  it('cuts output to maxOutputBytes', async () => {
    const { run } = setup('read', () => ({ text: 'y'.repeat(500), sizeBytes: 500, truncated: false }), 100)
    const answer = await run('computer:cat', { path: 'big.txt' })
    expect(answer).toMatchObject({ ok: true, output: expect.stringMatching(/^y{100}\n\[Output truncated/) })
  })
})

describe('pulpo computer relay: pull', () => {
  function uploads() {
    const made: Array<{ dispose: ReturnType<typeof vi.fn> }> = []
    vi.mocked(createComputerUpload).mockImplementation(async () => {
      const upload = {
        transfer: { url: `/api/computer/transfers/u${made.length}?token=t` },
        open: vi.fn(async () => ({ stream: Readable.from([Buffer.from('streamed bytes')]), sizeBytes: 14 })),
        bytes: vi.fn(),
        dispose: vi.fn(async () => undefined),
      }
      made.push(upload)
      return upload
    })
    return made
  }

  it('copies a folder into the workspace, inline or through a transfer, and reports manifest entries', async () => {
    const made = uploads()
    let active = 0; let peak = 0
    const entries = Array.from({ length: 9 }, (_, index) => file(`src/f${index}.txt`))
    const { run, written } = setup('read', async (method, params) => {
      if (method === 'folder.list') return { entries, truncated: false, skipped: ['src/node_modules'] }
      active += 1; peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      const inline = params.path !== 'src/f0.txt'
      return { sizeBytes: inline ? 4 : 14, version: `sha-${String(params.path)}`, ...inline ? { data: Buffer.from('tiny').toString('base64') } : {} }
    })

    const answer = await run('computer:pull', { path: 'src', dest: '/workspace/computer/src' })

    expect(callMock.mock.calls[0]?.[2]).toEqual({ path: 'src', depth: 64, limit: COMPUTER_PULL_MAX_FILES + 1, filesOnly: true })
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1)
    expect(written.get('/workspace/computer/src/f0.txt')?.toString()).toBe('streamed bytes')
    expect(written.get('/workspace/computer/src/f1.txt')?.toString()).toBe('tiny')
    expect(made).toHaveLength(9)
    for (const upload of made) expect(upload.dispose).toHaveBeenCalled()
    expect(answer).toMatchObject({ ok: true, output: expect.stringContaining('Pulled 9 files from "src" into /workspace/computer/src') })
    expect((answer as { output: string }).output).toContain('[Left out the folder "src/node_modules"')
    expect((answer as { data: { files: unknown[] } }).data.files[1]).toEqual({ remote: 'src/f1.txt', local: '/workspace/computer/src/f1.txt', nodeId: 'src/f1.txt', version: 'sha-src/f1.txt', sizeBytes: 4 })
  })

  it('pulls a single file to the destination itself', async () => {
    uploads()
    const { run, written } = setup('read', (method) => method === 'folder.list'
      ? { entries: [file('notes.txt')], truncated: false }
      : { sizeBytes: 2, version: 'v', data: Buffer.from('hi').toString('base64') })
    expect(await run('computer:pull', { path: 'notes.txt', dest: '/workspace/tmp/n.txt' })).toMatchObject({ ok: true, output: 'Pulled "notes.txt" into /workspace/tmp/n.txt' })
    expect(written.get('/workspace/tmp/n.txt')?.toString()).toBe('hi')
  })

  it('enforces the file and size limits before moving anything', async () => {
    uploads()
    const tooMany = Array.from({ length: COMPUTER_PULL_MAX_FILES + 1 }, (_, index) => file(`f${index}`))
    let listing = { entries: tooMany, truncated: false }
    const { run } = setup('read', () => listing)
    expect(await run('computer:pull', { path: '', dest: '/workspace/computer' })).toEqual({ ok: false, error: '"site" holds more than 1000 files; pull the folders inside it one at a time' })
    listing = { entries: [file('a', COMPUTER_PULL_MAX_BYTES), file('b', 1)], truncated: false }
    expect(await run('computer:pull', { path: '', dest: '/workspace/computer' })).toMatchObject({ ok: false, error: expect.stringContaining('is larger than 500.0 MB; pull the folders inside it one at a time') })
    listing = { entries: [file('../x')], truncated: false }
    expect(await run('computer:pull', { path: '', dest: '/workspace/computer' })).toMatchObject({ ok: false, error: expect.stringContaining('not inside') })
    expect(methods().every((method) => method === 'folder.list')).toBe(true)
    expect(createComputerUpload).not.toHaveBeenCalled()
  })

  it('stops and disposes uploads when a file fails', async () => {
    const made = uploads()
    const { run } = setup('read', (method, params) => {
      if (method === 'folder.list') return { entries: [file('a'), file('b')], truncated: false }
      if (params.path === 'a') throw new ComputerRequestError('not_found', '"a" no longer exists')
      return { sizeBytes: 1, version: 'v', data: 'eA==' }
    })
    expect(await run('computer:pull', { path: '', dest: '/workspace/computer' })).toEqual({ ok: false, error: '"a" no longer exists' })
    for (const upload of made) expect(upload.dispose).toHaveBeenCalled()
  })
})

describe('pulpo computer relay: changes', () => {
  it('denies every push item and change command in read-only mode without asking the computer', async () => {
    const { run, workspace, onChanged } = setup('read')
    const push = await run('computer:push', { items: [{ local: '/workspace/computer/a.txt', remote: 'a.txt', base: { nodeId: 'a.txt', version: 'abc' } }] })
    expect(push).toMatchObject({ ok: true, data: { results: [{ local: '/workspace/computer/a.txt', remote: 'a.txt', status: 'denied', message: expect.stringContaining('"site" on the user\'s computer is read only') }] } })
    for (const [command, args] of [['mkdir', { path: 'x' }], ['mv', { from: 'a', to: 'b' }], ['rm', { path: 'a' }]] as const) {
      expect(await run(`computer:${command}`, args)).toEqual({ ok: false, error: expect.stringContaining('Pulpo Agent menu') })
    }
    expect(callMock).not.toHaveBeenCalled()
    expect(workspace.readWorkspaceFile).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('pushes small files inline and large ones through a download, with the pulled version as base', async () => {
    const dispose = vi.fn(async () => undefined)
    vi.mocked(createComputerDownload).mockResolvedValue({ transfer: { url: '/api/computer/transfers/d1?token=t' }, dispose })
    const { run, workspace, onChanged } = setup('suggest', (_method, params) => {
      const change = params.change as { path: string }
      return change.path === 'old.txt' ? { status: 'conflict', message: '', version: 'new-sha' } : { status: 'suggested', message: '', version: `sha-${change.path}` }
    })
    const big = new Uint8Array(COMPUTER_INLINE_MAX_BYTES + 1)
    workspace.readWorkspaceFile.mockImplementation(async (path: string) => path.endsWith('big.bin') ? big : new Uint8Array(Buffer.from('small')))

    const answer = await run('computer:push', { items: [
      { local: '/workspace/computer/a.txt', remote: 'a.txt', base: { nodeId: 'a.txt', version: 'sha-old' } },
      { local: '/workspace/out/big.bin', remote: 'data/big.bin', base: null, force: true },
      { local: '/workspace/computer/old.txt', remote: 'old.txt', base: { nodeId: 'old.txt', version: 'v0' } },
    ] })

    const changes = callMock.mock.calls.map(([, , params]) => (params as { change: unknown; responseId: string }))
    expect(changes[0]).toEqual({ responseId, change: { kind: 'put', path: 'a.txt', sizeBytes: 5, base: 'sha-old', data: Buffer.from('small').toString('base64') } })
    expect(changes[1]).toEqual({ responseId, change: { kind: 'put', path: 'data/big.bin', sizeBytes: big.byteLength, base: null, force: true, transfer: { url: '/api/computer/transfers/d1?token=t' } } })
    expect(createComputerDownload).toHaveBeenCalledWith(session, big, big.byteLength)
    expect(dispose).toHaveBeenCalled()
    expect(answer).toMatchObject({ ok: true, data: { results: [
      { local: '/workspace/computer/a.txt', remote: 'a.txt', status: 'suggested', nodeId: 'a.txt', version: 'sha-a.txt', message: expect.stringContaining('waits for the user') },
      { remote: 'data/big.bin', status: 'suggested' },
      { remote: 'old.txt', status: 'conflict', version: 'new-sha', message: expect.stringContaining('changed on the user\'s computer since you pulled it') },
    ] } })
    expect(onChanged).toHaveBeenLastCalledWith({ applied: 0, suggested: 2 })
  })

  it('reports bad items per file and keeps going', async () => {
    const { run } = setup('write', () => ({ status: 'created', message: '', version: 'v' }))
    const answer = await run('computer:push', { items: [
      { local: '/etc/passwd', remote: 'a.txt' },
      { local: '/workspace/computer/b.txt', remote: '../b.txt' },
      { local: '/workspace/computer/c.txt', remote: 'c.txt' },
    ] })
    expect(answer).toMatchObject({ ok: true, data: { results: [{ status: 'error' }, { status: 'error' }, { status: 'created', message: 'Created "c.txt"' }] } })
  })

  it('keeps running totals across commands and maps each change', async () => {
    const statuses = ['created', 'suggested', 'updated', 'unchanged']
    const { run, onChanged } = setup('write', (method) => method === 'folder.list'
      ? (() => { throw new ComputerRequestError('not_found', 'missing') })()
      : { status: statuses.shift(), message: '' })
    expect(await run('computer:mkdir', { path: 'a/b', parents: true })).toEqual({ ok: true, output: 'Created the folder "a/b/"' })
    expect(callMock.mock.calls[0]?.[2]).toEqual({ responseId, change: { kind: 'mkdir', path: 'a/b', parents: true } })
    expect(await run('computer:mv', { from: 'a.txt', to: 'b.txt' })).toEqual({ ok: true, output: 'Suggested moving "a.txt" to "b.txt"; it waits for the user to accept it' })
    expect(await run('computer:rm', { path: 'old', recursive: true })).toEqual({ ok: true, output: expect.stringContaining('Moved "old" to the trash') })
    expect(await run('computer:rm', { path: 'gone' })).toEqual({ ok: true, output: '"gone" is already gone' })
    expect(onChanged.mock.calls).toEqual([[{ applied: 1, suggested: 0 }], [{ applied: 1, suggested: 1 }], [{ applied: 2, suggested: 1 }]])
  })

  it('counts a path once for the reply, however often it was changed', async () => {
    const { run, onChanged } = setup('suggest', () => ({ status: 'suggested', message: '' }))
    await run('computer:mkdir', { path: 'notes' })
    await run('computer:rm', { path: 'old.txt' })
    await run('computer:rm', { path: 'old.txt' })
    await run('computer:mkdir', { path: 'notes' })
    expect(onChanged).toHaveBeenLastCalledWith({ applied: 0, suggested: 2 })
  })

  it('moves into an existing folder like mv', async () => {
    const { run } = setup('write', (method, params) => method === 'folder.list'
      ? { entries: params.path === 'archive' ? [file('archive/x.md')] : [file('Notes.md')], truncated: false }
      : { status: 'updated', message: '' })
    expect(await run('computer:mv', { from: 'docs/notes.md', to: 'archive' })).toEqual({ ok: true, output: 'Moved "docs/notes.md" to "archive/notes.md"' })
    expect(await run('computer:mv', { from: 'a.md', to: 'notes.md' })).toEqual({ ok: true, output: 'Moved "a.md" to "notes.md"' })
    expect(await run('computer:rm', { path: '/' })).toMatchObject({ ok: false })
  })

  it('turns refusals from the computer into errors', async () => {
    const { run } = setup('write', () => ({ status: 'denied', message: 'The desktop app refused' }))
    expect(await run('computer:rm', { path: 'a' })).toEqual({ ok: false, error: 'The desktop app refused' })
  })
})

describe('pulpo computer relay: errors', () => {
  it('explains a disconnected computer, passes request errors through and hides internals', async () => {
    const { run } = setup('read')
    callMock.mockRejectedValueOnce(new ComputerUnavailableError())
    expect(await run('computer:ls', {})).toEqual({ ok: false, error: expect.stringContaining('keep the Pulpo desktop app open') })
    callMock.mockRejectedValueOnce(new ComputerRequestError('not_text', '"a.bin" is not UTF-8 text'))
    expect(await run('computer:cat', { path: 'a.bin' })).toEqual({ ok: false, error: '"a.bin" is not UTF-8 text' })
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    callMock.mockRejectedValueOnce(new Error('redis exploded'))
    expect(await run('computer:ls', {})).toEqual({ ok: false, error: 'Pulpo could not complete this; try again' })
    log.mockRestore()
  })

  it('fails a push when the computer goes away instead of reporting each file', async () => {
    const { run } = setup('write')
    callMock.mockRejectedValue(new ComputerUnavailableError())
    expect(await run('computer:push', { items: [{ local: '/workspace/computer/a.txt', remote: 'a.txt' }] })).toEqual({ ok: false, error: expect.stringContaining('not connected') })
  })
})

describe('describeComputerFolder', () => {
  it('names the folder and the access, and explains the CLI', () => {
    const prompt = describeComputerFolder({ folder: '/Users/me/Projects/site', mode: 'suggest' })
    expect(prompt).toMatch(/^# Folder on the user's computer\n/)
    expect(prompt).toContain('`site` (you can suggest changes)')
    expect(prompt).not.toContain('/Users/me')
    expect(prompt).toContain('/workspace/computer/<path>')
    expect(prompt).toContain('pulpo computer --help')
    expect(prompt).toContain('`.git` and `node_modules`')
    expect(prompt).toContain('say that you suggested them')
    expect(prompt).toContain('untrusted data')
    expect(describeComputerFolder({ folder: 'C:\\Users\\me\\Docs', mode: 'read' })).toContain('`Docs` (read only)')
    expect(describeComputerFolder({ folder: '/x/we`ird\nname', mode: 'write' })).toContain('`weirdname` (you can edit it directly)')
    expect(describeComputerFolder({ folder: '/x/y', mode: 'write' })).toContain('apply on their computer right away')
  })
})
