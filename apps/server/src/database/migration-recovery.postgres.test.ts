import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { recoverRenumberedShelfMigration, recoverRenumberedSpeechMigrations, recoverRenumberedWorkspaceMigration } from './migration-recovery.js'

const enabled = process.env.PULPO_MIGRATION_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_migration_test') {
  throw new Error('Migration recovery tests require the disposable pulpo_migration_test database')
}
const folder = new URL('../../drizzle', import.meta.url).pathname
const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; when: number; tag: string; version: string; breakpoints: boolean }[]
}
const shelf = journal.entries.find((entry) => entry.tag.endsWith('_shelved_drafts'))!
const fixtures: string[] = []
const client = enabled ? postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} }) : null

function fixture(entries = journal.entries): string {
  const path = mkdtempSync(join(tmpdir(), 'pulpo-migrations-'))
  fixtures.push(path); mkdirSync(join(path, 'meta'))
  writeFileSync(join(path, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }))
  for (const entry of entries) copyFileSync(join(folder, `${entry.tag}.sql`), join(path, `${entry.tag}.sql`))
  return path
}
async function seedLegacy(lastUpstreamIndex: number, timestamp: number) {
  const path = fixture([...journal.entries.filter((entry) => entry.idx <= lastUpstreamIndex), { ...shelf, when: timestamp }])
  await migrate(drizzle(client!), { migrationsFolder: path })
  const userId = randomUUID(), draftId = randomUUID(), attachmentId = randomUUID()
  await client!`insert into users (id, email, name, username) values (${userId}, ${`${userId}@example.test`}, 'Migration test', ${userId})`
  await client!`insert into attachments (id, user_id, original_name, mime_type, size_bytes, object_key, status, shelved_at)
    values (${attachmentId}, ${userId}, 'keep.txt', 'text/plain', 4, ${attachmentId}, 'ready', now())`
  await client!`insert into shelved_drafts (id, user_id, content) values (${draftId}, ${userId}, '  preserve this draft\n')`
  await client!`insert into shelved_draft_attachments (draft_id, attachment_id) values (${draftId}, ${attachmentId})`
  return draftId
}
async function searchColumnExists() {
  const [row] = await client!`select exists (select 1 from information_schema.columns where table_name = 'chat_turn_embeddings' and column_name = 'chunk_index') as present`
  return row!.present
}

