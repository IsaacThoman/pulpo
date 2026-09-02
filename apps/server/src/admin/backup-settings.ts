import { createHash } from 'node:crypto'
import { Encrypter } from 'age-encryption'
import { eq } from 'drizzle-orm'
import { db } from '../database/client.js'
import { applicationSettings } from '../database/schema.js'
import { decryptSecret } from '../lib/crypto.js'
import { getConfig } from '../config.js'
import { parseBackupSettings, type StoredBackupSettings } from '../settings/application-settings.js'

const B2_ENDPOINT = /^s3\.([a-z0-9-]+)\.backblazeb2\.com$/

export interface ResolvedBackupSettings extends StoredBackupSettings {
  applicationKey: string
  region: string
}

export function normalizeBackupPrefix(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/') || 'pulpo'
}

export function parseB2Endpoint(value: string): { endpoint: string; region: string } {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Use an official Backblaze endpoint such as https://s3.us-west-004.backblazeb2.com')
  }
  const match = url.protocol === 'https:' && url.username === '' && url.password === ''
    && url.port === '' && (url.pathname === '' || url.pathname === '/') && !url.search && !url.hash
    ? B2_ENDPOINT.exec(url.hostname)
    : null
  if (!match) throw new Error('Use an official Backblaze endpoint such as https://s3.us-west-004.backblazeb2.com')
  return { endpoint: `https://${url.hostname}`, region: match[1]! }
}

export function ageRecipientDetails(recipient: string): { type: 'classic' | 'post_quantum'; fingerprint: string } {
  if (recipient.startsWith('AGE-SECRET-KEY')) throw new Error('Paste the public age recipient, never the private identity')
  const encrypter = new Encrypter()
  try {
    encrypter.addRecipient(recipient)
  } catch {
    throw new Error('Enter a valid classic or post-quantum age recipient')
  }
  return {
    type: recipient.startsWith('age1pq1') ? 'post_quantum' : 'classic',
    fingerprint: createHash('sha256').update(recipient).digest('base64url'),
  }
}

export async function readStoredBackupSettings(): Promise<StoredBackupSettings> {
  const [row] = await db.select({ value: applicationSettings.value }).from(applicationSettings)
    .where(eq(applicationSettings.key, 'backups')).limit(1)
  return parseBackupSettings(row?.value)
}

export function resolveBackupSettings(settings: StoredBackupSettings): ResolvedBackupSettings {
  if (!settings.encryptedApplicationKey) throw new Error('Backblaze application key is not configured')
  const { endpoint, region } = parseB2Endpoint(settings.endpoint)
  ageRecipientDetails(settings.recipient)
  return {
    ...settings,
    endpoint,
    prefix: normalizeBackupPrefix(settings.prefix),
    region,
    applicationKey: decryptSecret(settings.encryptedApplicationKey, getConfig().ENCRYPTION_KEY),
  }
}

export function backupSettingsForExport(settings: StoredBackupSettings): Omit<StoredBackupSettings, 'encryptedApplicationKey'> & { applicationKeyConfigured: boolean } {
  const { encryptedApplicationKey, ...safe } = settings
  return { ...safe, applicationKeyConfigured: Boolean(encryptedApplicationKey) }
}

export function backupSettingsAuditMetadata(settings: StoredBackupSettings, applicationKeyChanged: boolean) {
  return {
    enabled: settings.enabled,
    endpoint: settings.endpoint,
    bucket: settings.bucket,
    prefix: settings.prefix,
    intervalHours: settings.intervalHours,
    retentionDays: settings.retentionDays,
    recipientFingerprint: ageRecipientDetails(settings.recipient).fingerprint,
    applicationKeyChanged,
  }
}
