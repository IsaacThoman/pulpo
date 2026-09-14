import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractRestoreArchive } from './restore-archive.js'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { eq, sql } from 'drizzle-orm'
import { afterAll, expect, it, vi } from 'vitest'
const blobs = vi.hoisted(() => new Map<string, Buffer>())
vi.mock('../storage/index.js', () => ({ getBlobStore: () => ({
  put: async (key: string, bytes: Uint8Array) => { blobs.set(key, Buffer.from(bytes)) },
  get: async (key: string) => { const bytes = blobs.get(key); if (!bytes) throw new Error('Missing blob'); return bytes },
  delete: async (key: string) => { blobs.delete(key) },
  getStream: async (key: string) => Readable.from(blobs.get(key)!),
  putStream: async (key: string, stream: AsyncIterable<Uint8Array>) => { const chunks: Uint8Array[] = []; for await (const chunk of stream) chunks.push(chunk); blobs.set(key, Buffer.concat(chunks)) },
}) }))
vi.mock('../redis.js', () => ({ redis: {} }))
vi.mock('../redis-keys.js', () => ({ deleteRedisKeysByPattern: vi.fn() }))
import { db, queryClient } from '../database/client.js'
import { agentRuns, applicationSettings, backupJobs, chats, generationAttempts, models, ocrAttempts, ocrCacheEntries, providerConnections, requestLogs, responseContentParts, responseItems, responses, toolExecutions, users, workspaceLeases } from '../database/schema.js'
import { unusualPayload, unusualText } from '../database/fixtures/windows-tool-output.js'
import { createFullBackup, restoreFullBackup } from './backup.js'
import { FULL_BACKUP_TABLES } from './backup-format.js'
import { persistResponseItems } from '../responses/storage.js'
import { purgeExpiredDetailedPayloads } from '../logging/detailed-payload-retention.js'

const enabled = process.env.PULPO_LOSSLESS_BACKUP_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_lossless_backup_test') throw new Error('Use the disposable pulpo_lossless_backup_test database')
afterAll(async () => { await queryClient.end() })

