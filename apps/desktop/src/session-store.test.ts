import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  userData: '',
  available: true,
  packaged: true,
  encryptStringAsync: vi.fn(async (value: string) => Buffer.from(value).reverse()),
  decryptStringAsync: vi.fn(async (value: Buffer) => ({ result: value.reverse().toString('utf8') })),
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() { return electron.packaged },
    getPath: () => electron.userData,
  },
  safeStorage: {
    isEncryptionAvailable: () => electron.available,
    encryptStringAsync: electron.encryptStringAsync,
    decryptStringAsync: electron.decryptStringAsync,
  },
}))

import { clearStoredSession, loadStoredSession, storeSession } from './session-store'

const session = {
  instanceUrl: 'https://pulpo.example',
  token: 's'.repeat(43),
  expiresAt: '2099-01-01T00:00:00.000Z',
}

describe('native session storage', () => {
  beforeEach(async () => {
    electron.userData = await mkdtemp(path.join(os.tmpdir(), 'pulpo-session-'))
    electron.available = true
    electron.packaged = true
    electron.encryptStringAsync.mockClear()
    electron.decryptStringAsync.mockClear()
  })

  afterEach(async () => {
    await rm(electron.userData, { recursive: true, force: true })
  })

  it('encrypts the complete session and restores it', async () => {
    await storeSession(session)

    const stored = await readFile(path.join(electron.userData, 'native-session.json'), 'utf8')
    expect(stored).not.toContain(session.token)
    expect(stored).not.toContain(session.instanceUrl)
    await expect(loadStoredSession()).resolves.toEqual(session)
  })

  it('rejects expired sessions', async () => {
    await storeSession({ ...session, expiresAt: '2020-01-01T00:00:00.000Z' })
    await expect(loadStoredSession()).resolves.toBeNull()
  })

  it('allows development localhost sessions but not packaged ones', async () => {
    const local = { ...session, instanceUrl: 'http://localhost:3000' }
    electron.packaged = false
    await storeSession(local)
    await expect(loadStoredSession()).resolves.toEqual(local)
    electron.packaged = true
    await expect(loadStoredSession()).resolves.toBeNull()
  })

  it('fails closed when Keychain-backed encryption is unavailable and clears credentials', async () => {
    electron.available = false
    await expect(storeSession(session)).rejects.toThrow('Secure credential storage is unavailable')
    electron.available = true
    await storeSession(session)
    await clearStoredSession()
    await expect(loadStoredSession()).resolves.toBeNull()
  })
})
