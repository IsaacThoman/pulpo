import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import * as Y from 'yjs'
import { applyMarkdownToYDoc, DOC_SCHEMA_VERSION, ydocToMarkdown } from '@pulpo/client-core/doc-schema'
import { emptyComposerState } from '@pulpo/contracts'
import { Decrypter, generateIdentity, identityToRecipient } from 'age-encryption'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, queryClient } from '../database/client.js'
import * as schema from '../database/schema.js'
import { initialDocState, mergedDocState } from '../files/doc-state.js'
import { LocalBlobStore } from '../storage/local.js'
import { encryptSecret } from '../lib/crypto.js'
import { getConfig } from '../config.js'
import { FULL_BACKUP_TABLES, OPTIONAL_TABLES_IN_LEGACY_BACKUPS } from './backup-format.js'
import { createFullBackup, restoreFullBackup } from './backup.js'
import { writeBackupArchive, type BackupArchiveEntry } from './backup-archive.js'
import { extractRestoreArchive } from './restore-archive.js'
import { completeRestoreUpload, putRestoreChunk, startRestoreUpload } from './restore-uploads.js'
import { createOffsiteBackup, deleteUnlockedOffsiteBackups, reconcileOffsiteBackupJobs, runOffsiteBackupSchedule } from './backup-scheduler.js'

const context = vi.hoisted(() => ({
  store: undefined as LocalBlobStore | undefined,
  enqueue: vi.fn(async () => undefined),
  remote: new Map<string, { bytes: Buffer; jobId: string; recipientFingerprint: string; lockedUntil: Date }>(),
}))
vi.mock('../storage/index.js', () => ({ getBlobStore: () => context.store! }))
vi.mock('../jobs.js', () => ({ maintenanceQueue: { add: context.enqueue, getJob: vi.fn(async () => undefined) } }))
vi.mock('./b2-backup-store.js', () => ({ B2BackupStore: class {
  async head(key: string) {
    const entry = context.remote.get(key)
    return entry ? { sizeBytes: entry.bytes.length, jobId: entry.jobId, recipientFingerprint: entry.recipientFingerprint } : null
  }
  async putEncrypted(key: string, body: AsyncIterable<Uint8Array>, size: number, jobId: string, recipientFingerprint: string, lockedUntil: Date) {
    const chunks = []; for await (const chunk of body) chunks.push(chunk)
    const bytes = Buffer.concat(chunks)
    if (size !== bytes.length) throw new Error('Ciphertext size mismatch')
    context.remote.set(key, { bytes, jobId, recipientFingerprint, lockedUntil })
  }
  async delete(key: string) { context.remote.delete(key) }
} }))
vi.mock('../redis.js', () => ({ redis: {} }))
vi.mock('../redis-keys.js', () => ({ deleteRedisKeysByPattern: vi.fn() }))
vi.mock('../chats/trash.js', () => ({ markExpiredChatsForPurge: vi.fn(), purgePendingChats: vi.fn() }))

const enabled = process.env.PULPO_BACKUP_AUDIT_TESTS === 'true'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_backup_audit') throw new Error('Use the disposable pulpo_backup_audit database')
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
let directory: string, userId: string

async function backup() {
  const id = randomUUID()
  await db.insert(schema.backupJobs).values({ id, userId, operation: 'backup' })
  await createFullBackup(id)
  const [job] = await db.select().from(schema.backupJobs).where(eq(schema.backupJobs.id, id))
  expect(job!.status).toBe('completed')
  return context.store!.get(job!.objectKey!)
}

async function rewriteArchive(bytes: Uint8Array, change: (database: Record<string, Record<string, unknown>[]>) => void) {
  const unpack = await mkdtemp(join(directory, 'unpack-'))
  const extracted = await extractRestoreArchive(await (async () => {
    const key = `fixture-${randomUUID()}`
    await context.store!.put(key, bytes, { contentType: 'application/gzip' })
    return context.store!.getStream(key)
  })(), unpack, { size: bytes.byteLength, checksum: hash(bytes) })
  const database = JSON.parse(await readFile(extracted.databasePath, 'utf8'))
  change(database)
  const path = join(directory, `rewritten-${randomUUID()}.tar.gz`)
  await writeBackupArchive(path, (async function* (): AsyncGenerator<BackupArchiveEntry> {
    yield { name: 'database.json', body: Buffer.from(JSON.stringify(database)) }
    for (const blob of extracted.manifest.blobs) {
      const file = extracted.files.get(blob.entry)!
      yield { name: blob.entry, body: createReadStream(file.path), sizeBytes: file.size }
    }
    yield { name: 'manifest.json', body: Buffer.from(JSON.stringify(extracted.manifest)) }
  })())
  return readFile(path)
}

