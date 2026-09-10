import { randomUUID, createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { VOXTRAL_SPEECH_PRESET, OPENAI_SPEECH_PRESET, speechModelSchema } from '@pulpo/contracts'
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
import { backupJobs, providerConnections, speechModels, speechResourceCleanup, users } from '../database/schema.js'
import { createFullBackup, restoreFullBackup } from '../admin/backup.js'
import { FULL_BACKUP_TABLES } from '../admin/backup-format.js'
import { writeBackupArchive } from '../admin/backup-archive.js'
import { publicSpeechModel } from './routes.js'
import { speechTestWav } from './audio-fixtures.js'
const enabled = process.env.PULPO_SPEECH_BACKUP_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_speech_backup_test') throw new Error('Use the disposable pulpo_speech_backup_test database')
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
describe.skipIf(!enabled)('speech backup round trips in PostgreSQL', () => {
  afterAll(async () => { await queryClient.end() })
  it('restores private assets, stable bindings, checksums, and legacy archives', async () => {
    // Restore truncates the disposable database. Never run against application data.
    await db.execute(sql.raw(`truncate table ${[...FULL_BACKUP_TABLES].reverse().join(', ')} restart identity cascade`))
    const userId = randomUUID(), providerId = randomUUID(), modelId = 'backup-voice'
    await db.insert(users).values({ id: userId, role: 'admin', email: `${userId}@example.test`, username: userId, name: 'Backup QA' })
    await db.insert(providerConnections).values({ id: providerId, name: 'Backup QA', baseUrl: 'https://api.mistral.ai/v1', encryptedApiKey: 'fixture' })
    const audio = speechTestWav(3)
    const asset = (key: string) => { blobs.set(key, audio); return { objectKey: key, contentType: 'audio/wav' as const, durationSeconds: 3, checksum: hash(audio) } }
    const config = speechModelSchema.parse({ ...VOXTRAL_SPEECH_PRESET, id: modelId, providerConnectionId: providerId, voices: [{ id: 'stable', label: 'Named clone', kind: 'cloned', watermark: { enabled: true, volume: 0.15 } }], defaultVoice: 'stable' })
    await db.insert(speechModels).values({ id: modelId, providerConnectionId: providerId, config, voiceAssets: [{ voiceId: 'stable', clone: { ...asset('reference.wav'), upstreamVoiceId: 'remote-id' }, watermark: asset('watermark.wav') }], voicePreviews: [{ voiceId: 'stable', ...asset('preview.wav') }] })
    await db.insert(speechResourceCleanup).values({ id: randomUUID(), providerConnectionId: providerId, upstreamVoiceId: 'retired-remote', objectKeys: ['unarchived-retired.wav'], error: 'Retry provider cleanup' })
    const backupId = randomUUID()
    await db.insert(backupJobs).values({ id: backupId, userId, operation: 'backup' })
    await createFullBackup(backupId)
    const [backup] = await db.select().from(backupJobs).where(eq(backupJobs.id, backupId))
    expect(backup?.status, backup?.error ?? '').toBe('completed')
    const restore = async (objectKey: string) => {
      const id = randomUUID(); await db.insert(backupJobs).values({ id, userId, operation: 'restore', objectKey })
      await restoreFullBackup(id)
      const [job] = await db.select().from(backupJobs).where(eq(backupJobs.id, id)); expect(job?.status, job?.error ?? '').toBe('completed')
      return (await db.select().from(speechModels).where(eq(speechModels.id, modelId)))[0]!
    }
    const restored = await restore(backup!.objectKey!)
    expect(restored.config).toEqual(config)
    expect(restored.voiceAssets[0]?.clone?.upstreamVoiceId).toBe('remote-id')
    for (const clip of [restored.voiceAssets[0]!.clone!, restored.voiceAssets[0]!.watermark!, restored.voicePreviews[0]!]) {
      expect(clip.objectKey).not.toMatch(/^(reference|watermark|preview)\.wav$/)
      expect(hash(blobs.get(clip.objectKey)!)).toBe(clip.checksum)
    }
    const [cleanup] = await db.select().from(speechResourceCleanup)
    expect(cleanup).toMatchObject({ upstreamVoiceId: 'retired-remote', objectKeys: [], error: 'Retry provider cleanup' })
    // A pre-assets archive has neither voice_assets nor the cleanup table or adapter.
    const directory = await mkdtemp(join(tmpdir(), 'speech-backup-test-'))
    try {
      const database: Record<string, unknown[]> = Object.fromEntries(FULL_BACKUP_TABLES.filter(table => table !== 'speech_resource_cleanup').map(table => [table, []]))
      // Use actual SQL rows so all unrelated required columns remain valid.
      database.users = [...await db.execute(sql`select * from users`)]
      database.provider_connections = [...await db.execute(sql`select * from provider_connections`)]
      const legacyConfig = { ...OPENAI_SPEECH_PRESET, id: modelId, providerConnectionId: providerId } as Record<string, unknown>; delete legacyConfig.adapter
      database.speech_models = [{ id: modelId, provider_connection_id: providerId, config: legacyConfig, created_at: new Date(), updated_at: new Date() }]
      const archivePath = join(directory, 'legacy.tar.gz')
      await writeBackupArchive(archivePath, Readable.from([
        { name: 'database.json', body: Buffer.from(JSON.stringify(database)) },
        { name: 'manifest.json', body: Buffer.from(JSON.stringify({ format: 'pulpo-instance-backup', version: 1, createdAt: new Date().toISOString(), tables: Object.keys(database), blobs: [] })) },
      ]))
      blobs.set('legacy.tar.gz', await readFile(archivePath))
      const legacy = await restore('legacy.tar.gz')
      expect(legacy.voiceAssets).toEqual([]); expect(legacy.voicePreviews).toEqual([])
      expect(publicSpeechModel(legacy.config).adapter).toBe('openai')
      expect(legacy.config.voices).toEqual(OPENAI_SPEECH_PRESET.voices)
    } finally { await rm(directory, { recursive: true, force: true }) }
  }, 30_000)
})
