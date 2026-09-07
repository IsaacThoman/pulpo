import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { applyFullBackupCompatibilityDefaults } from '../admin/backup-format.js'

const enabled = process.env.PULPO_PROFILES_MIGRATION_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL!).pathname !== '/pulpo_profiles_migration_test') throw new Error('Use the disposable pulpo_profiles_migration_test database')
const client = enabled ? postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => undefined }) : null
const folder = new URL('../../drizzle', import.meta.url).pathname
let fixture: string | undefined
let legacyRows: Record<string, Record<string, unknown>[]> = {}
let preservedUser = ''

describe.skipIf(!enabled)('profile migration with existing data', () => {
  afterAll(async () => { if (fixture) rmSync(fixture, { recursive: true, force: true }); await client?.end() })
  it('backfills populated tables and preserves IDs, settings, memories, files, and credentials', async () => {
    await client!.unsafe('drop schema if exists drizzle cascade; drop schema public cascade; create schema public;')
    const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8'))
    const previous = journal.entries.filter((entry: { idx: number }) => entry.idx < 66)
    fixture = mkdtempSync(join(tmpdir(), 'pulpo-profile-migration-'))
    mkdirSync(join(fixture, 'meta'))
    writeFileSync(join(fixture, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: previous }))
    for (const entry of previous) copyFileSync(join(folder, `${entry.tag}.sql`), join(fixture, `${entry.tag}.sql`))
    await migrate(drizzle(client!), { migrationsFolder: fixture })
    const user = randomUUID(), provider = randomUUID(), chat = randomUUID(), file = randomUUID(), revision = randomUUID()
    await client!`insert into users(id, email, name, username) values (${user}, ${`${user}@example.test`}, 'Test', ${user})`
    await client!`insert into provider_connections(id, name, encrypted_api_key) values (${provider}, 'Provider', 'shared')`
    await client!`insert into models(id, provider_connection_id, name, upstream_model_id, context_window, max_output_tokens) values ('test', ${provider}, 'Test', 'test', 4096, 1024)`
    await client!`insert into chats(id, user_id, model_id, title) values (${chat}, ${user}, 'test', 'Keep this chat')`
    await client!`insert into user_preferences(user_id, values) values (${user}, '{"customInstructions":"Keep this preference"}'::jsonb)`
    await client!`insert into user_memory_documents(user_id, content, revision) values (${user}, 'Keep this memory', 1)`
    await client!`insert into user_memory_document_revisions(id, user_id, revision, content, editor, edit_summary, version_created_at) values (${revision}, ${user}, 0, 'Keep this revision', 'user', 'Seed', now())`
    await client!`insert into attachments(id, user_id, chat_id, original_name, mime_type, size_bytes, object_key, status) values (${file}, ${user}, ${chat}, 'keep.txt', 'text/plain', 4, 'keep-object', 'ready')`
    await client!`insert into user_provider_credentials(user_id, provider_id, encrypted_credential) values (${user}, 'codex', 'keep-credential')`
    preservedUser = user
    for (const table of ['users', 'provider_connections', 'models', 'chats', 'user_preferences', 'user_memory_documents', 'user_memory_document_revisions', 'attachments', 'user_provider_credentials']) legacyRows[table] = await client!.unsafe(`select * from ${table}`)
    await migrate(drizzle(client!), { migrationsFolder: folder })
    expect((await client!`select id, name, is_default from data_profiles where user_id = ${user}`)[0]).toEqual({ id: user, name: 'Personal', is_default: true })
    for (const table of ['chats', 'user_preferences', 'user_memory_documents', 'user_memory_document_revisions', 'attachments']) {
      expect((await client!.unsafe(`select profile_id from ${table} where user_id = $1`, [user]))[0]!.profile_id).toBe(user)
    }
    expect((await client!`select title from chats where id = ${chat}`)[0]!.title).toBe('Keep this chat')
    expect((await client!`select values from user_preferences where user_id = ${user}`)[0]!.values.customInstructions).toBe('Keep this preference')
    expect((await client!`select content from user_memory_documents where user_id = ${user}`)[0]!.content).toBe('Keep this memory')
    expect((await client!`select object_key from attachments where id = ${file}`)[0]!.object_key).toBe('keep-object')
    expect((await client!`select encrypted_credential from user_provider_credentials where user_id = ${user}`)[0]!.encrypted_credential).toBe('keep-credential')
    const work = randomUUID()
    await client!`insert into data_profiles(id, user_id, name) values (${work}, ${user}, 'Work')`
    await client!`insert into user_preferences(user_id, profile_id, values) values (${user}, ${work}, '{}'::jsonb)`
    expect(await client!`select * from user_preferences where user_id = ${user}`).toHaveLength(2)
    const legacy = { user_memory_documents: [{ user_id: user, content: 'Legacy memory' }] }
    applyFullBackupCompatibilityDefaults(legacy)
    expect(legacy.user_memory_documents[0]).toMatchObject({ profile_id: user, content: 'Legacy memory' })
  })
  it('restores a populated legacy archive into Personal using the current schema', async () => {
    applyFullBackupCompatibilityDefaults(legacyRows)
    await client!.begin(async (tx) => {
      await tx`select set_config('pulpo.restoring_profiles', 'true', true)`
      await tx.unsafe('truncate users, provider_connections, models cascade')
      for (const [table, rows] of Object.entries(legacyRows)) {
        await tx.unsafe(`insert into ${table} select * from json_populate_recordset(null::${table}, $1::json)`, [JSON.stringify(rows)])
        if (table === 'users') await tx`insert into data_profiles(id, user_id, name, is_default) select id, id, 'Personal', true from users`
      }
    })
    expect((await client!`select id from data_profiles where user_id = ${preservedUser}`)[0]!.id).toBe(preservedUser)
    expect((await client!`select content from user_memory_documents where user_id = ${preservedUser}`)[0]!.content).toBe('Keep this memory')
    expect((await client!`select values from user_preferences where user_id = ${preservedUser}`)[0]!.values.customInstructions).toBe('Keep this preference')
    expect((await client!`select id, object_key from attachments where user_id = ${preservedUser}`)[0]).toMatchObject({ id: legacyRows.attachments![0]!.id, object_key: 'keep-object' })
  })

})
