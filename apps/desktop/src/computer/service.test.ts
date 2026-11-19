import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPUTER_INLINE_MAX_BYTES, type ComputerMethod, type ComputerResponse } from '@pulpo/contracts'
import { AccountResolver } from './account'
import { ComputerService, type ComputerServiceOptions } from './service'
import { startTransferServer, type TransferServer } from './test-helpers'

const USER_A = '00000000-0000-4000-8000-00000000000a'
const USER_B = '00000000-0000-4000-8000-00000000000b'
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64')

interface Harness {
  service: ComputerService
  identity: { session: { instanceUrl: string; token: string; expiresAt: string } | null; users: Record<string, string> }
  chooseFolder: ReturnType<typeof vi.fn>
  confirm: ReturnType<typeof vi.fn>
  trash: ReturnType<typeof vi.fn>
  changed: ReturnType<typeof vi.fn>
  clock: { now: number }
}

let base: string
let home: string
let server: TransferServer

function harness(origin: string, extra: Partial<ComputerServiceOptions> = {}): Harness {
  const identity: Harness['identity'] = { session: { instanceUrl: origin, token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00Z' }, users: { ['a'.repeat(43)]: USER_A, ['b'.repeat(43)]: USER_B } }
  const chooseFolder = vi.fn(async () => null as string | null)
  const confirm = vi.fn(async () => true)
  const trashDir = path.join(base, 'Trash')
  const trash = vi.fn(async (target: string) => { await mkdir(trashDir, { recursive: true }); await rename(target, path.join(trashDir, `${Date.now()}-${path.basename(target)}`)) })
  const changed = vi.fn()
  const clock = { now: Date.parse('2026-11-18T12:00:00Z') }
  const service = new ComputerService({
    userData: path.join(base, 'userData'),
    home,
    platform: process.platform,
    arch: 'arm64',
    osVersion: () => '15.1',
    allowHttpLocalhost: true,
    accounts: new AccountResolver({ loadSession: async () => identity.session, fetchUserId: async (_origin, token) => identity.users[token] ?? null }),
    chooseFolder,
    confirm,
    trash,
    onChangesChanged: changed,
    env: { PATH: '/usr/bin:/bin', SHELL: '/bin/sh' },
    now: () => clock.now,
    ...extra,
  })
  return { service, identity, chooseFolder, confirm, trash, changed, clock }
}

async function grantFolder(h: Harness, folder: string): Promise<void> {
  h.chooseFolder.mockResolvedValueOnce(folder)
  expect(await h.service.chooseFolder()).toEqual({ path: folder, name: path.basename(folder) })
}

function call(h: Harness, sessionId: string, method: ComputerMethod, params: unknown): Promise<ComputerResponse> {
  return h.service.handle({ id: randomUUID(), sessionId, method, params, timeoutMs: 30_000 })
}

async function ok<T = Record<string, unknown>>(response: Promise<ComputerResponse>): Promise<T> {
  const answer = await response
  if (!answer.ok) throw new Error(`${answer.code}: ${answer.message}`)
  return answer.result as T
}

async function refused(response: Promise<ComputerResponse>): Promise<{ code: string; message: string }> {
  const answer = await response
  if (answer.ok) throw new Error(`expected a refusal, got ${JSON.stringify(answer.result)}`)
  return { code: answer.code, message: answer.message }
}

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pulpo-computer-')))
  home = path.join(base, 'home')
  await mkdir(home)
  server = await startTransferServer()
})

afterEach(async () => {
  await server.close()
  await rm(base, { recursive: true, force: true })
})