async function restore(bytes: Uint8Array) {
  const id = randomUUID()
  await startRestoreUpload(userId, { id, originalName: 'backup.tar.gz', sizeBytes: bytes.byteLength, fingerprint: hash(bytes) })
  await putRestoreChunk(id, userId, 0, hash(bytes), bytes)
  await completeRestoreUpload(id, userId)
  await restoreFullBackup(id)
  expect((await db.select().from(schema.backupJobs).where(eq(schema.backupJobs.id, id)))[0]!.status).toBe('completed')
  return id
}

describe.skipIf(!enabled)('full application backup audit with PostgreSQL and local blobs', () => {
  beforeEach(async () => {
    await db.execute(sql`set client_min_messages = warning`)
    await db.execute(sql.raw(`truncate ${FULL_BACKUP_TABLES.join(', ')}, restore_uploads restart identity cascade`))
    directory = await mkdtemp(join(tmpdir(), 'pulpo-backup-audit-'))
    context.store = new LocalBlobStore(directory)
    context.enqueue.mockReset(); context.enqueue.mockResolvedValue(undefined); context.remote.clear()
    userId = randomUUID()
    await db.insert(schema.users).values({ id: userId, name: 'Backup auditor', email: 'audit@example.test', username: 'audit', role: 'admin' })
  })
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })
  afterAll(async () => { await queryClient.end() })

  it('preserves Files, binary Yjs snapshots and updates, credentials, billing, pools, analytics and drafts through repeated restores', async () => {
    const providerId = randomUUID(), chatId = randomUUID(), responseId = randomUUID(), poolId = randomUUID()
    await db.insert(schema.providerConnections).values({ id: providerId, name: 'Fixture', encryptedApiKey: 'encrypted-fixture' })
    await db.insert(schema.models).values({ id: 'audit-model', providerConnectionId: providerId, upstreamModelId: 'fixture', name: 'Fixture', contextWindow: 1000, maxOutputTokens: 100 })
    await db.insert(schema.chats).values({ id: chatId, userId, modelId: 'audit-model' })
    await db.insert(schema.responses).values({ id: responseId, userId, chatId, modelId: 'audit-model', input: [], status: 'completed' })
    await db.insert(schema.userPasskeyCredentials).values({ id: randomUUID(), userId, name: 'Passkey', credentialId: 'credential', credentialPublicKey: 'public-key', counter: 42, deviceType: 'multiDevice' })
    await db.insert(schema.userProviderCredentials).values({ userId, providerId: 'codex', encryptedCredential: 'encrypted-credential' })
    await db.insert(schema.pools).values({ id: poolId, ownerUserId: userId })
    await db.insert(schema.poolMembers).values({ id: randomUUID(), poolId, userId })
    const inviteeId = randomUUID()
    await db.insert(schema.users).values({ id: inviteeId, name: 'Invitee', email: 'invitee@example.test', username: 'invitee' })
    await db.insert(schema.poolInvitations).values({ id: randomUUID(), poolId, inviterUserId: userId, inviteeUserId: inviteeId, inviterDisclosureAcceptedAt: new Date() })
    await db.insert(schema.inviteCodes).values({ id: randomUUID(), code: 'fixture', ownerUserId: userId })
    await db.insert(schema.billingAccounts).values({ userId, stripeCustomerId: 'cus_fixture', planOverride: 'eight', weeklyLimitOverrideMicros: 123456 })
    await db.insert(schema.billingSubscriptions).values({ userId, stripeSubscriptionId: 'sub_fixture', stripePriceId: 'price_fixture', plan: 'eight', status: 'active', providerModifiedAt: new Date() })
    await db.insert(schema.billingCheckouts).values({ id: randomUUID(), userId, idempotencyKey: 'checkout', kind: 'credits', status: 'complete' })
    await db.insert(schema.billingAutoTopUps).values({ id: randomUUID(), userId, status: 'succeeded', creditCents: 1000, chargeCents: 1050, stripePaymentMethodId: 'pm_fixture' })
    await db.insert(schema.billingOrders).values({ stripePaymentId: 'pi_fixture', userId, stripePriceId: 'price_fixture', billingReason: 'credits', status: 'paid', currency: 'usd', grantedCreditMicros: 10000000 })
    await db.insert(schema.billingWebhookEvents).values({ providerEventId: 'evt_fixture', type: 'invoice.paid', status: 'processed' })
    const periodStart = new Date('2026-10-01T00:00:00Z')
    await db.insert(schema.weeklyUsagePeriods).values({ userId, periodStart, spentMicros: 42 })
    await db.insert(schema.fiveHourUsagePeriods).values({ userId, periodStart, spentMicros: 43 })
    await db.insert(schema.sharedAllowancePeriods).values({ ownerUserId: userId, periodStart, spentMicros: 44 })
    await db.insert(schema.sharedFiveHourUsagePeriods).values({ userId, periodStart, spentMicros: 45 })
    const analyticsId = randomUUID()
    await db.insert(schema.requestAnalytics).values({ id: analyticsId, responseId, userId, poolId, requestedModelId: 'audit-model', origin: 'web', status: 'completed' })
    await db.insert(schema.requestAnalyticsTools).values({ analyticsId, toolName: 'bash', calls: 2, createdAt: new Date() })
    await db.insert(schema.analyticsHourlyRollups).values({ hour: periodStart, modelId: 'audit-model', clientPlatform: 'web', origin: 'web', plan: 'eight', agentMode: false, requests: 1, failures: 0, inputTokens: 12, outputTokens: 34, costMicros: 56 })
    const attachmentId = randomUUID(), attachmentKey = `users/${userId}/attachments/fixture`
    await context.store!.put(attachmentKey, Buffer.from('draft attachment'), { contentType: 'text/plain' })
    await db.insert(schema.attachments).values({ id: attachmentId, userId, originalName: 'draft.txt', mimeType: 'text/plain', sizeBytes: 16, objectKey: attachmentKey, status: 'ready', checksum: hash(Buffer.from('draft attachment')) })
    const draftId = randomUUID(), shelfId = randomUUID()
    await db.insert(schema.composerDrafts).values({ id: draftId, userId, chatId, draftId: chatId, modelId: 'audit-model', editorId: 'fixture', revision: 3, state: { ...emptyComposerState(), content: 'Draft 🐙', attachments: [{ id: attachmentId, name: 'draft.txt', mimeType: 'text/plain', size: 16 }] } })
    await db.insert(schema.composerDraftAttachments).values({ draftId, attachmentId, position: 0 })
    await db.insert(schema.shelvedDrafts).values({ id: shelfId, userId, content: 'Saved for later' })
    await db.insert(schema.shelvedDraftAttachments).values({ draftId: shelfId, attachmentId })
    await db.insert(schema.shelfOperations).values({ userId, operationId: randomUUID() })
    await db.insert(schema.queuedMessages).values({ id: randomUUID(), chatId, userId, content: 'Queued message', modelId: 'audit-model', attachmentIds: [attachmentId], position: 0, dispatchResponseId: randomUUID() })
    await db.insert(schema.idempotencyRecords).values({ userId, key: 'fixture', operation: 'fixture', responseStatus: 200, responseBody: { ok: true }, expiresAt: new Date(Date.now() + 86400000) })
    let parentId: string | null = null
    for (let index = 0; index < 105; index++) {
      const id = randomUUID()
      await db.insert(schema.fileNodes).values({ id, ownerUserId: userId, parentId, kind: 'folder', name: `Folder ${index}` })
      parentId = id
    }
    const nodeId = randomUUID(), fileId = randomUUID(), fileKey = `users/${userId}/files/fixture`
    const body = Buffer.from('File bytes 🐙\u0000')
    await context.store!.put(fileKey, body, { contentType: 'application/octet-stream' })
    await db.insert(schema.fileNodes).values([
      { id: nodeId, ownerUserId: userId, parentId, kind: 'doc', name: 'Notes.md' },
      { id: fileId, ownerUserId: userId, parentId, kind: 'blob', name: 'file.bin', objectKey: fileKey, checksum: hash(body), sizeBytes: body.byteLength },
    ])
    const initial = initialDocState('# Original 🐙')
    const doc = new Y.Doc(); Y.applyUpdate(doc, initial.state)
    const vector = Y.encodeStateVector(doc)
    applyMarkdownToYDoc(doc, '# Updated 中文\n\nPending edits survive.', 'client')
    const update = Y.encodeStateAsUpdate(doc, vector), expectedMarkdown = ydocToMarkdown(doc)
    await db.insert(schema.fileDocs).values({ nodeId, state: initial.state, stateBytes: initial.state.byteLength, pendingUpdates: 1, markdown: initial.markdown, schemaVersion: DOC_SCHEMA_VERSION })
    await db.insert(schema.fileDocUpdates).values({ nodeId, update, byteSize: update.byteLength, origin: 'client', actorUserId: userId })
    await db.insert(schema.fileFolderLayouts).values({ id: randomUUID(), ownerUserId: userId, folderId: parentId, positions: { [nodeId]: { x: 12, y: 34 } } })
    await db.insert(schema.fileAgentChanges).values({ id: randomUUID(), responseId, userId, nodeId, kind: 'edit', beforeMarkdown: '# Before' })
    await db.insert(schema.sessions).values({ id: randomUUID(), userId, tokenHash: 'old-session', expiresAt: new Date(Date.now() + 86400000) })

    const durableTables = FULL_BACKUP_TABLES.filter(table => OPTIONAL_TABLES_IN_LEGACY_BACKUPS.includes(table) && table !== 'file_nodes' && table !== 'diagnostic_policy')
    const expected = new Map<string, unknown[]>()
    for (const table of durableTables) expected.set(table, [...await db.execute(sql.raw(`select * from ${table}`))])
    let archive: Uint8Array = await rewriteArchive(await backup(), database => { database.file_nodes!.reverse() })
    for (let round = 0; round < 2; round++) {
      await restore(archive)
      for (const table of durableTables) expect([...await db.execute(sql.raw(`select * from ${table}`))], table).toEqual(expected.get(table))
      expect(await db.select().from(schema.sessions)).toEqual([])
      const nodes = await db.select().from(schema.fileNodes)
      expect(nodes).toHaveLength(107)
      const file = nodes.find(node => node.id === fileId)!
      expect(await context.store!.get(file.objectKey!)).toEqual(body)
      expect(await context.store!.createDownloadUrl(file.objectKey!)).toMatch(/^\/api\/files\/local-download\//)
      const restoredDoc = new Y.Doc()
      Y.applyUpdate(restoredDoc, await db.transaction(tx => mergedDocState(tx, nodeId)))
      expect(ydocToMarkdown(restoredDoc)).toBe(expectedMarkdown)
      archive = await backup()
    }
    const [next] = await db.insert(schema.fileDocUpdates).values({ nodeId, update, byteSize: update.byteLength, origin: 'client' }).returning()
    expect(next!.seq).toBeGreaterThan(1)
  }, 30000)

  it('restores old v1 archives with new tables and required columns absent', async () => {
    const archive = await rewriteArchive(await backup(), database => {
      for (const table of OPTIONAL_TABLES_IN_LEGACY_BACKUPS) delete database[table]
      delete database.users![0]!.invite_code_quota
      delete database.users![0]!.state_revision
    })
    await restore(archive)
    expect((await db.select().from(schema.users))[0]).toMatchObject({ inviteCodeQuota: 0, stateRevision: 0 })
  })

  it.each(['missing', 'corrupt'])('fails a backup with a %s source blob without publishing a broken archive', async (failure) => {
    const key = `users/${userId}/files/fixture`, body = Buffer.from('original data')
    await db.insert(schema.fileNodes).values({ id: randomUUID(), ownerUserId: userId, kind: 'blob', name: 'fixture.bin', objectKey: key, sizeBytes: body.length, checksum: hash(body) })
    if (failure === 'corrupt') await context.store!.put(key, Buffer.from('changed data'), { contentType: 'application/octet-stream' })
    const id = randomUUID()
    await db.insert(schema.backupJobs).values({ id, userId, operation: 'backup' })
    await expect(createFullBackup(id)).rejects.toThrow()
    const [job] = await db.select().from(schema.backupJobs).where(eq(schema.backupJobs.id, id))
    expect(job).toMatchObject({ status: 'failed', objectKey: null })
    await expect(context.store!.get(`backups/${userId}/${id}.tar.gz`)).rejects.toThrow()
    expect(await db.select().from(schema.users)).toHaveLength(1)
  })

  it('settles interrupted generations and safely recovers dispatching queued messages', async () => {
    const providerId = randomUUID(), chatId = randomUUID(), responseId = randomUUID(), runId = randomUUID()
    await db.insert(schema.providerConnections).values({ id: providerId, name: 'Fixture', encryptedApiKey: 'fixture' })
    await db.insert(schema.models).values({ id: 'audit-model', providerConnectionId: providerId, upstreamModelId: 'fixture', name: 'Fixture', contextWindow: 1000, maxOutputTokens: 100 })
    await db.insert(schema.chats).values({ id: chatId, userId, modelId: 'audit-model', activeResponseId: responseId })
    await db.insert(schema.responses).values({ id: responseId, userId, chatId, modelId: 'audit-model', input: 'Keep my prompt', output: ['partial output'], status: 'in_progress' })
    await db.insert(schema.agentRuns).values({ id: runId, responseId, status: 'running' })
    await db.insert(schema.toolExecutions).values({ id: randomUUID(), agentRunId: runId, operationId: 'tool', toolName: 'bash', status: 'running', output: 'partial tool output' })
    const abandonedId = randomUUID()
    await db.insert(schema.queuedMessages).values([
      { id: randomUUID(), chatId, userId, content: 'Already sent', modelId: 'audit-model', position: 0, dispatchResponseId: responseId, status: 'dispatching' },
      { id: abandonedId, chatId, userId, content: 'Not sent yet', modelId: 'audit-model', position: 1, dispatchResponseId: randomUUID(), status: 'dispatching' },
    ])
    await restore(await backup())
    expect((await db.select().from(schema.responses))[0]).toMatchObject({ status: 'cancelled', input: 'Keep my prompt', output: ['partial output'], error: { code: 'instance_restored' } })
    expect((await db.select().from(schema.agentRuns))[0]!.status).toBe('cancelled')
    expect((await db.select().from(schema.toolExecutions))[0]).toMatchObject({ status: 'cancelled', output: 'partial tool output' })
    expect(await db.select().from(schema.queuedMessages)).toMatchObject([{ id: abandonedId, status: 'pending', content: 'Not sent yet' }])
  })

  it('schedules once across concurrent workers, reconciles enqueue failure, encrypts offsite bytes and retains them until expiry', async () => {
    const identity = await generateIdentity(), recipient = await identityToRecipient(identity)
    const now = new Date(), due = new Date(now.getTime() - 7 * 3600000)
    await db.insert(schema.applicationSettings).values({ key: 'backups', value: {
      enabled: true, endpoint: 'https://s3.us-west-004.backblazeb2.com', bucket: 'fixture', prefix: 'audit', keyId: 'fixture',
      encryptedApplicationKey: encryptSecret('fixture', getConfig().ENCRYPTION_KEY), recipient, intervalHours: 6, retentionDays: 30, nextRunAt: due.toISOString(),
    } })
    context.enqueue.mockRejectedValueOnce(new Error('queue offline'))
    await expect(createOffsiteBackup('manual', userId)).rejects.toThrow('queue offline')
    const [manual] = await db.select().from(schema.backupJobs)
    expect(manual!.status).toBe('queued')
    await reconcileOffsiteBackupJobs()
    expect(context.enqueue).toHaveBeenCalledTimes(2)
    await expect(createOffsiteBackup('manual', userId)).rejects.toMatchObject({ code: 'backup_already_running' })
    await createFullBackup(manual!.id)
    const [completed] = await db.select().from(schema.backupJobs).where(eq(schema.backupJobs.id, manual!.id))
    const ciphertext = context.remote.get(manual!.objectKey!)!.bytes
    expect(completed).toMatchObject({ status: 'completed', archiveSizeBytes: ciphertext.length, archiveChecksum: hash(ciphertext) })
    expect(ciphertext.toString('utf8', 0, 22)).toBe('age-encryption.org/v1\n')
    const decrypter = new Decrypter(); decrypter.addIdentity(identity)
    const plaintext = await decrypter.decrypt(ciphertext)
    await createFullBackup(manual!.id)
    expect(context.remote.size).toBe(1)
    await Promise.all([runOffsiteBackupSchedule(now), runOffsiteBackupSchedule(now)])
    const jobs = await db.select().from(schema.backupJobs)
    expect(jobs.filter(job => job.trigger === 'scheduled')).toHaveLength(1)
    const [settings] = await db.select().from(schema.applicationSettings)
    expect(Date.parse((settings!.value as { nextRunAt: string }).nextRunAt)).toBeGreaterThan(now.getTime())
    await deleteUnlockedOffsiteBackups(now)
    expect(context.remote.size).toBe(1)
    await deleteUnlockedOffsiteBackups(new Date(now.getTime() + 31 * 86400000))
    expect(context.remote.size).toBe(0)
    expect((await db.select().from(schema.backupJobs).where(eq(schema.backupJobs.id, manual!.id)))[0]!.deletedAt).not.toBeNull()
    await restore(plaintext)
    expect((await db.select().from(schema.users))[0]!.id).toBe(userId)
  })
})
