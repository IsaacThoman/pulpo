import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import type { DesktopSignedInAccount, DesktopSignedInAccounts, DesktopStoredSession } from './globals'

/** Accounts kept signed in alongside the active one. */
const MAX_OTHER_ACCOUNTS = 4

interface StoredEnvelope {
  version: 1
  encryptedSession: string
}

function sessionPath(): string {
  return path.join(app.getPath('userData'), 'native-session.json')
}

function accountsPath(): string {
  return path.join(app.getPath('userData'), 'native-accounts.json')
}

async function loadEncrypted(file: string): Promise<unknown> {
  if (!safeStorage.isEncryptionAvailable()) return null
  const envelope = JSON.parse(await readFile(file, 'utf8')) as StoredEnvelope
  if (envelope.version !== 1 || typeof envelope.encryptedSession !== 'string') return null
  const decrypted = await safeStorage.decryptStringAsync(Buffer.from(envelope.encryptedSession, 'base64'))
  return JSON.parse(decrypted.result) as unknown
}

async function storeEncrypted(file: string, value: unknown): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable.')
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(value))
  const envelope: StoredEnvelope = {
    version: 1,
    encryptedSession: encrypted.toString('base64'),
  }
  const temporary = `${file}.tmp`
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(envelope)}\n`, { mode: 0o600 })
  await rename(temporary, file)
}

function trustedInstanceOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const instance = new URL(value)
  const localhost = ['localhost', '127.0.0.1', '[::1]'].includes(instance.hostname)
  if (instance.username || instance.password || (instance.protocol !== 'https:' && !(!app.isPackaged && localhost && instance.protocol === 'http:'))) return null
  return instance.origin
}

function unexpired(expiresAt: unknown): expiresAt is string {
  return typeof expiresAt === 'string' && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) > Date.now()
}

export async function loadStoredSession(): Promise<DesktopStoredSession | null> {
  try {
    const value = await loadEncrypted(sessionPath()) as Partial<DesktopStoredSession> | null
    if (!value || typeof value.token !== 'string' || value.token.length < 32 || !unexpired(value.expiresAt)) return null
    const instanceUrl = trustedInstanceOrigin(value.instanceUrl)
    return instanceUrl ? { instanceUrl, token: value.token, expiresAt: value.expiresAt } : null
  } catch {
    return null
  }
}

export async function storeSession(session: DesktopStoredSession): Promise<void> {
  await storeEncrypted(sessionPath(), session)
}

export async function clearStoredSession(): Promise<void> {
  await rm(sessionPath(), { force: true }).catch(() => undefined)
}

function validAccount(value: unknown): value is DesktopSignedInAccount {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<DesktopSignedInAccount>
  return typeof candidate.userId === 'string' && candidate.userId.length > 0
    && typeof candidate.token === 'string' && candidate.token.length >= 32
    && unexpired(candidate.expiresAt)
}

export async function loadSignedInAccounts(): Promise<DesktopSignedInAccounts | null> {
  try {
    const value = await loadEncrypted(accountsPath()) as Partial<DesktopSignedInAccounts> | null
    const instanceUrl = trustedInstanceOrigin(value?.instanceUrl)
    if (!instanceUrl || !Array.isArray(value?.accounts)) return null
    return { instanceUrl, accounts: value.accounts.filter(validAccount).slice(0, MAX_OTHER_ACCOUNTS) }
  } catch {
    return null
  }
}

export async function storeSignedInAccounts(value: DesktopSignedInAccounts): Promise<void> {
  if (value.accounts.length === 0) {
    await rm(accountsPath(), { force: true }).catch(() => undefined)
    return
  }
  await storeEncrypted(accountsPath(), { instanceUrl: value.instanceUrl, accounts: value.accounts.slice(0, MAX_OTHER_ACCOUNTS) })
}
