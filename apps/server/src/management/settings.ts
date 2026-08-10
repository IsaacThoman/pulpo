import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import {
  agentSettingsSchema,
  authSettingsSchema,
  instanceOcrSettingsSchema,
  interfaceSettingsSchema,
  loggingSettingsSchema,
  managementAccountSettingsSchema,
  managementSettingsDocumentSchema,
  managementWebToolsSettingsSchema,
  webToolsSettingsSchema,
  type ManagementSettingsChange,
  type ManagementSettingsDocument,
} from '@pulpo/contracts'
import { db } from '../database/client.js'
import { applicationSettings, auditEvents, models, userPreferences, users } from '../database/schema.js'
import { maintenanceQueue } from '../jobs.js'
import { encryptSecret } from '../lib/crypto.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { assertSafeProviderUrl } from '../lib/url-security.js'
import { publishStateChange } from '../responses/events.js'
import {
  parseAgentSettings,
  parseAuthSettings,
  parseInterfaceSettings,
  parseLoggingSettings,
  parseOcrSettings,
  parseWebToolsSettings,
} from '../settings/application-settings.js'
import { preferencesWithModelDefaults } from '../settings/model-preferences.js'
import { getConfig } from '../config.js'

export type ManagementSettingsMode = 'all' | 'account' | 'instance'

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonical(item)]))
}

function revisionOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('base64url')
}

function publicOcr(value: ReturnType<typeof parseOcrSettings>) {
  return {
    enabled: value.enabled,
    cacheEnabled: value.cacheEnabled,
    cacheTtlSeconds: value.cacheTtlSeconds,
    modelId: value.modelId,
    systemPrompt: value.systemPrompt,
  }
}

export async function loadManagementSettings(userId: string, database: typeof db = db): Promise<ManagementSettingsDocument> {
  const [[preferenceRow], [profile], settingRows] = await Promise.all([
    database.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1),
    database.select({
      username: users.username,
      profileColor: users.profileColor,
    }).from(users).where(eq(users.id, userId)).limit(1),
    database.select().from(applicationSettings),
  ])
  const byKey = new Map(settingRows.map((row) => [row.key, row.value]))
  const rawAccount = preferencesWithModelDefaults(preferenceRow?.values as Record<string, unknown> | undefined)
  const account = managementAccountSettingsSchema.parse({
    ...rawAccount,
    username: profile?.username,
    profileColor: profile?.profileColor ?? null,
  })
  const storedWebTools = parseWebToolsSettings(byKey.get('webTools'))
  const instance = {
    auth: parseAuthSettings(byKey.get('auth')),
    interface: parseInterfaceSettings(byKey.get('interface')),
    ocr: publicOcr(parseOcrSettings(byKey.get('ocr'))),
    agent: parseAgentSettings(byKey.get('agent')),
    webTools: {
      ...webToolsSettingsSchema.parse(storedWebTools),
      ...(storedWebTools.encryptedKagiApiKey ? { apiKey: { configured: true as const } } : {}),
    },
    logging: parseLoggingSettings(byKey.get('logging')),
  }
  const revision = revisionOf({
    account: preferenceRow?.values ?? {},
    profile,
    instance: [...settingRows].sort((left, right) => left.key.localeCompare(right.key))
      .map((row) => ({ key: row.key, value: row.value, updatedAt: row.updatedAt.toISOString() })),
  })
  return managementSettingsDocumentSchema.parse({
    apiVersion: 'pulpo.dev/management/v1',
    kind: 'Settings',
    revision,
    account,
    instance,
  })
}

function changesBetween(before: unknown, after: unknown, path = ''): ManagementSettingsChange[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return []
  if (
    before && after && typeof before === 'object' && typeof after === 'object'
    && !Array.isArray(before) && !Array.isArray(after)
  ) {
    const left = before as Record<string, unknown>
    const right = after as Record<string, unknown>
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    return keys.flatMap((key) => changesBetween(left[key], right[key], path ? `${path}.${key}` : key))
  }
  return [{ path, before, after }]
}

async function validateModelReferences(document: ManagementSettingsDocument, mode: ManagementSettingsMode): Promise<void> {
  const referenced = [
    ...(mode === 'instance' ? [] : [document.account.defaultModelId, ...document.account.favoriteModelIds]),
    ...(mode === 'account' ? [] : [document.instance.interface.localTask, document.instance.ocr.modelId]),
  ]
    .filter((id): id is string => Boolean(id && id !== 'current'))
  if (!referenced.length) return
  const rows = await db.select({ id: models.id }).from(models)
    .where(and(eq(models.enabled, true), eq(models.visible, true)))
  const available = new Set(rows.map((row) => row.id))
  const missing = referenced.find((id) => !available.has(id))
  if (missing) throw new AppError(400, 'model_unavailable', `Configured model ${missing} is unavailable`)
}

