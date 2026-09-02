import { createHash } from 'node:crypto'
import { and, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { agentSettingsSchema, backupSettingsTestInputSchema, backupSettingsUpdateSchema, dictationSettingsSchema, episodicMemorySettingsSchema, episodicMemoryStatisticsRangeSchema, personalizationSettingsSchema, secretRevealInputSchema, webToolProviderSchema, webToolsSettingsSchema } from '@pulpo/contracts'
import { requireAdmin } from '../auth/service.js'
import { requireSecretRevealAuth } from '../auth/sensitive-action.js'
import { db } from '../database/client.js'
import { applicationSettings, auditEvents, backupJobs, banners, exportJobs, models, users } from '../database/schema.js'
import { maintenanceQueue } from '../jobs.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { getBlobStore } from '../storage/index.js'
import { authSettingsSchema, interfaceSettingsSchema, loggingSettingsSchema, ocrSettingsSchema, parseBackupSettings, parseBillingSettings, parseDictationSettings, parseInterfaceSettings, parseOcrSettings, parseWebToolsSettings, publicDictationSettings, publicWebToolsSettings, storedDictationSettingsSchema, storedWebToolsSettingsSchema } from '../settings/application-settings.js'
import { decryptSecret, encryptSecret } from '../lib/crypto.js'
import { getConfig } from '../config.js'
import { workspaceControllerRequest } from '../agent/controller-http.js'
import { resolveLegacyOcrCatalogModel } from '../responses/catalog-model-runtime.js'
import { assertSafeProviderUrl } from '../lib/url-security.js'
import { firstUnavailableModelReference, newAccountModelReferenceIds } from '../settings/new-account-defaults.js'
import { refreshStorageLimit } from '../billing/storage-entitlements.js'
import { publishStateChange } from '../responses/events.js'
import { cancelEpisodicMemoryBuild, readEpisodicMemoryAdminStatus, requestEpisodicMemoryRebuild, updateEpisodicMemorySettings } from '../episodic-memory/settings.js'
import { ageRecipientDetails, backupSettingsAuditMetadata, normalizeBackupPrefix, parseB2Endpoint, readStoredBackupSettings, resolveBackupSettings } from './backup-settings.js'
import { B2BackupStore } from './b2-backup-store.js'
import { createOffsiteBackup } from './backup-scheduler.js'
import { isAgeEncryptedBackup } from './backup-encryption.js'

function validatedB2Endpoint(value: string): { endpoint: string; region: string } {
  try {
    return parseB2Endpoint(value)
  } catch (error) {
    throw new AppError(400, 'invalid_backup_endpoint', error instanceof Error ? error.message : 'Invalid Backblaze endpoint')
  }
}

function validatedAgeRecipient(value: string): ReturnType<typeof ageRecipientDetails> {
  try {
    return ageRecipientDetails(value)
  } catch (error) {
    throw new AppError(400, 'invalid_backup_recipient', error instanceof Error ? error.message : 'Invalid age recipient')
  }
}

async function publicBackupSettings() {
  const settings = await readStoredBackupSettings()
  const configured = Boolean(settings.encryptedApplicationKey && settings.endpoint && settings.bucket && settings.keyId && settings.recipient)
  const recipient = settings.recipient ? ageRecipientDetails(settings.recipient) : null
  const jobs = await db.select().from(backupJobs).where(eq(backupJobs.destination, 'backblaze_b2'))
    .orderBy(desc(backupJobs.createdAt)).limit(100)
  const lastSuccess = jobs.find((job) => job.status === 'completed')
  const lastFailure = jobs.find((job) => job.status === 'failed')
  const active = jobs.find((job) => job.status === 'queued' || job.status === 'in_progress')
  const failureIsLatest = Boolean(lastFailure && (!lastSuccess || lastFailure.updatedAt > lastSuccess.updatedAt))
  const health = !configured ? 'unconfigured'
    : !settings.enabled ? 'disabled'
      : failureIsLatest ? 'failed'
        : active || !lastSuccess ? 'pending'
          : 'healthy'
  return {
    enabled: settings.enabled,
    endpoint: settings.endpoint,
    bucket: settings.bucket,
    prefix: settings.prefix,
    keyId: settings.keyId,
    recipient: settings.recipient,
    intervalHours: settings.intervalHours,
    retentionDays: settings.retentionDays,
    applicationKeyConfigured: Boolean(settings.encryptedApplicationKey),
    recipientType: recipient?.type ?? null,
    recipientFingerprint: recipient?.fingerprint ?? null,
    nextRunAt: settings.enabled ? settings.nextRunAt : null,
    health,
    lastSuccessfulAt: lastSuccess?.completedAt?.toISOString() ?? null,
    lastError: failureIsLatest ? lastFailure?.error ?? 'Backup failed' : null,
  }
}

export async function registerAdminSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/banners', async () => {
    const now = new Date()
    return { data: await db.select().from(banners).where(and(
      or(isNull(banners.startsAt), lt(banners.startsAt, now)),
      or(isNull(banners.endsAt), gt(banners.endsAt, now)),
    )).orderBy(desc(banners.createdAt)) }
  })

  app.get('/api/interface/suggested-prompts', async () => {
    const [setting] = await db.select({ value: applicationSettings.value })
      .from(applicationSettings)
      .where(eq(applicationSettings.key, 'interface'))
      .limit(1)
    const iface = parseInterfaceSettings(setting?.value)
    if (!iface.suggestedPromptsEnabled || iface.suggestedPromptsCount <= 0 || iface.suggestedPrompts.length === 0) {
      return { enabled: false, count: 0, prompts: [] as Array<{ id: string; label: string; message: string }> }
    }
    return {
      enabled: true,
      count: iface.suggestedPromptsCount,
      prompts: iface.suggestedPrompts.map(({ id, label, message }) => ({ id, label, message })),
    }
  })

  app.get('/api/admin/settings', async (request) => {
    requireAdmin(request)
    const rows = await db.select().from(applicationSettings)
    return { values: Object.fromEntries(rows.filter((row) => !['ocr', 'webTools', 'dictation', 'episodicMemory', 'backups'].includes(row.key)).map((row) => [row.key, row.value])) }
  })

  app.patch('/api/admin/settings', async (request) => {
    const admin = requireAdmin(request)
    const values = z.record(z.string().min(1).max(120), z.unknown()).parse(request.body)
    if (values.publicUrl !== undefined) throw new AppError(400, 'deployment_setting_read_only', 'PUBLIC_URL is managed by the deployment environment')
    if (values.auth !== undefined) {
      const authSettings = authSettingsSchema.parse(values.auth)
      const referencedModelIds = newAccountModelReferenceIds(authSettings)
      if (referencedModelIds.length) {
        const available = await db.select({ id: models.id }).from(models)
          .where(and(eq(models.enabled, true), eq(models.visible, true)))
        const missing = firstUnavailableModelReference(referencedModelIds, available.map((model) => model.id))
        if (missing) {
          throw new AppError(400, 'new_account_model_unavailable', `Configured model ${missing} is unavailable`)
        }
      }
      values.auth = authSettings
    }
    if (values.logging !== undefined) values.logging = loggingSettingsSchema.parse(values.logging)
    if (values.interface !== undefined) {
      const interfaceSettings = interfaceSettingsSchema.parse(values.interface)
      values.interface = interfaceSettings
      const selected = interfaceSettings.localTask
      if (selected !== 'current') {
        const [model] = await db.select({ id: models.id }).from(models)
          .where(and(eq(models.id, selected), eq(models.enabled, true), eq(models.visible, true))).limit(1)
        if (!model) throw new AppError(400, 'task_model_unavailable', 'The selected task model is unavailable')
      }
    }
    if (values.personalization !== undefined) values.personalization = personalizationSettingsSchema.parse(values.personalization)
    if (values.agent !== undefined) values.agent = agentSettingsSchema.parse(values.agent)
    // OCR settings use the dedicated endpoint and never pass through this generic settings API.
    if (values.ocr !== undefined) throw new AppError(400, 'dedicated_ocr_endpoint', 'Use /api/admin/settings/ocr for OCR settings')
    if (values.webTools !== undefined) throw new AppError(400, 'dedicated_web_tools_endpoint', 'Use /api/admin/settings/web-tools for web tool settings')
    if (values.dictation !== undefined) throw new AppError(400, 'dedicated_dictation_endpoint', 'Use /api/admin/settings/dictation for dictation settings')
    if (values.episodicMemory !== undefined) throw new AppError(400, 'dedicated_episodic_memory_endpoint', 'Use /api/admin/settings/episodic-memory for episodic memory settings')
    if (values.backups !== undefined) throw new AppError(400, 'dedicated_backups_endpoint', 'Use /api/admin/settings/backups for backup settings')
    const changes = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(1886747744)`)
      let storageRevisions: Array<{ userId: string; revision: number }> = []
      for (const [key, value] of Object.entries(values)) {
        await tx.insert(applicationSettings).values({ key, value, updatedBy: admin.id })
          .onConflictDoUpdate({ target: applicationSettings.key, set: { value, updatedBy: admin.id, updatedAt: new Date() } })
      }
      if (values.auth !== undefined) {
        const defaultStorageLimitBytes = authSettingsSchema.parse(values.auth).defaultStorageLimitBytes
        if (getConfig().PULPO_BILLING_ENABLED) {
          const [billingRow] = await tx.select({ value: applicationSettings.value }).from(applicationSettings)
            .where(eq(applicationSettings.key, 'billing')).limit(1)
          const billing = { ...parseBillingSettings(billingRow?.value), babyStorageLimitBytes: defaultStorageLimitBytes }
          await tx.insert(applicationSettings).values({ key: 'billing', value: billing, updatedBy: admin.id })
            .onConflictDoUpdate({ target: applicationSettings.key, set: { value: billing, updatedBy: admin.id, updatedAt: new Date() } })
        }
        const userRows = await tx.select({ id: users.id }).from(users)
        const changedIds: string[] = []
        for (const { id } of userRows) {
          if (await refreshStorageLimit(tx, id)) changedIds.push(id)
        }
        if (changedIds.length > 0) {
          storageRevisions = await tx.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` })
            .where(inArray(users.id, changedIds)).returning({ userId: users.id, revision: users.stateRevision })
          await tx.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: 'billing.storage_defaults.refresh', targetType: 'billing', targetId: 'baby', metadata: { changedUsers: changedIds.length } })
        }
      }
      await tx.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: 'settings.update', targetType: 'application', metadata: { keys: Object.keys(values) } })
      return storageRevisions
    })
    await Promise.all(changes.map((change) => publishStateChange({ ...change, scopes: ['billing', 'usage'] })))
    return { values }
  })

  app.get('/api/admin/settings/agent/status', async (request) => {
    requireAdmin(request)
    const config = getConfig()
    if (!config.WORKSPACE_CONTROLLER_URL || !config.WORKSPACE_CONTROLLER_TOKEN) return { configured: false, healthy: false }
    try {
      const response = await workspaceControllerRequest('/healthz', { signal: AbortSignal.timeout(5_000) }, false)
      return { configured: true, healthy: response.ok, detail: response.ok ? undefined : `Controller returned ${response.status}` }
    } catch (error) {
      return { configured: true, healthy: false, detail: error instanceof Error ? error.message : String(error) }
    }
  })

  app.get('/api/admin/settings/episodic-memory', async (request) => {
    requireAdmin(request)
    const range = episodicMemoryStatisticsRangeSchema.parse((request.query as { range?: unknown }).range ?? '24h')
    return readEpisodicMemoryAdminStatus(undefined, range)
  })

  app.patch('/api/admin/settings/episodic-memory', async (request) => {
    const admin = requireAdmin(request)
    const settings = episodicMemorySettingsSchema.parse(request.body)
    const range = episodicMemoryStatisticsRangeSchema.parse((request.query as { range?: unknown }).range ?? '24h')
    await updateEpisodicMemorySettings(admin.id, settings)
    return readEpisodicMemoryAdminStatus(undefined, range)
  })

  app.post('/api/admin/settings/episodic-memory/rebuild', async (request) => {
    const admin = requireAdmin(request)
    try {
      await requestEpisodicMemoryRebuild(admin.id)
    } catch (error) {
      if (error instanceof Error && error.message.includes('must be enabled')) {
        throw new AppError(409, 'episodic_memory_disabled', error.message)
      }
      throw error
    }
    return { queued: true }
  })

  app.post('/api/admin/settings/episodic-memory/cancel', async (request) => {
    const admin = requireAdmin(request)
    await cancelEpisodicMemoryBuild(admin.id)
    return { cancelled: true }
  })

  app.get('/api/admin/settings/web-tools', async (request) => {
    requireAdmin(request)
    const [row] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'webTools')).limit(1)
    const value = parseWebToolsSettings(row?.value)
    return publicWebToolsSettings(value)
  })

  app.get('/api/admin/settings/dictation', async (request) => {
    requireAdmin(request)
    const [row] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'dictation')).limit(1)
    return publicDictationSettings(parseDictationSettings(row?.value))
  })

  app.patch('/api/admin/settings/dictation', async (request) => {
    const admin = requireAdmin(request)
    const input = dictationSettingsSchema.extend({
      groqApiKey: z.string().trim().min(1).optional(),
    }).parse(request.body)
    const value = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(1886747744)`)
      const [existing] = await tx.select().from(applicationSettings).where(eq(applicationSettings.key, 'dictation')).limit(1)
      const old = parseDictationSettings(existing?.value)
      const next = storedDictationSettingsSchema.parse({
        enabled: input.enabled,
        billUsers: input.billUsers,
        pricePerMinuteMicros: input.pricePerMinuteMicros,
        encryptedGroqApiKey: input.groqApiKey
          ? encryptSecret(input.groqApiKey, getConfig().ENCRYPTION_KEY)
          : old.encryptedGroqApiKey,
      })
      if (next.enabled && !next.encryptedGroqApiKey) {
        throw new AppError(400, 'dictation_api_key_required', 'Configure a Groq API key before enabling dictation')
      }
      await tx.insert(applicationSettings).values({ key: 'dictation', value: next, updatedBy: admin.id })
        .onConflictDoUpdate({ target: applicationSettings.key, set: { value: next, updatedBy: admin.id, updatedAt: new Date() } })
      await tx.insert(auditEvents).values({
        id: newId(), actorUserId: admin.id, action: 'settings.dictation.update', targetType: 'application',
        metadata: { enabled: next.enabled, billUsers: next.billUsers, pricePerMinuteMicros: next.pricePerMinuteMicros, hasApiKey: Boolean(next.encryptedGroqApiKey) },
      })
      return next
    })
    return publicDictationSettings(value)
  })

  app.post('/api/admin/settings/web-tools/:provider/api-key/reveal', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
  }, async (request, reply) => {
    const admin = requireAdmin(request)
    const { provider } = z.object({ provider: webToolProviderSchema }).parse(request.params)
    const input = secretRevealInputSchema.parse(request.body)
    const [row] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'webTools')).limit(1)
    const settings = parseWebToolsSettings(row?.value)
    const encryptedApiKey = provider === 'kagi'
      ? settings.encryptedKagiApiKey
      : settings.encryptedFirecrawlApiKey
    if (!encryptedApiKey) throw notFound('API key')

    try {
      await requireSecretRevealAuth(admin.id, input.currentPassword, input.verificationCode)
    } catch (cause) {
      await db.insert(auditEvents).values({
        id: newId(), actorUserId: admin.id, action: 'settings.web_tools.api_key.reveal_denied',
        targetType: 'web_tool_provider', targetId: provider,
      })
      throw cause
    }

    const apiKey = decryptSecret(encryptedApiKey, getConfig().ENCRYPTION_KEY)
    await db.insert(auditEvents).values({
      id: newId(), actorUserId: admin.id, action: 'settings.web_tools.api_key.reveal',
      targetType: 'web_tool_provider', targetId: provider,
    })
    reply.header('cache-control', 'no-store')
    return { apiKey }
  })

  app.patch('/api/admin/settings/web-tools', async (request) => {
    const admin = requireAdmin(request)
    const input = webToolsSettingsSchema.extend({
      apiKey: z.string().trim().min(1).optional(),
      kagiApiKey: z.string().trim().min(1).optional(),
      firecrawlApiKey: z.string().trim().min(1).optional(),
    }).parse(request.body)
    const [before] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'webTools')).limit(1)
    if (input.firecrawl.baseUrl !== parseWebToolsSettings(before?.value).firecrawl.baseUrl) await assertSafeProviderUrl(input.firecrawl.baseUrl)
    const value = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(1886747744)`)
      const [existing] = await tx.select().from(applicationSettings).where(eq(applicationSettings.key, 'webTools')).limit(1)
      const old = parseWebToolsSettings(existing?.value)
      const kagiApiKey = input.kagiApiKey ?? input.apiKey
      const next = storedWebToolsSettingsSchema.parse({
        ...input,
        encryptedKagiApiKey: kagiApiKey
          ? encryptSecret(kagiApiKey, getConfig().ENCRYPTION_KEY)
          : old.encryptedKagiApiKey,
        encryptedFirecrawlApiKey: input.firecrawlApiKey
          ? encryptSecret(input.firecrawlApiKey, getConfig().ENCRYPTION_KEY)
          : old.encryptedFirecrawlApiKey,
      })
      await tx.insert(applicationSettings).values({ key: 'webTools', value: next, updatedBy: admin.id })
        .onConflictDoUpdate({ target: applicationSettings.key, set: { value: next, updatedBy: admin.id, updatedAt: new Date() } })
      await tx.insert(auditEvents).values({
        id: newId(), actorUserId: admin.id, action: 'settings.web_tools.update', targetType: 'application',
        metadata: {
          searchEnabled: next.searchEnabled,
          extractEnabled: next.extractEnabled,
          searchProviderOrder: next.searchProviderOrder,
          extractProviderOrder: next.extractProviderOrder,
          kagi: next.kagi,
          firecrawl: next.firecrawl,
        },
      })
      return next
    })
    return publicWebToolsSettings(value)
  })

  app.get('/api/admin/settings/ocr', async (request) => {
    requireAdmin(request)
    const [row] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'ocr')).limit(1)
    const value = parseOcrSettings(row?.value)
    const legacy = value.modelId ? null : await resolveLegacyOcrCatalogModel(value.providerConnectionId, value.model)
    return {
      enabled: value.enabled,
      cacheEnabled: value.cacheEnabled,
      cacheTtlSeconds: value.cacheTtlSeconds,
      modelId: value.modelId ?? legacy?.model.id ?? null,
      systemPrompt: value.systemPrompt,
    }
  })

  app.patch('/api/admin/settings/ocr', async (request) => {
    const admin = requireAdmin(request)
    const input = z.object({
      enabled: z.boolean(), cacheEnabled: z.boolean(), cacheTtlSeconds: z.number().int().min(60).max(31_536_000),
      modelId: z.string().min(1).max(200).nullable(), systemPrompt: z.string().max(100_000),
    }).parse(request.body)
    if (input.enabled && !input.modelId) throw new AppError(400, 'ocr_model_required', 'Select an OCR model before enabling OCR')
    if (input.modelId) {
      const [model] = await db.select({ id: models.id }).from(models)
        .where(and(eq(models.id, input.modelId), eq(models.enabled, true), eq(models.visible, true))).limit(1)
      if (!model) throw new AppError(400, 'ocr_model_unavailable', 'The selected OCR model is unavailable')
    }
    const value = ocrSettingsSchema.parse({
      ...input,
    })
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(1886747744)`)
      await tx.insert(applicationSettings).values({ key: 'ocr', value, updatedBy: admin.id }).onConflictDoUpdate({ target: applicationSettings.key, set: { value, updatedBy: admin.id, updatedAt: new Date() } })
      await tx.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: 'settings.ocr.update', targetType: 'application', metadata: { enabled: value.enabled, modelId: value.modelId } })
    })
    return input
  })

  app.get('/api/admin/banners', async (request) => {
    requireAdmin(request)
    return { data: await db.select().from(banners).orderBy(desc(banners.createdAt)) }
  })

  app.post('/api/admin/banners', async (request, reply) => {
    const admin = requireAdmin(request)
    const input = z.object({
      type: z.enum(['info', 'warning', 'error']).default('info'), content: z.string().trim().min(1).max(2_000),
      dismissible: z.boolean().default(true), startsAt: z.iso.datetime().nullable().default(null), endsAt: z.iso.datetime().nullable().default(null),
    }).parse(request.body)
    const [created] = await db.insert(banners).values({ id: newId(), ...input, startsAt: input.startsAt ? new Date(input.startsAt) : null, endsAt: input.endsAt ? new Date(input.endsAt) : null }).returning()
    await db.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: 'banner.create', targetType: 'banner', targetId: created!.id })
    reply.code(201)
    return created
  })

  app.patch('/api/admin/banners/:id', async (request) => {
    const admin = requireAdmin(request)
    const { id } = request.params as { id: string }
    const input = z.object({
      type: z.enum(['info', 'warning', 'error']).optional(), content: z.string().trim().min(1).max(2_000).optional(),
      dismissible: z.boolean().optional(), startsAt: z.iso.datetime().nullable().optional(), endsAt: z.iso.datetime().nullable().optional(),
    }).parse(request.body)
    const [updated] = await db.update(banners).set({
      ...input,
      startsAt: input.startsAt === undefined ? undefined : input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt === undefined ? undefined : input.endsAt ? new Date(input.endsAt) : null,
    }).where(eq(banners.id, id)).returning()
    if (!updated) throw notFound('Banner')
    await db.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: 'banner.update', targetType: 'banner', targetId: id })
    return updated
  })

  app.delete('/api/admin/banners/:id', async (request, reply) => {
    const admin = requireAdmin(request)
    const { id } = request.params as { id: string }
    const deleted = await db.delete(banners).where(eq(banners.id, id)).returning({ id: banners.id })
    if (!deleted.length) throw notFound('Banner')
    await db.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: 'banner.delete', targetType: 'banner', targetId: id })
    reply.code(204).send()
  })

  app.get('/api/admin/settings/backups', async (request) => {
    requireAdmin(request)
    return publicBackupSettings()
  })

  app.post('/api/admin/settings/backups/test', async (request) => {
    const admin = requireAdmin(request)
    const input = backupSettingsTestInputSchema.parse(request.body)
    const current = await readStoredBackupSettings()
    const encryptedApplicationKey = input.applicationKey
      ? encryptSecret(input.applicationKey, getConfig().ENCRYPTION_KEY)
      : current.encryptedApplicationKey
    if (!encryptedApplicationKey) throw new AppError(400, 'backup_application_key_required', 'Backblaze application key is required')
    const candidate = parseBackupSettings({
      ...input,
      endpoint: validatedB2Endpoint(input.endpoint).endpoint,
      prefix: normalizeBackupPrefix(input.prefix),
      encryptedApplicationKey,
      nextRunAt: current.nextRunAt,
    })
    validatedAgeRecipient(candidate.recipient)
    try {
      await new B2BackupStore(resolveBackupSettings(candidate)).testConnection()
      await db.insert(auditEvents).values({
        id: newId(), actorUserId: admin.id, action: 'backup.connection_test', targetType: 'backup',
        metadata: { endpoint: candidate.endpoint, bucket: candidate.bucket, prefix: candidate.prefix, succeeded: true },
      })
    } catch (error) {
      await db.insert(auditEvents).values({
        id: newId(), actorUserId: admin.id, action: 'backup.connection_test', targetType: 'backup',
        metadata: { endpoint: candidate.endpoint, bucket: candidate.bucket, prefix: candidate.prefix, succeeded: false },
      })
      throw error
    }
    return { ok: true }
  })

  app.put('/api/admin/settings/backups', async (request) => {
    const admin = requireAdmin(request)
    const input = backupSettingsUpdateSchema.parse(request.body)
    const current = await readStoredBackupSettings()
    const endpoint = validatedB2Endpoint(input.endpoint).endpoint
    const prefix = normalizeBackupPrefix(input.prefix)
    validatedAgeRecipient(input.recipient)
    const encryptedApplicationKey = input.applicationKey
      ? encryptSecret(input.applicationKey, getConfig().ENCRYPTION_KEY)
      : current.encryptedApplicationKey
    if (!encryptedApplicationKey) throw new AppError(400, 'backup_application_key_required', 'Backblaze application key is required')
    const next = parseBackupSettings({
      ...input,
      endpoint,
      prefix,
      encryptedApplicationKey,
      nextRunAt: input.enabled && (!current.enabled || current.intervalHours !== input.intervalHours)
        ? new Date().toISOString()
        : input.enabled ? current.nextRunAt ?? new Date().toISOString() : null,
    })
    const connectionChanged = current.endpoint !== endpoint || current.bucket !== input.bucket
      || current.prefix !== prefix || current.keyId !== input.keyId || Boolean(input.applicationKey)
    const activeSensitiveChange = connectionChanged || current.recipient !== input.recipient
    if (activeSensitiveChange) {
      const [active] = await db.select({ id: backupJobs.id }).from(backupJobs).where(and(
        eq(backupJobs.destination, 'backblaze_b2'), inArray(backupJobs.status, ['queued', 'in_progress']),
      )).limit(1)
      if (active) throw new AppError(409, 'backup_configuration_in_use', 'Wait for the active offsite backup before changing its destination, credentials, or recipient')
    }
    if ((!current.enabled && input.enabled) || connectionChanged) {
      await new B2BackupStore(resolveBackupSettings(next)).testConnection()
    }
    await db.transaction(async (tx) => {
      await tx.insert(applicationSettings).values({ key: 'backups', value: next, updatedBy: admin.id })
        .onConflictDoUpdate({ target: applicationSettings.key, set: { value: next, updatedBy: admin.id, updatedAt: new Date() } })
      await tx.insert(auditEvents).values({
        id: newId(), actorUserId: admin.id, action: 'backup.settings_update', targetType: 'backup',
        metadata: backupSettingsAuditMetadata(next, Boolean(input.applicationKey)),
      })
      if (current.enabled !== next.enabled) {
        await tx.insert(auditEvents).values({
          id: newId(), actorUserId: admin.id,
          action: next.enabled ? 'backup.automation_enable' : 'backup.automation_disable',
          targetType: 'backup', metadata: {},
        })
      }
    })
    return publicBackupSettings()
  })

  app.delete('/api/admin/settings/backups', async (request, reply) => {
    const admin = requireAdmin(request)
    const current = await readStoredBackupSettings()
    if (current.enabled) throw new AppError(409, 'backup_settings_enabled', 'Disable automatic backups before removing their configuration')
    const [active] = await db.select({ id: backupJobs.id }).from(backupJobs).where(and(
      eq(backupJobs.destination, 'backblaze_b2'), inArray(backupJobs.status, ['queued', 'in_progress']),
    )).limit(1)
    if (active) throw new AppError(409, 'backup_already_running', 'Wait for the active offsite backup to finish')
    await db.transaction(async (tx) => {
      await tx.delete(applicationSettings).where(eq(applicationSettings.key, 'backups'))
      await tx.insert(auditEvents).values({
        id: newId(), actorUserId: admin.id, action: 'backup.settings_remove', targetType: 'backup', metadata: {},
      })
    })
    reply.code(204).send()
  })

  app.post('/api/admin/exports', async (request, reply) => {
    const admin = requireAdmin(request)
    const input = z.object({ type: z.enum(['config', 'chats', 'users', 'usage']) }).parse(request.body)
    const id = newId()
    await db.insert(exportJobs).values({ id, userId: admin.id, type: input.type })
    await maintenanceQueue.add('export', { type: 'export', payload: { exportId: id } }, { jobId: `export-${id}` })
    reply.code(202)
    return { id, status: 'queued' }
  })

  app.get('/api/admin/exports', async (request) => {
    const admin = requireAdmin(request)
    return { data: await db.select().from(exportJobs).where(eq(exportJobs.userId, admin.id)).orderBy(desc(exportJobs.createdAt)).limit(100) }
  })

  app.get('/api/admin/exports/:id/download', async (request, reply) => {
    const admin = requireAdmin(request)
    const { id } = request.params as { id: string }
    const [job] = await db.select().from(exportJobs).where(eq(exportJobs.id, id)).limit(1)
    if (!job || job.userId !== admin.id || job.status !== 'completed' || !job.objectKey) throw notFound('Export')
    const body = await getBlobStore().get(job.objectKey)
    const extension = job.type === 'config' || job.type === 'chats' ? 'json' : 'csv'
    return reply.type(extension === 'json' ? 'application/json' : 'text/csv')
      .header('content-disposition', `attachment; filename="pulpo-${job.type}.${extension}"`).send(Buffer.from(body))
  })

  app.post('/api/admin/backups', async (request, reply) => {
    const admin = requireAdmin(request); const id = newId()
    await db.insert(backupJobs).values({ id, userId: admin.id, operation: 'backup' })
    await maintenanceQueue.add('backup', { type: 'backup', payload: { jobId: id } }, { jobId: `backup-${id}` })
    reply.code(202); return { id, status: 'queued' }
  })
  app.post('/api/admin/backups/offsite', async (request, reply) => {
    const admin = requireAdmin(request)
    const job = await createOffsiteBackup('manual', admin.id)
    await db.insert(auditEvents).values({
      id: newId(), actorUserId: admin.id, action: 'backup.offsite_run', targetType: 'backup', targetId: job.id,
    })
    reply.code(202)
    return job
  })
  app.get('/api/admin/backups', async (request) => {
    const admin = requireAdmin(request)
    const destination = z.enum(['local', 'backblaze_b2']).optional().parse((request.query as { destination?: unknown }).destination)
    const condition = destination === 'backblaze_b2'
      ? eq(backupJobs.destination, 'backblaze_b2')
      : destination === 'local'
        ? and(eq(backupJobs.destination, 'local'), eq(backupJobs.userId, admin.id))
        : and(eq(backupJobs.userId, admin.id), ne(backupJobs.destination, 'backblaze_b2'))
    return { data: await db.select().from(backupJobs).where(condition).orderBy(desc(backupJobs.createdAt)).limit(100) }
  })
  app.get('/api/admin/backups/:id/download', async (request, reply) => {
    const admin = requireAdmin(request); const { id } = request.params as { id: string }
    const [job] = await db.select().from(backupJobs).where(eq(backupJobs.id, id)).limit(1)
    if (!job || job.operation !== 'backup' || job.status !== 'completed' || !job.objectKey || job.deletedAt) throw notFound('Backup')
    if (job.destination === 'backblaze_b2') {
      const stored = await readStoredBackupSettings()
      if (!stored.encryptedApplicationKey || job.storageEndpoint !== stored.endpoint || job.storageBucket !== stored.bucket) {
        throw new AppError(409, 'backup_destination_changed', `Use Backblaze to download ${job.storageBucket}/${job.objectKey}`)
      }
      const settings = resolveBackupSettings(stored)
      const object = await new B2BackupStore(settings).getStream(job.objectKey)
      if (object.contentLength !== undefined) reply.header('content-length', object.contentLength)
      return reply.type('application/octet-stream')
        .header('content-disposition', `attachment; filename="pulpo-instance-${job.createdAt.toISOString().slice(0, 10)}-${job.id}.tar.gz.age"`)
        .send(object.body)
    }
    if (job.userId !== admin.id) throw notFound('Backup')
    return reply.type('application/gzip').header('content-disposition', `attachment; filename="pulpo-instance-${new Date().toISOString().slice(0, 10)}.tar.gz"`).send(Buffer.from(await getBlobStore().get(job.objectKey)))
  })
  app.post('/api/admin/restore', async (request, reply) => {
    const admin = requireAdmin(request); const part = await request.file()
    if (!part) throw notFound('Backup file')
    const confirmationField = part.fields.confirmation
    const confirmation = String(confirmationField && !Array.isArray(confirmationField) && confirmationField.type === 'field' ? confirmationField.value : '')
    if (confirmation !== 'RESTORE') throw new AppError(400, 'restore_confirmation_required', 'Type RESTORE to confirm replacement')
    const id = newId(); const objectKey = `restore-uploads/${admin.id}/${id}.tar.gz`; const bytes = await part.toBuffer()
    if (isAgeEncryptedBackup(bytes)) {
      throw new AppError(400, 'backup_must_be_decrypted', 'Decrypt the .age backup locally before uploading its .tar.gz contents')
    }
    await getBlobStore().put(objectKey, bytes, { contentType: part.mimetype, contentLength: bytes.byteLength })
    await db.insert(backupJobs).values({ id, userId: admin.id, operation: 'restore', objectKey, originalName: part.filename, archiveSizeBytes: bytes.byteLength, archiveChecksum: createHash('sha256').update(bytes).digest('hex') })
    await maintenanceQueue.add('restore', { type: 'restore', payload: { jobId: id } }, { jobId: `restore-${id}` })
    reply.code(202); return { id, status: 'queued' }
  })
}
