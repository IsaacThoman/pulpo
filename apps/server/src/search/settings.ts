import { eq } from 'drizzle-orm'
import { db } from '../database/client.js'
import { applicationSettings } from '../database/schema.js'
import { parseWebToolsSettings, type StoredWebToolsSettings } from '../settings/application-settings.js'

/** Saves on this replica clear it at once; the TTL bounds how stale other replicas get. */
const SEARCH_SETTINGS_TTL_MS = 30_000

let cached: { value: Promise<StoredWebToolsSettings>; expiresAt: number } | undefined

async function loadSearchSettings() {
  const [row] = await db.select({ value: applicationSettings.value }).from(applicationSettings)
    .where(eq(applicationSettings.key, 'webTools')).limit(1)
  return parseWebToolsSettings(row?.value)
}

/** Web tools settings for Search, shared across requests for a short while. */
export function readSearchSettings(now = Date.now()): Promise<StoredWebToolsSettings> {
  if (cached && cached.expiresAt > now) return cached.value
  const value = loadSearchSettings()
  const entry = { value, expiresAt: now + SEARCH_SETTINGS_TTL_MS }
  cached = entry
  // A failed read is not kept, so the next search tries the database again.
  value.catch(() => { if (cached === entry) cached = undefined })
  return value
}

export function invalidateSearchSettings(): void {
  cached = undefined
}
