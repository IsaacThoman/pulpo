import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import type { DesktopStoredSession } from './globals'

interface StoredEnvelope {
  version: 1
  encryptedSession: string
}

function sessionPath(): string {
  return path.join(app.getPath('userData'), 'native-session.json')
}

export async function loadStoredSession(): Promise<DesktopStoredSession | null> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    const envelope = JSON.parse(await readFile(sessionPath(), 'utf8')) as StoredEnvelope
    if (envelope.version !== 1 || typeof envelope.encryptedSession !== 'string') return null
    const decrypted = await safeStorage.decryptStringAsync(Buffer.from(envelope.encryptedSession, 'base64'))
    const value = JSON.parse(decrypted.result) as Partial<DesktopStoredSession>
    if (typeof value.instanceUrl !== 'string' || typeof value.token !== 'string' || value.token.length < 32 || typeof value.expiresAt !== 'string') return null
    const instance = new URL(value.instanceUrl)
    const localhost = ['localhost', '127.0.0.1', '[::1]'].includes(instance.hostname)
    if (instance.username || instance.password || (instance.protocol !== 'https:' && !(!app.isPackaged && localhost && instance.protocol === 'http:'))) return null
    if (!Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) return null
    return { instanceUrl: instance.origin, token: value.token, expiresAt: value.expiresAt }
  } catch {
    return null
  }
}

export async function storeSession(session: DesktopStoredSession): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable.')
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(session))
  const envelope: StoredEnvelope = {
    version: 1,
    encryptedSession: encrypted.toString('base64'),
  }
  const destination = sessionPath()
  const temporary = `${destination}.tmp`
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(envelope)}\n`, { mode: 0o600 })
  await rename(temporary, destination)
}

export async function clearStoredSession(): Promise<void> {
  await rm(sessionPath(), { force: true }).catch(() => undefined)
}
