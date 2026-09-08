import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ folder: '', session: { instanceUrl: 'https://example.test', token: 'session-only' }, choose: true, consent: true, secure: true, fork: vi.fn(), request: vi.fn() }))
vi.mock('electron', () => ({
  app: { getPath: () => fake.folder, isPackaged: false },
  dialog: { showMessageBox: async () => ({ response: fake.consent ? 0 : 1 }), showOpenDialog: async () => ({ canceled: !fake.choose, filePaths: [path.join(fake.folder, 'project')] }) },
  safeStorage: { isEncryptionAvailable: () => fake.secure, encryptStringAsync: async (text: string) => Buffer.from(`encrypted:${text}`), decryptStringAsync: async (bytes: Buffer) => ({ result: bytes.toString().slice(10) }) },
  utilityProcess: { fork: fake.fork },
}))
vi.mock('./session-store', () => ({ loadStoredSession: async () => fake.session }))
beforeEach(async () => {
  vi.resetModules(); fake.folder = await mkdtemp(path.join(os.tmpdir(), 'pulpo-host-lifecycle-'))
  fake.choose = true; fake.consent = true; fake.secure = true
  fake.request.mockReset().mockResolvedValue({ ok: true, json: async () => ({ id: 'device', token: 'device-only' }) })
  fake.fork.mockReset().mockImplementation(() => Object.assign(new EventEmitter(), { postMessage: vi.fn() }))
  vi.stubGlobal('fetch', fake.request); vi.stubGlobal('PULPO_DEVELOPMENT_RG_PATH', '/bundled/rg')
})
afterEach(async () => { vi.unstubAllGlobals(); await rm(fake.folder, { recursive: true, force: true }) })
describe('desktop hosting consent and lifecycle', () => {
  it('requires native consent, a folder, and secure storage before registering a device', async () => {
    const host = await import('./workspace-host')
    fake.secure = false; await expect(host.enableHosting()).rejects.toThrow('secure credential storage')
    fake.secure = true; fake.consent = false; await host.enableHosting()
    fake.consent = true; fake.choose = false; await host.enableHosting()
    expect(fake.request).not.toHaveBeenCalled(); expect(fake.fork).not.toHaveBeenCalled()
  })
  it('persists encrypted authorization outside the working folder and revokes it on disable', async () => {
    const host = await import('./workspace-host')
    expect((await host.enableHosting()).enabled).toBe(true)
    const stored = await readFile(path.join(fake.folder, 'workspace-host.json'), 'utf8')
    expect(stored.startsWith('encrypted:')).toBe(true)
    const child = fake.fork.mock.results[0]!.value
    const start = child.postMessage.mock.calls[0][0]
    expect(start.token).toBe('device-only')
    expect(start.config.roots[0].path).toBe(path.join(fake.folder, 'project'))
    expect(start.config.journal).not.toContain('/project/')
    child.emit('message', { online: true }); expect(host.hostStatus().online).toBe(true)
    await host.disableHosting()
    expect(host.hostStatus().enabled).toBe(false)
    expect(child.postMessage).toHaveBeenCalledWith({ type: 'stop' })
    expect(fake.request.mock.calls.at(-1)?.[1].method).toBe('DELETE')
    await expect(readFile(path.join(fake.folder, 'workspace-host.json'))).rejects.toThrow()
  })
})