export async function planManagementSettings(
  userId: string,
  input: unknown,
  secrets: { webToolsApiKey?: string | null } = {},
  mode: ManagementSettingsMode = 'all',
) {
  const current = await loadManagementSettings(userId)
  const document = managementSettingsDocumentSchema.parse(input)
  await validateModelReferences(document, mode)
  const changes = changesBetween(
    { account: current.account, instance: current.instance },
    { account: document.account, instance: document.instance },
  ).filter((change) => (
    !change.path.endsWith('.apiKey')
    && (mode === 'all' || change.path.startsWith(`${mode}.`))
  ))
  if (mode !== 'account' && secrets.webToolsApiKey !== undefined) {
    changes.push({ path: 'instance.webTools.apiKey', before: { configured: 'redacted' }, after: { configured: secrets.webToolsApiKey !== null } })
  }
  // Preserve the caller's base revision. A file exported before a concurrent
  // change can still be diffed, but apply will reject it as stale.
  return { revision: document.revision, changes, document }
}

export async function applyManagementSettings(
  userId: string,
  actorUserId: string,
  input: unknown,
  expectedRevision: string,
  secrets: { webToolsApiKey?: string | null } = {},
  mode: ManagementSettingsMode = 'all',
): Promise<ManagementSettingsDocument> {
  const document = managementSettingsDocumentSchema.parse(input)
  if (document.revision !== expectedRevision) {
    throw new AppError(400, 'revision_mismatch', 'The settings document and planned revision do not match')
  }
  const current = await loadManagementSettings(userId)
  if (current.revision !== expectedRevision) {
    throw new AppError(409, 'settings_conflict', 'Settings changed after this plan was created')
  }
  await validateModelReferences(document, mode)
  const account = managementAccountSettingsSchema.parse(document.account)
  const auth = authSettingsSchema.parse(document.instance.auth)
  const iface = interfaceSettingsSchema.parse(document.instance.interface)
  const ocr = instanceOcrSettingsSchema.parse(document.instance.ocr)
  if (ocr.enabled && !ocr.modelId) throw new AppError(400, 'ocr_model_required', 'Select an OCR model before enabling OCR')
  const agent = agentSettingsSchema.parse(document.instance.agent)
  const webTools = managementWebToolsSettingsSchema.parse(document.instance.webTools)
  const logging = loggingSettingsSchema.parse(document.instance.logging)
  const { apiKey: _apiKey, ...publicWebTools } = webTools
  if (mode !== 'account' && webTools.firecrawl.baseUrl !== current.instance.webTools.firecrawl.baseUrl) {
    await assertSafeProviderUrl(webTools.firecrawl.baseUrl)
  }
  const previousTrashRetention = current.account.trashRetention
  const changedPaths = (await planManagementSettings(userId, document, secrets, mode)).changes.map((change) => change.path)
  if (!changedPaths.length) return current
  let publishedRevision: number | undefined
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(1886747744)`)
    const lockedCurrent = await loadManagementSettings(userId, tx as unknown as typeof db)
    if (lockedCurrent.revision !== expectedRevision) {
      throw new AppError(409, 'settings_conflict', 'Settings changed after this plan was created')
    }
    if (mode !== 'instance') {
      await tx.insert(userPreferences).values({ userId, values: account })
        .onConflictDoUpdate({ target: userPreferences.userId, set: { values: account, updatedAt: new Date() } })
      const [revision] = await tx.update(users).set({
        username: account.username,
        profileColor: account.profileColor,
        stateRevision: sql`${users.stateRevision} + 1`,
        updatedAt: new Date(),
      }).where(eq(users.id, userId)).returning({ revision: users.stateRevision })
      publishedRevision = revision?.revision
    }
    if (mode !== 'account') {
      const [existingWebTools] = await tx.select().from(applicationSettings).where(eq(applicationSettings.key, 'webTools')).limit(1)
      const storedWebTools = parseWebToolsSettings(existingWebTools?.value)
      const encryptedKagiApiKey = secrets.webToolsApiKey === undefined
        ? storedWebTools.encryptedKagiApiKey
        : secrets.webToolsApiKey === null ? null : encryptSecret(secrets.webToolsApiKey, getConfig().ENCRYPTION_KEY)
      const groups: Record<string, unknown> = {
        auth,
        interface: iface,
        ocr,
        agent,
        webTools: {
          ...publicWebTools,
          encryptedKagiApiKey,
          encryptedFirecrawlApiKey: storedWebTools.encryptedFirecrawlApiKey,
        },
        logging,
      }
      for (const [key, value] of Object.entries(groups)) {
        await tx.insert(applicationSettings).values({ key, value, updatedBy: actorUserId })
          .onConflictDoUpdate({ target: applicationSettings.key, set: { value, updatedBy: actorUserId, updatedAt: new Date() } })
      }
      await tx.delete(applicationSettings).where(eq(applicationSettings.key, 'publicUrl'))
    }
    await tx.insert(auditEvents).values({
      id: newId(), actorUserId, action: 'management.settings.apply', targetType: 'application',
      metadata: { changedPaths },
    })
  })
  if (publishedRevision !== undefined) await publishStateChange({ userId, revision: publishedRevision })
  if (mode !== 'instance' && previousTrashRetention !== account.trashRetention) {
    await maintenanceQueue.add('purge-chats', { type: 'purge-chats', payload: { userId } }, {
      jobId: `purge-chats-management-settings-${userId}-${Date.now()}`,
    })
  }
  return loadManagementSettings(userId)
}