it.skipIf(!enabled)('preserves conversation, tools, context and OCR through full backup/restore and expires payloads', async () => {
  await db.execute(sql.raw(`truncate table ${[...FULL_BACKUP_TABLES].reverse().join(', ')} restart identity cascade`))
  const userId = randomUUID(), providerId = randomUUID(), chatId = randomUUID(), responseId = randomUUID(), logId = randomUUID(), leaseId = randomUUID(), runId = randomUUID()
  await db.insert(users).values({ id: userId, role: 'admin', email: 'lossless-backup@example.test', username: 'lossless_backup', name: 'Lossless backup QA' })
  await db.insert(providerConnections).values({ id: providerId, name: 'Fixture', encryptedApiKey: 'fixture' })
  await db.insert(models).values({ id: 'fixture', providerConnectionId: providerId, upstreamModelId: 'fixture', name: 'Fixture', contextWindow: 128000, maxOutputTokens: 16384 })
  await db.insert(chats).values({ id: chatId, userId, modelId: 'fixture', title: 'Lossless fixture' })
  const output = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: unusualText }] }]
  await db.insert(responses).values({ id: responseId, chatId, userId, modelId: 'fixture', input: unusualPayload, output, instructions: unusualText, parameters: unusualPayload, metadata: { ['key\0']: unusualText }, error: unusualPayload })
  await persistResponseItems(responseId, output)
  await db.insert(applicationSettings).values({ key: 'logging', value: { logDetailedPayloads: true, payloadRetention: '7d' } })
  await db.insert(requestLogs).values({ id: logId, responseId, userId, requestedModelId: 'fixture', requestPayload: unusualPayload, responsePayload: output, errorMessage: unusualText, captureDetailedPayloads: true, payloadExpiresAt: new Date(Date.now() + 86_400_000) })
  await db.insert(generationAttempts).values({ id: randomUUID(), requestLogId: logId, modelId: 'fixture', errorMessage: unusualText })
  await db.insert(ocrAttempts).values({ id: randomUUID(), requestLogId: logId, requestPayload: unusualPayload, responsePayload: unusualPayload, errorMessage: unusualText })
  await db.insert(ocrCacheEntries).values({ checksum: 'fixture', providerFingerprint: 'fixture', text: unusualText, expiresAt: new Date(Date.now() + 86_400_000) })
  await db.insert(workspaceLeases).values({ id: leaseId, chatId, userId, imageDigest: 'fixture' })
  await db.insert(agentRuns).values({ id: runId, responseId, workspaceLeaseId: leaseId, context: unusualPayload, error: unusualText })
  await db.insert(toolExecutions).values({ id: randomUUID(), agentRunId: runId, workspaceLeaseId: leaseId, operationId: 'fixture', toolName: 'bash', arguments: unusualPayload, output: unusualText, error: unusualText, providerAttempts: [unusualPayload] })
  // Full backups intentionally exclude temporary chats and their payloads.
  const temporaryChat = randomUUID()
  await db.insert(chats).values({ id: temporaryChat, userId, modelId: 'fixture', title: 'Temporary', temporary: true, expiresAt: new Date(Date.now() + 86_400_000) })
  await db.insert(responses).values({ id: randomUUID(), chatId: temporaryChat, userId, modelId: 'fixture', input: unusualPayload })
  const backupId = randomUUID()
  await db.insert(backupJobs).values({ id: backupId, userId, operation: 'backup' })
  await createFullBackup(backupId)
  const [backup] = await db.select().from(backupJobs).where(eq(backupJobs.id, backupId))
  expect(backup?.status, backup?.error ?? '').toBe('completed')
  const directory = await mkdtemp(join(tmpdir(), 'pulpo-lossless-backup-'))
  try {
    const archive = await extractRestoreArchive(Readable.from(blobs.get(backup!.objectKey!)!), directory, { size: null, checksum: null })
    const logical = JSON.parse(await readFile(archive.databasePath, 'utf8'))
    expect(logical.responses[0].input).toEqual(unusualPayload)
    expect(logical.responses[0].instructions).toBe(unusualText)
    expect(logical.tool_executions[0].output).toBe(unusualText)
    expect(logical.agent_runs[0].context).toEqual(unusualPayload)
    expect(logical.ocr_cache_entries[0].text).toBe(unusualText)
  } finally { await rm(directory, { recursive: true, force: true }) }
  const restoreId = randomUUID()
  await db.insert(backupJobs).values({ id: restoreId, userId, operation: 'restore', objectKey: backup!.objectKey! })
  await restoreFullBackup(restoreId)
  const [restore] = await db.select().from(backupJobs).where(eq(backupJobs.id, restoreId))
  expect(restore?.status, restore?.error ?? '').toBe('completed')
  expect(await db.select().from(chats)).toHaveLength(1)
  expect((await db.select().from(responses))[0]).toMatchObject({ input: unusualPayload, output, instructions: unusualText, parameters: unusualPayload, metadata: { ['key\0']: unusualText }, error: unusualPayload })
  expect((await db.select().from(responseItems))[0]?.payload).toEqual(output[0])
  expect((await db.select().from(responseContentParts))[0]?.payload).toEqual(output[0]!.content[0])
  expect((await db.select().from(agentRuns))[0]).toMatchObject({ context: unusualPayload, error: unusualText })
  expect((await db.select().from(toolExecutions))[0]).toMatchObject({ arguments: unusualPayload, output: unusualText, error: unusualText, providerAttempts: [unusualPayload] })
  expect((await db.select().from(ocrCacheEntries))[0]?.text).toBe(unusualText)
  expect((await db.select().from(requestLogs))[0]).toMatchObject({ requestPayload: unusualPayload, responsePayload: output, errorMessage: unusualText })
  expect((await db.select().from(ocrAttempts))[0]).toMatchObject({ requestPayload: unusualPayload, responsePayload: unusualPayload, errorMessage: unusualText })
  expect((await db.select().from(generationAttempts))[0]?.errorMessage).toBe(unusualText)
  await db.update(requestLogs).set({ payloadExpiresAt: new Date(0) })
  await purgeExpiredDetailedPayloads(query => db.execute(query))
  expect((await db.select().from(requestLogs))[0]).toMatchObject({ requestPayload: null, responsePayload: null })
  expect((await db.select().from(ocrAttempts))[0]).toMatchObject({ requestPayload: null, responsePayload: null })
}, 30_000)