describe.skipIf(!enabled)('renumbered shelf migration recovery on PostgreSQL', () => {
  beforeEach(async () => {
    // This connection is only opened after the exact disposable DB-name guard.
    await client!.unsafe('drop schema if exists drizzle cascade; drop schema public cascade; create schema public;')
  })
  afterEach(() => { for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true }) })
  afterAll(async () => { await client?.end() })

  it.each([[60, 1788717545159], [61, 1788720704270]])('recovers legacy shelf after upstream index %s without losing data', async (upstream, timestamp) => {
    const draftId = await seedLegacy(upstream, timestamp)
    await expect(migrate(drizzle(client!), { migrationsFolder: folder })).rejects.toThrow('shelved_at')
    expect(await searchColumnExists()).toBe(false)
    expect(await recoverRenumberedShelfMigration(client!, folder)).toBe(true)
    await migrate(drizzle(client!), { migrationsFolder: folder })
    expect(await searchColumnExists()).toBe(true)
    const [index] = await client!`select indexdef from pg_indexes where indexname = 'chat_turn_embeddings_generation_response_unique'`
    expect(index!.indexdef).toContain('chunk_index')
    const [saved] = await client!`select content from shelved_drafts where id = ${draftId}`
    expect(saved!.content).toBe('  preserve this draft\n')
    expect(await client!`select * from shelved_draft_attachments where draft_id = ${draftId}`).toHaveLength(1)
    const before = await client!`select * from drizzle.__drizzle_migrations order by id`
    expect(await recoverRenumberedShelfMigration(client!, folder)).toBe(false)
    await migrate(drizzle(client!), { migrationsFolder: folder })
    expect(await client!`select * from drizzle.__drizzle_migrations order by id`).toEqual(before)
  })

  it('preserves registered computers when workspaces move after the speech migrations', async () => {
    const workspace = journal.entries.find(entry => entry.tag.endsWith('_computer_workspaces'))!
    const legacy = fixture([...journal.entries.filter(entry => entry.idx <= 66), { ...workspace, idx: 67, when: 1788891345619 }])
    await migrate(drizzle(client!), { migrationsFolder: legacy })
    const userId = randomUUID(), deviceId = randomUUID()
    await client!`insert into users (id, email, name, username) values (${userId}, ${`${userId}@example.test`}, 'Migration test', ${userId})`
    await client!`insert into workspace_computers (id, user_id, token_hash, registration) values (${deviceId}, ${userId}, 'test-hash', '{"name":"Keep this computer"}')`
    expect(await recoverRenumberedWorkspaceMigration(client!, folder)).toBe(true)
    await migrate(drizzle(client!), { migrationsFolder: folder })
    const [computer] = await client!`select registration from workspace_computers where id = ${deviceId}`
    expect(computer!.registration.name).toBe('Keep this computer')
    const [speech] = await client!`select to_regclass('speech_models') as present`
    expect(speech!.present).toBe('speech_models')
    const before = await client!`select * from drizzle.__drizzle_migrations order by id`
    expect(await recoverRenumberedWorkspaceMigration(client!, folder)).toBe(false)
    await migrate(drizzle(client!), { migrationsFolder: folder })
    expect(await client!`select * from drizzle.__drizzle_migrations order by id`).toEqual(before)
  })

  it('leaves fresh databases on the normal migration path', async () => {
    expect(await recoverRenumberedShelfMigration(client!, folder)).toBe(false)
    await migrate(drizzle(client!), { migrationsFolder: folder })
    expect(await recoverRenumberedShelfMigration(client!, folder)).toBe(false)
    expect(await searchColumnExists()).toBe(true)
  })

  it.each([1, 2, 3])('recovers %s legacy speech migrations while retaining clips and applying time zones', async count => {
    const timestamps = [1788846946049, 1788876504966, 1788887924483]
    const speech = journal.entries.filter(entry => /_speech_(models|previews|voice_previews)$/.test(entry.tag))
    const legacy = fixture([...journal.entries.filter(entry => entry.idx <= 65), ...speech.slice(0, count).map((entry, index) => ({ ...entry, when: timestamps[index]! }))])
    await migrate(drizzle(client!), { migrationsFolder: legacy })
    const providerId = randomUUID()
    await client!`insert into provider_connections (id, name, encrypted_api_key) values (${providerId}, 'Speech fixture', 'fixture')`
    await client!`insert into speech_models (id, provider_connection_id, config) values ('preserve', ${providerId}, '{"defaultVoice":"coral"}')`
    if (count === 2) await client!`update speech_models set preview_object_key = 'keep.wav', preview_content_type = 'audio/wav', preview_checksum = 'checksum'`
    if (count === 3) await client!`update speech_models set voice_previews = '[{"voiceId":"coral","objectKey":"keep.wav","contentType":"audio/wav","checksum":"checksum"}]'`
    expect(await recoverRenumberedSpeechMigrations(client!, folder)).toBe(true)
    await migrate(drizzle(client!), { migrationsFolder: folder })
    const [model] = await client!`select * from speech_models where id = 'preserve'`
    expect(model!.config).toEqual({ defaultVoice: 'coral' })
    expect(model!.voice_previews).toEqual(count === 1 ? [] : [{ voiceId: 'coral', objectKey: 'keep.wav', contentType: 'audio/wav', checksum: 'checksum' }])
    expect(await client!`select column_name from information_schema.columns where table_name in ('queued_messages', 'responses') and column_name = 'time_zone'`).toHaveLength(2)
    const before = await client!`select * from drizzle.__drizzle_migrations order by id`
    expect(await recoverRenumberedSpeechMigrations(client!, folder)).toBe(false)
    await migrate(drizzle(client!), { migrationsFolder: folder })
    expect(await client!`select * from drizzle.__drizzle_migrations order by id`).toEqual(before)
  })

  it('rolls back both skipped schema changes and journal entries if recovery fails', async () => {
    await seedLegacy(61, 1788720704270)
    const broken = fixture()
    const search = journal.entries.find((entry) => entry.tag.endsWith('_chat_search_recall'))!
    writeFileSync(join(broken, `${search.tag}.sql`), `${readFileSync(join(broken, `${search.tag}.sql`), 'utf8')}\n--> statement-breakpoint\nselect missing_recovery_test_column;`)
    const before = await client!`select * from drizzle.__drizzle_migrations order by id`
    await expect(recoverRenumberedShelfMigration(client!, broken)).rejects.toThrow('missing_recovery_test_column')
    expect(await searchColumnExists()).toBe(false)
    expect(await client!`select * from drizzle.__drizzle_migrations order by id`).toEqual(before)
  })

  it('refuses to treat changed shelf SQL as already applied', async () => {
    await seedLegacy(61, 1788720704270)
    const changed = fixture()
    writeFileSync(join(changed, `${shelf.tag}.sql`), `${readFileSync(join(changed, `${shelf.tag}.sql`), 'utf8')}\n-- changed DDL checksum\n`)
    const before = await client!`select * from drizzle.__drizzle_migrations order by id`
    await expect(recoverRenumberedShelfMigration(client!, changed)).rejects.toThrow('checksum differs')
    expect(await searchColumnExists()).toBe(false)
    expect(await client!`select * from drizzle.__drizzle_migrations order by id`).toEqual(before)
  })
})