describe('grants and sessions', () => {
  it('keeps grants per instance and account, and refuses when signed out', async () => {
    const h = harness(server.origin)
    const folder = path.join(home, 'project')
    await mkdir(folder)
    await grantFolder(h, folder)
    expect(await h.service.allowFullAccess()).toBe(true)
    expect(await h.service.allowFullAccess()).toBe(true)
    expect(h.confirm).toHaveBeenCalledTimes(1)
    expect(h.confirm.mock.calls[0]![0]).toMatch(/^Let Pulpo Agent run commands on this (Mac|PC|computer)\?$/)
    expect(await h.service.status()).toEqual({ fullAccess: true, folders: [{ path: folder, name: 'project' }], defaultFolder: { path: path.join(home, 'Pulpo'), name: 'Pulpo' }, signedIn: true })
    await expect(stat(path.join(home, 'Pulpo'))).rejects.toMatchObject({ code: 'ENOENT' })

    h.identity.session = { ...h.identity.session!, token: 'b'.repeat(43) }
    expect(await h.service.status()).toMatchObject({ fullAccess: false, folders: [] })
    await expect(h.service.begin({ sessionId: randomUUID(), access: 'read', folder })).resolves.toEqual({ ok: false, reason: 'folder_not_allowed' })
    await expect(h.service.begin({ sessionId: randomUUID(), access: 'full', folder: null })).resolves.toEqual({ ok: false, reason: 'full_access_not_allowed' })

    h.identity.session = { ...h.identity.session!, instanceUrl: 'https://other.example', token: 'a'.repeat(43) }
    expect(await h.service.status()).toMatchObject({ fullAccess: false, folders: [] })

    h.identity.session = null
    expect(await h.service.status()).toMatchObject({ fullAccess: false, folders: [], signedIn: false })
    await expect(h.service.begin({ sessionId: randomUUID(), access: 'full', folder: null })).resolves.toEqual({ ok: false, reason: 'signed_out' })
    expect(await h.service.chooseFolder()).toBeNull()
    expect(await h.service.allowFullAccess()).toBe(false)
  })

  it('remembers only an Allow, and ignores cancelled dialogs', async () => {
    const h = harness(server.origin)
    h.confirm.mockResolvedValueOnce(false)
    expect(await h.service.allowFullAccess()).toBe(false)
    expect(await h.service.chooseFolder()).toBeNull()
    expect(await h.service.status()).toMatchObject({ fullAccess: false, folders: [] })
  })

  it('checks every begin against the grants', async () => {
    const h = harness(server.origin)
    const folder = path.join(home, 'granted')
    const other = path.join(home, 'other')
    await mkdir(folder); await mkdir(other)
    await grantFolder(h, folder)
    await expect(h.service.begin({ sessionId: randomUUID(), access: 'write', folder: other })).resolves.toEqual({ ok: false, reason: 'folder_not_allowed' })
    await expect(h.service.begin({ sessionId: randomUUID(), access: 'suggest', folder: null })).resolves.toEqual({ ok: false, reason: 'folder_not_allowed' })
    await expect(h.service.begin({ sessionId: randomUUID(), access: 'write', folder: `${folder}/../other` })).resolves.toEqual({ ok: false, reason: 'folder_not_allowed' })
    await expect(h.service.begin({ sessionId: randomUUID(), access: 'full', folder })).resolves.toEqual({ ok: false, reason: 'full_access_not_allowed' })
    await h.service.allowFullAccess()
    await expect(h.service.begin({ sessionId: randomUUID(), access: 'full', folder: other })).resolves.toEqual({ ok: false, reason: 'folder_not_allowed' })
    await expect(h.service.begin({ sessionId: randomUUID(), access: 'full', folder })).resolves.toEqual({ ok: true })
    await expect(h.service.begin({ sessionId: 'not-a-uuid', access: 'full', folder: null })).rejects.toThrow()
    await expect(h.service.begin({ sessionId: randomUUID(), access: 'root' as never, folder: null })).rejects.toThrow()
  })

  it('ends sessions on request, after a day idle, and when the account changes', async () => {
    const h = harness(server.origin)
    await h.service.allowFullAccess()
    const first = randomUUID(); const second = randomUUID(); const third = randomUUID()
    await h.service.begin({ sessionId: first, access: 'full', folder: null })
    await h.service.begin({ sessionId: second, access: 'full', folder: null })
    expect(await h.service.sessions()).toEqual([first, second])
    await h.service.end(first)
    expect((await refused(call(h, first, 'describe', {}))).code).toBe('unknown_session')
    h.clock.now += 23 * 60 * 60_000
    await ok(call(h, second, 'describe', {}))
    h.clock.now += 23 * 60 * 60_000
    expect(await h.service.sessions()).toEqual([second])
    h.clock.now += 25 * 60 * 60_000
    expect(await h.service.sessions()).toEqual([])

    await h.service.begin({ sessionId: third, access: 'full', folder: null })
    h.identity.session = { ...h.identity.session!, token: 'b'.repeat(43) }
    await h.service.sessionChanged()
    expect(await h.service.sessions()).toEqual([])
  })

  it('keeps a running session through a network blip, and ends it when the sign-in changes while offline', async () => {
    const h = harness(server.origin)
    await h.service.allowFullAccess()
    const sessionId = randomUUID()
    await h.service.begin({ sessionId, access: 'full', folder: null })
    // The instance stops answering who the token belongs to; the stored sign-in is the same.
    const known = h.identity.users
    h.identity.users = {}
    await h.service.sessionChanged()
    expect(await h.service.sessions()).toEqual([sessionId])
    // Another account signs in while the instance still cannot be asked.
    h.identity.session = { ...h.identity.session!, token: 'b'.repeat(43) }
    await h.service.sessionChanged()
    expect(await h.service.sessions()).toEqual([])
    h.identity.users = known
  })

  it('refuses a session when another account signs in while it is being begun', async () => {
    const stored = { session: { instanceUrl: server.origin, token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00Z' } }
    let hold: Promise<void> | undefined
    const accounts = new AccountResolver({
      loadSession: async () => stored.session,
      fetchUserId: async (_origin, token) => { await hold; return token === 'a'.repeat(43) ? USER_A : USER_B },
    })
    const h = harness(server.origin, { accounts })
    expect(await h.service.allowFullAccess()).toBe(true)

    // The instance is slow to say whose token this is, and the user switches accounts meanwhile.
    accounts.forget()
    let answer!: () => void
    hold = new Promise<void>((resolve) => { answer = resolve })
    const sessionId = randomUUID()
    const begun = h.service.begin({ sessionId, access: 'full', folder: null })
    stored.session = { ...stored.session, token: 'b'.repeat(43) }
    await h.service.sessionChanged()
    answer()
    // The first account allowed full access; the one now signed in did not.
    expect(await begun).toEqual({ ok: false, reason: 'signed_out' })
    expect(await h.service.sessions()).toEqual([])
    expect((await refused(call(h, sessionId, 'describe', {}))).code).toBe('unknown_session')
    await expect(h.service.begin({ sessionId, access: 'full', folder: null })).resolves.toEqual({ ok: false, reason: 'full_access_not_allowed' })
  })

  it('refuses a session when what it needs is taken back while it is being begun', async () => {
    const stored = { session: { instanceUrl: server.origin, token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00Z' } }
    const accounts = new AccountResolver({ loadSession: async () => stored.session, fetchUserId: async () => USER_A })
    // Holds a session at its last check before it is registered.
    let hold: Promise<void> | undefined
    const signIn = accounts.signIn.bind(accounts)
    accounts.signIn = async () => { await hold; return signIn() }
    const h = harness(server.origin, { accounts })
    const folder = path.join(home, 'project'); await mkdir(folder)
    const other = path.join(home, 'other'); await mkdir(other)
    await grantFolder(h, folder)
    await grantFolder(h, other)
    expect(await h.service.allowFullAccess()).toBe(true)

    const beginWhile = async (input: { access: 'full' | 'read'; folder: string | null }, meanwhile: () => Promise<void>) => {
      let resume!: () => void
      hold = new Promise<void>((resolve) => { resume = resolve })
      const sessionId = randomUUID()
      const begun = h.service.begin({ sessionId, ...input })
      await new Promise((resolve) => setTimeout(resolve, 20))
      await meanwhile()
      hold = undefined
      resume()
      return { sessionId, result: await begun }
    }

    // Taking back something else leaves the session alone.
    const kept = await beginWhile({ access: 'read', folder }, () => h.service.forgetFolder(other))
    expect(kept.result).toEqual({ ok: true })
    expect(await h.service.sessions()).toEqual([kept.sessionId])
    await h.service.end(kept.sessionId)

    expect((await beginWhile({ access: 'full', folder: null }, () => h.service.revokeFullAccess())).result).toEqual({ ok: false, reason: 'full_access_not_allowed' })
    expect((await beginWhile({ access: 'read', folder }, () => h.service.forgetFolder(folder))).result).toEqual({ ok: false, reason: 'folder_not_allowed' })
    expect(await h.service.sessions()).toEqual([])
  })

  it('reads the account and its sign-in together', async () => {
    const stored = { session: { instanceUrl: server.origin, token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00Z' } }
    let answer!: () => void
    const hold = new Promise<void>((resolve) => { answer = resolve })
    const accounts = new AccountResolver({
      loadSession: async () => stored.session,
      fetchUserId: async (_origin, token) => { await hold; return token === 'a'.repeat(43) ? USER_A : USER_B },
    })
    const first = accounts.identity()
    const signedInAs = await accounts.signIn()
    stored.session = { ...stored.session, token: 'b'.repeat(43) }
    answer()
    // Still the pair that was read, never the first account under the second sign-in.
    expect(await first).toEqual({ account: { origin: server.origin, userId: USER_A }, signIn: signedInAs })
    expect(await accounts.signIn()).not.toBe(signedInAs)
    expect(await accounts.identity()).toEqual({ account: { origin: server.origin, userId: USER_B }, signIn: await accounts.signIn() })
  })

  it('takes back full access and forgets a folder, ending the sessions that used them', async () => {
    const h = harness(server.origin)
    const folder = path.join(home, 'project')
    await mkdir(folder, { recursive: true })
    await grantFolder(h, folder)
    await h.service.allowFullAccess()
    const full = randomUUID(); const reading = randomUUID()
    await h.service.begin({ sessionId: full, access: 'full', folder: null })
    await h.service.begin({ sessionId: reading, access: 'read', folder })

    await h.service.revokeFullAccess()
    expect(await h.service.sessions()).toEqual([reading])
    expect(await h.service.status()).toMatchObject({ fullAccess: false })
    expect(await h.service.begin({ sessionId: randomUUID(), access: 'full', folder: null })).toEqual({ ok: false, reason: 'full_access_not_allowed' })

    await h.service.forgetFolder(folder)
    expect(await h.service.sessions()).toEqual([])
    expect((await h.service.status()).folders).toEqual([])
    expect(await h.service.begin({ sessionId: randomUUID(), access: 'read', folder })).toEqual({ ok: false, reason: 'folder_not_allowed' })
  })
})

describe('handle', () => {
  it('never rejects and gates methods by access', async () => {
    const h = harness(server.origin)
    const folder = path.join(home, 'f'); await mkdir(folder)
    await grantFolder(h, folder)
    await h.service.allowFullAccess()
    const full = randomUUID(); const read = randomUUID()
    await h.service.begin({ sessionId: full, access: 'full', folder: null })
    await h.service.begin({ sessionId: read, access: 'read', folder })

    await expect(h.service.handle(null)).resolves.toMatchObject({ ok: false, code: 'invalid_request' })
    await expect(h.service.handle({ id: 'x', sessionId: full, method: 'describe' })).resolves.toMatchObject({ ok: false, code: 'invalid_request' })
    await expect(h.service.handle({ id: randomUUID(), sessionId: full, method: 'exec', params: {}, timeoutMs: 1 })).resolves.toMatchObject({ ok: false, code: 'invalid_request' })
    expect((await refused(call(h, randomUUID(), 'describe', {}))).code).toBe('unknown_session')
    for (const method of ['folder.list', 'folder.read', 'folder.change'] as const) expect((await refused(call(h, full, method, { path: '' }))).code).toBe('not_allowed')
    for (const method of ['describe', 'operation.start', 'operation.relay', 'file.send', 'file.receive', 'file.missing'] as const) expect((await refused(call(h, read, method, {}))).code).toBe('not_allowed')
    // Full access may answer relay requests, though only ones its own commands made.
    expect(await ok(call(h, full, 'operation.relay', { requestId: 'nobody', result: { ok: true, output: '' } }))).toEqual({ delivered: false })
    expect((await refused(call(h, full, 'operation.relay', { requestId: 'nobody', result: { ok: 'yes' } }))).code).toBe('invalid_request')
    expect(await refused(call(h, read, 'folder.list', { path: '', depth: 0, limit: 1 }))).toMatchObject({ code: 'invalid_request', message: expect.stringContaining('depth') })
  })

  it('does not start a command whose session ended while it was being prepared', async () => {
    const spawn = vi.fn()
    const h = harness(server.origin, { spawn: spawn as never })
    await h.service.allowFullAccess()
    const sessionId = randomUUID()
    await h.service.begin({ sessionId, access: 'full', folder: null })
    // The request is past its session check and waiting on the folder when the reply ends.
    const started = call(h, sessionId, 'operation.start', { id: 'late', type: 'bash', args: { command: 'echo late' } })
    await h.service.end(sessionId)
    expect((await refused(started)).code).toBe('unknown_session')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(spawn).not.toHaveBeenCalled()
    // Nothing was registered either, so the session's id cannot be used to reach it later.
    await h.service.begin({ sessionId, access: 'full', folder: null })
    expect((await refused(call(h, sessionId, 'operation.get', { id: 'late' }))).code).toBe('not_found')
  })

  it('describes the computer and creates the default folder on first use', async () => {
    const h = harness(server.origin)
    await h.service.allowFullAccess()
    const sessionId = randomUUID()
    await h.service.begin({ sessionId, access: 'full', folder: null })
    const description = await ok(call(h, sessionId, 'describe', {}))
    expect(description).toMatchObject({
      osVersion: process.platform === 'darwin' ? 'macOS 15.1' : expect.any(String),
      arch: 'arm64',
      // The harness names /bin/sh; Windows has no SHELL and uses PowerShell.
      shell: process.platform === 'win32' ? expect.stringMatching(/^(pwsh|powershell)$/) : 'sh',
      home, cwd: path.join(home, 'Pulpo'), attachmentsDir: path.join(base, 'userData', 'computer', 'attachments'),
    })
    // Without the CLI to run, Files are not offered.
    expect(description).not.toHaveProperty('filesDir')
    expect((await stat(path.join(home, 'Pulpo'))).isDirectory()).toBe(true)
    expect((await stat(description.attachmentsDir as string)).isDirectory()).toBe(true)
  })

  it.skipIf(process.platform === 'win32')('runs operations in the session folder', async () => {
    const h = harness(server.origin)
    const folder = path.join(home, 'work'); await mkdir(folder)
    await grantFolder(h, folder)
    await h.service.allowFullAccess()
    const sessionId = randomUUID()
    await h.service.begin({ sessionId, access: 'full', folder })
    await ok(call(h, sessionId, 'operation.start', { id: 'op', type: 'bash', args: { command: 'pwd' } }))
    let operation: Record<string, unknown> = {}
    for (let attempt = 0; attempt < 20 && operation.status !== 'completed'; attempt += 1) operation = await ok(call(h, sessionId, 'operation.get', { id: 'op', waitMs: 2_000 }))
    expect(operation).toMatchObject({ status: 'completed', output: `${folder}\n`, exitCode: 0 })
    expect((await refused(call(h, sessionId, 'operation.get', { id: 'unknown' }))).code).toBe('not_found')
    await h.service.end(sessionId)
  })

  it('sends, receives and inventories files with full access', async () => {
    const h = harness(server.origin)
    await h.service.allowFullAccess()
    const sessionId = randomUUID()
    await h.service.begin({ sessionId, access: 'full', folder: null })
    const small = path.join(base, 'small.txt'); await writeFile(small, 'small file')
    const large = path.join(base, 'large.bin'); const largeBytes = Buffer.alloc(COMPUTER_INLINE_MAX_BYTES + 1, 1); await writeFile(large, largeBytes)
    const transfer = { url: '/api/computer/transfers/one?token=t' }

    expect(await ok(call(h, sessionId, 'file.send', { path: small, transfer, maxBytes: 1_000 }))).toEqual({ sizeBytes: 10, data: b64('small file') })
    expect(await ok(call(h, sessionId, 'file.send', { path: large, transfer, maxBytes: 10_000_000 }))).toEqual({ sizeBytes: largeBytes.byteLength })
    expect(server.uploads.get(transfer.url)?.equals(largeBytes)).toBe(true)
    expect((await refused(call(h, sessionId, 'file.send', { path: large, transfer, maxBytes: 1_000 }))).code).toBe('too_large')
    expect((await refused(call(h, sessionId, 'file.send', { path: 'relative.txt', transfer, maxBytes: 1_000 }))).code).toBe('invalid_request')
    expect((await refused(call(h, sessionId, 'file.send', { path: path.join(base, 'missing'), transfer, maxBytes: 1_000 }))).code).toBe('not_found')

    const inlineTarget = path.join(base, 'in', 'a.txt')
    expect(await ok(call(h, sessionId, 'file.receive', { path: inlineTarget, data: b64('hello'), sizeBytes: 5, sha256: sha('hello') }))).toEqual({ path: inlineTarget })
    expect(await readFile(inlineTarget, 'utf8')).toBe('hello')
    server.downloads.set('/api/computer/transfers/two?token=t', Buffer.from('from server'))
    const transferTarget = path.join(base, 'in', 'b.txt')
    await ok(call(h, sessionId, 'file.receive', { path: transferTarget, transfer: { url: '/api/computer/transfers/two?token=t' }, sizeBytes: 11 }))
    expect(await readFile(transferTarget, 'utf8')).toBe('from server')
    expect((await refused(call(h, sessionId, 'file.receive', { path: path.join(base, 'bad.txt'), data: b64('hello'), sizeBytes: 5, sha256: 'f'.repeat(64) }))).message).toMatch(/checksum/)
    await expect(stat(path.join(base, 'bad.txt'))).rejects.toMatchObject({ code: 'ENOENT' })

    expect(await ok(call(h, sessionId, 'file.missing', { files: [
      { path: inlineTarget, sizeBytes: 5, sha256: sha('hello') },
      { path: transferTarget, sizeBytes: 11, sha256: sha('different') },
      { path: transferTarget, sizeBytes: 12, sha256: null },
      { path: path.join(base, 'nope'), sizeBytes: 0, sha256: null },
    ] }))).toEqual({ missing: [transferTarget, transferTarget, path.join(base, 'nope')] })
  })
})

describe('requests still being served when their session ends', () => {
  it('does not put a file in place that was still arriving', async () => {
    const h = harness(server.origin)
    await h.service.allowFullAccess()
    const sessionId = randomUUID()
    await h.service.begin({ sessionId, access: 'full', folder: null })
    const url = '/api/computer/transfers/late?token=t'
    server.downloads.set(url, Buffer.from('too late'))
    server.beforeDownload = async () => { await h.service.end(sessionId) }
    const target = path.join(base, 'in', 'late.txt')
    try {
      expect((await refused(call(h, sessionId, 'file.receive', { path: target, transfer: { url }, sizeBytes: 8 }))).code).toBe('unknown_session')
    } finally { server.beforeDownload = undefined }
    expect(await readdir(path.join(base, 'in')).catch(() => [])).toEqual([])
  })

  it('does not change a folder that was taken back while the new bytes arrived', async () => {
    const h = harness(server.origin)
    const folder = path.join(home, 'project'); await mkdir(folder)
    await writeFile(path.join(folder, 'a.txt'), 'kept')
    await grantFolder(h, folder)
    const sessionId = randomUUID()
    await h.service.begin({ sessionId, access: 'write', folder })
    const body = Buffer.alloc(COMPUTER_INLINE_MAX_BYTES + 5, 7)
    const url = '/api/computer/transfers/revoked?token=t'
    server.downloads.set(url, body)
    server.beforeDownload = async () => { await h.service.forgetFolder(folder) }
    try {
      const answer = await refused(call(h, sessionId, 'folder.change', { responseId: randomUUID(), change: { kind: 'put', path: 'a.txt', transfer: { url }, sizeBytes: body.byteLength, base: sha('kept') } }))
      expect(answer.code).toBe('unknown_session')
    } finally { server.beforeDownload = undefined }
    expect(await readFile(path.join(folder, 'a.txt'), 'utf8')).toBe('kept')
    expect(await readdir(folder)).toEqual(['a.txt'])
  })
})

describe('folder modes', () => {
  let h: Harness
  let folder: string

  async function session(access: 'read' | 'suggest' | 'write'): Promise<string> {
    const sessionId = randomUUID()
    expect(await h.service.begin({ sessionId, access, folder })).toEqual({ ok: true })
    return sessionId
  }

  const put = (sessionId: string, file: string, content: string, base: string | null, extra: Record<string, unknown> = {}) => call(h, sessionId, 'folder.change', {
    responseId: randomUUID(),
    change: { kind: 'put', path: file, data: b64(content), sizeBytes: Buffer.byteLength(content), base, ...extra },
  })

  beforeEach(async () => {
    h = harness(server.origin)
    folder = path.join(home, 'project')
    await mkdir(path.join(folder, 'src', 'deep'), { recursive: true })
    await mkdir(path.join(folder, 'node_modules', 'pkg'), { recursive: true })
    await mkdir(path.join(folder, '.git'))
    await writeFile(path.join(folder, 'README.md'), '# Project\nneedle here\n')
    await writeFile(path.join(folder, 'src', 'a.ts'), 'export const a = 1\n')
    await writeFile(path.join(folder, 'src', 'deep', 'b.ts'), 'needle\n')
    await writeFile(path.join(folder, 'src', 'image.png'), Buffer.from([137, 80, 78, 71, 0, 0, 0]))
    await writeFile(path.join(folder, 'node_modules', 'pkg', 'index.js'), 'needle')
    await writeFile(path.join(home, 'secret.txt'), 'needle secret')
    await symlink(path.join(home, 'secret.txt'), path.join(folder, 'escape.txt'))
    await grantFolder(h, folder)
  })

  it('lists depth-first in name order, leaving out skipped folders below the top', async () => {
    const sessionId = await session('read')
    const top = await ok<{ entries: Array<{ path: string; kind: string }> }>(call(h, sessionId, 'folder.list', { path: '', depth: 1, limit: 100 }))
    expect(top.entries.map((entry) => entry.path)).toEqual(['.git', 'README.md', 'node_modules', 'src'])
    const deep = await ok<{ entries: Array<{ path: string }>; skipped: string[]; truncated: boolean }>(call(h, sessionId, 'folder.list', { path: '', depth: 5, limit: 100 }))
    expect(deep.entries.map((entry) => entry.path)).toEqual(['README.md', 'src', 'src/a.ts', 'src/deep', 'src/deep/b.ts', 'src/image.png'])
    expect(deep.skipped).toEqual(['.git', 'node_modules'])
    const files = await ok<{ entries: Array<{ path: string; sizeBytes: number }>; truncated: boolean }>(call(h, sessionId, 'folder.list', { path: 'src', depth: 5, limit: 2, filesOnly: true }))
    expect(files).toMatchObject({ entries: [{ path: 'src/a.ts', sizeBytes: 19 }, { path: 'src/deep/b.ts' }], truncated: true })
    expect(await ok(call(h, sessionId, 'folder.list', { path: 'src/a.ts', depth: 1, limit: 10 }))).toMatchObject({ entries: [{ path: 'src/a.ts', kind: 'file' }], truncated: false })
    expect((await refused(call(h, sessionId, 'folder.list', { path: '../', depth: 1, limit: 10 }))).code).toBe('outside_folder')
    expect((await refused(call(h, sessionId, 'folder.list', { path: 'missing', depth: 1, limit: 10 }))).code).toBe('not_found')
  })

  it('reads UTF-8 text only, never through a symlink out of the folder', async () => {
    const sessionId = await session('read')
    expect(await ok(call(h, sessionId, 'folder.read', { path: 'README.md', maxBytes: 1_000 }))).toEqual({ text: '# Project\nneedle here\n', sizeBytes: 22, truncated: false })
    expect(await ok(call(h, sessionId, 'folder.read', { path: 'README.md', maxBytes: 5 }))).toEqual({ text: '# Pro', sizeBytes: 22, truncated: true })
    expect((await refused(call(h, sessionId, 'folder.read', { path: 'src/image.png', maxBytes: 1_000 }))).code).toBe('not_text')
    expect((await refused(call(h, sessionId, 'folder.read', { path: 'escape.txt', maxBytes: 1_000 }))).code).toBe('outside_folder')
    expect((await refused(call(h, sessionId, 'folder.read', { path: path.join(home, 'secret.txt'), maxBytes: 1_000 }))).code).toBe('outside_folder')
    expect((await refused(call(h, sessionId, 'folder.read', { path: 'src/../../secret.txt', maxBytes: 1_000 }))).code).toBe('outside_folder')
  })

  it('searches text files, skipping binaries, skipped folders and symlinks', async () => {
    const sessionId = await session('read')
    expect(await ok(call(h, sessionId, 'folder.search', { pattern: 'needle', path: '', limit: 10 }))).toEqual({
      matches: [{ path: 'README.md', line: 2, text: 'needle here' }, { path: 'src/deep/b.ts', line: 1, text: 'needle' }],
      truncated: false,
    })
    expect(await ok(call(h, sessionId, 'folder.search', { pattern: 'NEEDLE', path: 'src', limit: 10, ignoreCase: true }))).toMatchObject({ matches: [{ path: 'src/deep/b.ts' }] })
    expect(await ok(call(h, sessionId, 'folder.search', { pattern: 'needle', path: '', limit: 1 }))).toMatchObject({ truncated: true })
    expect(await ok(call(h, sessionId, 'folder.search', { pattern: 'a = (', path: '', limit: 10, fixed: true }))).toMatchObject({ matches: [] })
    expect((await refused(call(h, sessionId, 'folder.search', { pattern: '(', path: '', limit: 10 }))).code).toBe('invalid_request')
  })

  it('sends files inline or through the transfer with their version', async () => {
    const sessionId = await session('read')
    const transfer = { url: '/api/computer/transfers/f?token=t' }
    expect(await ok(call(h, sessionId, 'folder.send', { path: 'src/a.ts', transfer, maxBytes: 1_000 }))).toEqual({ sizeBytes: 19, version: sha('export const a = 1\n'), data: b64('export const a = 1\n') })
    const big = Buffer.alloc(COMPUTER_INLINE_MAX_BYTES + 10, 2)
    await writeFile(path.join(folder, 'big.bin'), big)
    expect(await ok(call(h, sessionId, 'folder.send', { path: 'big.bin', transfer, maxBytes: 10_000_000 }))).toEqual({ sizeBytes: big.byteLength, version: sha(big) })
    expect(server.uploads.get(transfer.url)?.equals(big)).toBe(true)
    expect((await refused(call(h, sessionId, 'folder.send', { path: 'big.bin', transfer, maxBytes: 10 }))).code).toBe('too_large')
  })

  it('refuses every change in read only', async () => {
    const sessionId = await session('read')
    expect(await ok(put(sessionId, 'new.txt', 'x', null))).toMatchObject({ status: 'denied' })
    expect(await ok(call(h, sessionId, 'folder.change', { responseId: randomUUID(), change: { kind: 'remove', path: 'README.md' } }))).toMatchObject({ status: 'denied' })
    await expect(stat(path.join(folder, 'new.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('applies changes directly in edit mode, with conflict checks, and trashes removals', async () => {
    const sessionId = await session('write')
    const current = sha('export const a = 1\n')
    expect(await ok(put(sessionId, 'src/new/c.ts', 'c', null))).toEqual({ status: 'created', message: '', version: sha('c') })
    expect(await readFile(path.join(folder, 'src', 'new', 'c.ts'), 'utf8')).toBe('c')
    expect(await ok(put(sessionId, 'src/a.ts', 'changed', 'stale'))).toMatchObject({ status: 'conflict', version: current })
    expect(await ok(put(sessionId, 'README.md', 'x', null))).toMatchObject({ status: 'conflict' })
    expect(await ok(put(sessionId, 'src/a.ts', 'changed', current))).toMatchObject({ status: 'updated', version: sha('changed') })
    expect(await ok(put(sessionId, 'src/a.ts', 'changed', sha('changed')))).toMatchObject({ status: 'unchanged' })
    expect(await ok(put(sessionId, 'src/a.ts', 'forced', 'whatever', { force: true }))).toMatchObject({ status: 'updated' })
    expect((await refused(put(sessionId, 'escape.txt', 'x', null, { force: true }))).code).toBe('outside_folder')
    expect(await readFile(path.join(home, 'secret.txt'), 'utf8')).toBe('needle secret')

    const change = (value: Record<string, unknown>) => call(h, sessionId, 'folder.change', { responseId: randomUUID(), change: value })
    expect(await ok(change({ kind: 'mkdir', path: 'docs/guides', parents: true }))).toMatchObject({ status: 'created' })
    expect(await ok(change({ kind: 'mkdir', path: 'docs' }))).toMatchObject({ status: 'unchanged' })
    expect(await ok(change({ kind: 'move', from: 'README.md', to: 'docs/README.md' }))).toMatchObject({ status: 'updated' })
    expect(await ok(change({ kind: 'move', from: 'src/new/c.ts', to: 'docs/README.md' }))).toMatchObject({ status: 'conflict' })
    expect((await refused(change({ kind: 'remove', path: 'src' }))).message).toMatch(/not empty/)
    expect(await ok(change({ kind: 'remove', path: 'src', recursive: true }))).toMatchObject({ status: 'updated', message: 'Moved src to the trash.' })
    expect(h.trash).toHaveBeenCalledWith(path.join(folder, 'src'))
    expect((await refused(change({ kind: 'remove', path: '.' }))).code).toBe('invalid_request')
    expect((await refused(change({ kind: 'move', from: 'docs', to: '../moved' }))).code).toBe('outside_folder')

    const recorded = await h.service.listChanges({ sessionIds: [sessionId] })
    expect(recorded.map((entry) => [entry.kind, entry.path, entry.status])).toEqual([
      ['create', 'src/new/c.ts', 'applied'], ['update', 'src/a.ts', 'applied'], ['update', 'src/a.ts', 'applied'],
      ['mkdir', 'docs/guides', 'applied'], ['move', 'README.md', 'applied'], ['remove', 'src', 'applied'],
    ])
    expect(h.changed).toHaveBeenCalled()
  })

  it('never changes the folder itself or anything through a symbolic link', async () => {
    const sessionId = await session('write')
    const change = (value: Record<string, unknown>) => call(h, sessionId, 'folder.change', { responseId: randomUUID(), change: value })
    await symlink(folder, path.join(folder, 'self'))
    await symlink(path.join(folder, 'src'), path.join(folder, 'sources'))
    // `rm -r self` must not send the whole shared folder to the trash, nor `rm -r sources` the real src.
    for (const name of ['self', 'sources']) {
      expect((await refused(change({ kind: 'remove', path: name, recursive: true }))).code).toBe('not_allowed')
      expect((await refused(change({ kind: 'move', from: name, to: 'elsewhere' }))).code).toBe('not_allowed')
    }
    expect((await refused(put(sessionId, 'sources/a.ts', 'through a link', sha('export const a = 1\n')))).code).toBe('not_allowed')
    expect((await refused(change({ kind: 'mkdir', path: 'self/new' }))).code).toBe('not_allowed')
    expect(h.trash).not.toHaveBeenCalled()
    expect(await readFile(path.join(folder, 'src', 'a.ts'), 'utf8')).toBe('export const a = 1\n')
    // Reading through a link that stays inside the folder is still fine.
    expect(await ok(call(h, sessionId, 'folder.read', { path: 'sources/a.ts', maxBytes: 1_000 }))).toMatchObject({ text: 'export const a = 1\n' })
  })

  it('does not accept a suggestion whose path has become a link since', async () => {
    const sessionId = await session('suggest')
    expect(await ok(call(h, sessionId, 'folder.change', { responseId: randomUUID(), change: { kind: 'remove', path: 'src', recursive: true } }))).toMatchObject({ status: 'suggested' })
    await rename(path.join(folder, 'src'), path.join(folder, 'real-src'))
    await symlink(folder, path.join(folder, 'src'))
    const [pending] = await h.service.listChanges({ sessionIds: [sessionId] })
    await expect(h.service.acceptChanges([pending!.id])).rejects.toThrow(/symbolic link/)
    expect(h.trash).not.toHaveBeenCalled()
  })

  it('refuses every change inside .git, where a config or hook would make git run things', async () => {
    const sessionId = await session('write')
    const change = (value: Record<string, unknown>) => call(h, sessionId, 'folder.change', { responseId: randomUUID(), change: value })
    for (const target of ['.git/config', '.git/hooks/pre-commit', 'src/.GIT/config']) {
      const answer = await refused(put(sessionId, target, '[core]\n\tfsmonitor = touch /tmp/pwned\n', null, { force: true }))
      expect(answer).toMatchObject({ code: 'not_allowed', message: expect.stringContaining('.git') })
    }
    expect((await refused(change({ kind: 'mkdir', path: '.git/hooks', parents: true }))).code).toBe('not_allowed')
    expect((await refused(change({ kind: 'move', from: 'README.md', to: '.git/README.md' }))).code).toBe('not_allowed')
    expect((await refused(change({ kind: 'remove', path: '.git', recursive: true }))).code).toBe('not_allowed')
    expect(await readdir(path.join(folder, '.git'))).toEqual([])
    // Suggest mode refuses too: accepting is one click away.
    const suggesting = await session('suggest')
    expect((await refused(put(suggesting, '.git/config', 'x', null))).code).toBe('not_allowed')
    // Looking inside is still allowed.
    expect(await ok(call(h, sessionId, 'folder.list', { path: '.git', depth: 1, limit: 10 }))).toMatchObject({ entries: [] })
  })

  it.skipIf(process.platform === 'win32')('keeps a replaced file\'s permissions, directly and when a suggestion is accepted', async () => {
    const script = path.join(folder, 'build.sh')
    await writeFile(script, '#!/bin/sh\necho one\n')
    await chmod(script, 0o755)
    const writing = await session('write')
    expect(await ok(put(writing, 'build.sh', '#!/bin/sh\necho two\n', sha('#!/bin/sh\necho one\n')))).toMatchObject({ status: 'updated' })
    expect((await stat(script)).mode & 0o777).toBe(0o755)

    const suggesting = await session('suggest')
    expect(await ok(put(suggesting, 'build.sh', '#!/bin/sh\necho three\n', sha('#!/bin/sh\necho two\n')))).toMatchObject({ status: 'suggested' })
    const [pending] = await h.service.listChanges({ sessionIds: [suggesting] })
    await h.service.acceptChanges([pending!.id])
    expect(await readFile(script, 'utf8')).toBe('#!/bin/sh\necho three\n')
    expect((await stat(script)).mode & 0o777).toBe(0o755)
  })

  it('reports a conflict when the user saves the file while the new bytes are still arriving', async () => {
    const sessionId = await session('write')
    const body = Buffer.alloc(COMPUTER_INLINE_MAX_BYTES + 5, 7)
    const url = '/api/computer/transfers/slow?token=t'
    server.downloads.set(url, body)
    server.beforeDownload = async () => { await writeFile(path.join(folder, 'src', 'a.ts'), 'saved by the user meanwhile\n') }
    try {
      const answer = await ok(call(h, sessionId, 'folder.change', {
        responseId: randomUUID(),
        change: { kind: 'put', path: 'src/a.ts', transfer: { url }, sizeBytes: body.byteLength, base: sha('export const a = 1\n') },
      }))
      expect(answer).toMatchObject({ status: 'conflict', version: sha('saved by the user meanwhile\n') })
    } finally { server.beforeDownload = undefined }
    expect(await readFile(path.join(folder, 'src', 'a.ts'), 'utf8')).toBe('saved by the user meanwhile\n')
    // Nothing is left behind beside the file.
    expect((await readdir(path.join(folder, 'src'))).filter((name) => name.endsWith('.pulpo-part'))).toEqual([])
  })

  it('answers unchanged, not conflict, when a push is repeated after its answer was lost', async () => {
    const sessionId = await session('write')
    const base = sha('export const a = 1\n')
    expect(await ok(put(sessionId, 'src/a.ts', 'new content', base))).toMatchObject({ status: 'updated' })
    // The same push again, still naming the version it pulled.
    expect(await ok(put(sessionId, 'src/a.ts', 'new content', base))).toMatchObject({ status: 'unchanged', version: sha('new content') })
    expect(await ok(put(sessionId, 'src/a.ts', 'something else', base))).toMatchObject({ status: 'conflict' })
  })

  it('names the folder, never its path, in errors the agent reads', async () => {
    const sessionId = await session('read')
    await rm(folder, { recursive: true, force: true })
    const answer = await refused(call(h, sessionId, 'folder.list', { path: '', depth: 1, limit: 10 }))
    expect(answer.message).toContain('project')
    expect(answer.message).not.toContain(home)
  })

  it('writes inline and transferred puts', async () => {
    const sessionId = await session('write')
    const body = Buffer.alloc(COMPUTER_INLINE_MAX_BYTES + 5, 3)
    server.downloads.set('/api/computer/transfers/p?token=t', body)
    expect(await ok(call(h, sessionId, 'folder.change', { responseId: randomUUID(), change: { kind: 'put', path: 'blob.bin', transfer: { url: '/api/computer/transfers/p?token=t' }, sizeBytes: body.byteLength, base: null } }))).toMatchObject({ status: 'created', version: sha(body) })
    expect((await readFile(path.join(folder, 'blob.bin'))).equals(body)).toBe(true)
  })

  it('stages suggestions and shows them to the agent as if accepted', async () => {
    const sessionId = await session('suggest')
    const original = 'export const a = 1\n'
    expect(await ok(put(sessionId, 'src/a.ts', 'export const a = 2\n', sha(original)))).toMatchObject({ status: 'suggested', version: sha('export const a = 2\n') })
    expect(await ok(put(sessionId, 'new/dir/c.ts', 'needle c\n', null))).toMatchObject({ status: 'suggested' })
    expect(await readFile(path.join(folder, 'src', 'a.ts'), 'utf8')).toBe(original)
    await expect(stat(path.join(folder, 'new'))).rejects.toMatchObject({ code: 'ENOENT' })

    expect(await ok(call(h, sessionId, 'folder.read', { path: 'src/a.ts', maxBytes: 100 }))).toMatchObject({ text: 'export const a = 2\n' })
    const listed = await ok<{ entries: Array<{ path: string; kind: string; sizeBytes: number }> }>(call(h, sessionId, 'folder.list', { path: '', depth: 5, limit: 100 }))
    expect(listed.entries.map((entry) => entry.path)).toEqual(['README.md', 'new', 'new/dir', 'new/dir/c.ts', 'src', 'src/a.ts', 'src/deep', 'src/deep/b.ts', 'src/image.png'])
    expect(await ok(call(h, sessionId, 'folder.list', { path: 'new/dir', depth: 1, limit: 10 }))).toMatchObject({ entries: [{ path: 'new/dir/c.ts', kind: 'file', sizeBytes: 9 }] })
    expect(await ok(call(h, sessionId, 'folder.search', { pattern: 'needle c', path: '', limit: 10 }))).toMatchObject({ matches: [{ path: 'new/dir/c.ts', line: 1 }] })
    expect(await ok(call(h, sessionId, 'folder.send', { path: 'src/a.ts', transfer: { url: '/api/computer/transfers/x' }, maxBytes: 100 }))).toMatchObject({ version: sha('export const a = 2\n') })

    // Conflict checks see the suggestion; a newer one replaces the pending one.
    expect(await ok(put(sessionId, 'src/a.ts', 'export const a = 3\n', sha(original)))).toMatchObject({ status: 'conflict', version: sha('export const a = 2\n') })
    expect(await ok(put(sessionId, 'src/a.ts', 'export const a = 3\n', sha('export const a = 2\n')))).toMatchObject({ status: 'suggested' })
    expect(await ok(put(sessionId, 'src/a.ts', 'export const a = 3\n', sha('export const a = 3\n')))).toMatchObject({ status: 'unchanged' })
    const change = (value: Record<string, unknown>) => call(h, sessionId, 'folder.change', { responseId: randomUUID(), change: value })
    expect(await ok(change({ kind: 'remove', path: 'README.md' }))).toMatchObject({ status: 'suggested' })
    expect(await ok(change({ kind: 'mkdir', path: 'later' }))).toMatchObject({ status: 'suggested' })
    expect(await ok(change({ kind: 'move', from: 'src/deep/b.ts', to: 'b.ts' }))).toMatchObject({ status: 'suggested' })
    await expect(stat(path.join(folder, 'README.md'))).resolves.toBeTruthy()

    const pending = await h.service.listChanges({ sessionIds: [sessionId] })
    expect(pending.map((entry) => [entry.kind, entry.path, entry.status])).toEqual([
      ['create', 'new/dir/c.ts', 'pending'], ['update', 'src/a.ts', 'pending'], ['remove', 'README.md', 'pending'], ['mkdir', 'later', 'pending'], ['move', 'src/deep/b.ts', 'pending'],
    ])
    const update = pending.find((entry) => entry.path === 'src/a.ts')!
    expect(await h.service.getChange(update.id)).toMatchObject({ before: original, after: 'export const a = 3\n', binary: false })
    expect(await h.service.getChange(pending[0]!.id)).toMatchObject({ before: null, after: 'needle c\n', binary: false })

    const accepted = await h.service.acceptChanges(pending.filter((entry) => entry.kind !== 'remove').map((entry) => entry.id))
    expect(accepted.map((entry) => entry.status)).toEqual(['accepted', 'accepted', 'accepted', 'accepted'])
    expect(await readFile(path.join(folder, 'src', 'a.ts'), 'utf8')).toBe('export const a = 3\n')
    expect(await readFile(path.join(folder, 'new', 'dir', 'c.ts'), 'utf8')).toBe('needle c\n')
    expect(await readFile(path.join(folder, 'b.ts'), 'utf8')).toBe('needle\n')
    expect((await stat(path.join(folder, 'later'))).isDirectory()).toBe(true)
    const rejected = await h.service.rejectChanges([pending[2]!.id, update.id])
    expect(rejected.map((entry) => [entry.path, entry.status])).toEqual([['README.md', 'rejected']])
    await expect(stat(path.join(folder, 'README.md'))).resolves.toBeTruthy()
    expect(h.trash).not.toHaveBeenCalled()
  })

  it('marks a suggestion whose file changed since as a conflict unless overwritten', async () => {
    const sessionId = await session('suggest')
    await ok(put(sessionId, 'src/a.ts', 'suggested\n', sha('export const a = 1\n')))
    const [suggestion] = await h.service.listChanges({ folder })
    await writeFile(path.join(folder, 'src', 'a.ts'), 'edited by the user\n')
    expect((await h.service.acceptChanges([suggestion!.id])).map((entry) => entry.status)).toEqual(['conflict'])
    expect(await readFile(path.join(folder, 'src', 'a.ts'), 'utf8')).toBe('edited by the user\n')
    expect((await h.service.acceptChanges([suggestion!.id], { overwrite: true })).map((entry) => entry.status)).toEqual(['accepted'])
    expect(await readFile(path.join(folder, 'src', 'a.ts'), 'utf8')).toBe('suggested\n')
  })

  it('keeps one account\'s changes from another', async () => {
    const sessionId = await session('suggest')
    await ok(put(sessionId, 'x.txt', 'x', null))
    expect(await h.service.listChanges({})).toHaveLength(1)
    h.identity.session = { ...h.identity.session!, token: 'b'.repeat(43) }
    expect(await h.service.listChanges({})).toEqual([])
    const [id] = (await (async () => { h.identity.session = { ...h.identity.session!, token: 'a'.repeat(43) }; return (await h.service.listChanges({})).map((entry) => entry.id) })())
    h.identity.session = { ...h.identity.session!, token: 'b'.repeat(43) }
    expect(await h.service.getChange(id!)).toBeNull()
    expect(await h.service.acceptChanges([id!])).toEqual([])
    await expect(stat(path.join(folder, 'x.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe.skipIf(process.platform === 'win32')('pulpo files in a full-access command', () => {
  let cliSource: string

  beforeEach(async () => {
    // What the Forge build makes of pulpo-cli.ts, bundled the same way.
    const { build } = await import('esbuild')
    cliSource = path.join(base, 'bundle', 'pulpo-cli.cjs')
    await build({ entryPoints: [path.join(import.meta.dirname, 'pulpo-cli.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: cliSource, logLevel: 'silent' })
  })

  async function poll(h: Harness, sessionId: string, id: string, until: (operation: Record<string, any>) => boolean): Promise<Record<string, any>> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const operation = await ok<Record<string, any>>(call(h, sessionId, 'operation.get', { id, waitMs: 2_000 }))
      if (until(operation)) return operation
      if (operation.status !== 'running') throw new Error(`stopped early: ${JSON.stringify(operation)}`)
    }
    throw new Error('gave up polling')
  }

  it('runs the CLI through the launcher, holds its request and delivers the server\'s answer', async () => {
    // Plain node stands in for the app's executable.
    const h = harness(server.origin, { pulpoCli: { executable: process.execPath, source: cliSource } })
    try {
      await h.service.allowFullAccess()
      const sessionId = randomUUID(); const other = randomUUID()
      await h.service.begin({ sessionId, access: 'full', folder: null })
      await h.service.begin({ sessionId: other, access: 'full', folder: null })
      const description = await ok(call(h, sessionId, 'describe', {}))
      const workspaceRoot = path.dirname(description.filesDir as string)
      expect(description.filesDir).toMatch(/[/\\]computer[/\\]workspaces[/\\][0-9a-f]{32}[/\\]files$/)
      expect((await stat(description.filesDir as string)).isDirectory()).toBe(true)

      const command = 'printf "%s|%s|%s\\n" "$PULPO_WORKSPACE_ROOT" "${ELECTRON_RUN_AS_NODE-unset}" "$(command -v pulpo)"; pulpo files ls notes'
      const started = await ok(call(h, sessionId, 'operation.start', { id: 'op-files', type: 'bash', args: { command } }))
      expect(started).toMatchObject({ status: 'running', relay: { version: 1, pending: [] } })
      const waiting = await poll(h, sessionId, 'op-files', (operation) => operation.relay?.pending.length > 0)
      expect(waiting.relay.pending).toEqual([{ id: expect.any(String), command: 'ls', args: { path: 'notes' } }])
      const [line] = (waiting.output as string).split('\n')
      expect(line).toBe(`${workspaceRoot}|unset|${path.join(base, 'userData', 'computer', 'bin', 'pulpo')}`)

      const requestId = waiting.relay.pending[0].id as string
      // Another session cannot answer for this command.
      expect(await ok(call(h, other, 'operation.relay', { requestId, result: { ok: true, output: 'wrong' } }))).toEqual({ delivered: false })
      expect(await ok(call(h, sessionId, 'operation.relay', { requestId, result: { ok: true, output: 'notes/plan.md\nnotes/todo.txt' } }))).toEqual({ delivered: true })
      const finished = await poll(h, sessionId, 'op-files', (operation) => operation.status !== 'running')
      expect(finished).toMatchObject({ status: 'completed', exitCode: 0, output: `${line}\nnotes/plan.md\nnotes/todo.txt\n`, relay: { version: 1, pending: [] } })
      expect(await ok(call(h, sessionId, 'operation.relay', { requestId, result: { ok: true, output: 'late' } }))).toEqual({ delivered: false })

      // A refusal is the command's failure, as in the cloud.
      await ok(call(h, sessionId, 'operation.start', { id: 'op-refused', type: 'bash', args: { command: 'pulpo files cat missing.txt' } }))
      const refusedRequest = await poll(h, sessionId, 'op-refused', (operation) => operation.relay?.pending.length > 0)
      await ok(call(h, sessionId, 'operation.relay', { requestId: refusedRequest.relay.pending[0].id, result: { ok: false, error: 'No such file in Files' } }))
      expect(await poll(h, sessionId, 'op-refused', (operation) => operation.status !== 'running'))
        .toMatchObject({ status: 'completed', exitCode: 1, output: 'pulpo files cat: No such file in Files\n' })
    } finally {
      await h.service.shutdown()
    }
  })

  it('offers no Files when the CLI cannot be installed', async () => {
    const errors: unknown[] = []
    const h = harness(server.origin, { pulpoCli: { executable: process.execPath, source: path.join(base, 'missing.cjs') }, onError: (_message, error) => errors.push(error) })
    await h.service.allowFullAccess()
    const sessionId = randomUUID()
    await h.service.begin({ sessionId, access: 'full', folder: null })
    expect(await ok(call(h, sessionId, 'describe', {}))).not.toHaveProperty('filesDir')
    expect(errors).toHaveLength(1)
    await h.service.shutdown()
  })
})
