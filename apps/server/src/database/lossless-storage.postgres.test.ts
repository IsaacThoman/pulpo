import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { pgTable, text } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { assertLosslessStorageCutover } from './lossless-cutover.js'
import { losslessJson, losslessText, LOSSLESS_PAYLOAD_COLUMNS } from './lossless-json.js'
import { unusualPayload, unusualText } from './fixtures/windows-tool-output.js'
import { responses, ocrCacheEntries } from './schema.js'

const enabled = process.env.PULPO_LOSSLESS_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_lossless_test') {
  throw new Error('Lossless migration tests require the disposable pulpo_lossless_test database')
}
const client = enabled ? postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} }) : null
const database = client ? drizzle(client) : null
const folder = new URL('../../drizzle', import.meta.url).pathname
const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] }
const fixtures: string[] = []
function legacyFolder(): string {
  const path = mkdtempSync(join(tmpdir(), 'pulpo-lossless-migration-')); fixtures.push(path); mkdirSync(join(path, 'meta'))
  const entries = journal.entries.filter(entry => entry.idx < 75)
  writeFileSync(join(path, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }))
  for (const entry of entries) copyFileSync(join(folder, `${entry.tag}.sql`), join(path, `${entry.tag}.sql`))
  return path
}
const probe = pgTable('lossless_probe', {
  id: text('id').primaryKey(), payload: losslessJson('payload'), content: losslessText('content'),
  defaults: losslessJson('defaults').notNull().default(sql`'{}'`),
})

describe.skipIf(!enabled)('lossless storage on PostgreSQL', () => {
  beforeEach(async () => {
    await client!.unsafe('drop schema if exists drizzle cascade; drop schema public cascade; create schema public;')
  })
  afterAll(async () => {
    await client?.end()
    for (const path of fixtures) rmSync(path, { recursive: true, force: true })
  })

  it('supports a fresh install and every registered storage column', async () => {
    await expect(assertLosslessStorageCutover(client!, undefined)).resolves.toBeUndefined()
    await migrate(database!, { migrationsFolder: folder })
    await expect(assertLosslessStorageCutover(client!, undefined)).resolves.toBeUndefined()
    const columns = await client!`select table_name, column_name, data_type from information_schema.columns where table_schema = 'public'`
    for (const [table, names] of Object.entries(LOSSLESS_PAYLOAD_COLUMNS)) for (const name of names) {
      expect(columns.find(column => column.table_name === table && column.column_name === name)?.data_type).toBe('text')
    }
    await client!`create table lossless_probe (id text primary key, payload text, content text, defaults text not null default '{}')`
    await database!.insert(probe).values({ id: 'edge', payload: unusualPayload, content: unusualText })
    await database!.insert(probe).values({ id: 'sql-null', payload: null, content: '' })
    await database!.insert(probe).values({ id: 'json-null', payload: sql`'null'`, content: null })
    const rows = await database!.select().from(probe).orderBy(probe.id)
    expect(rows).toEqual([
      { id: 'edge', payload: unusualPayload, content: unusualText, defaults: {} },
      { id: 'json-null', payload: null, content: null, defaults: {} },
      { id: 'sql-null', payload: null, content: '', defaults: {} },
    ])
    const raw = await client!`select id, payload is null as sql_null from lossless_probe order by id`
    expect(raw.map(row => row.sql_null)).toEqual([false, false, true])
    await expect(client!`select ${JSON.stringify(unusualPayload)}::jsonb`).rejects.toMatchObject({ code: '22P05' })
  })

  it('refuses an existing schema until acknowledged and preserves existing values and defaults', async () => {
    await migrate(database!, { migrationsFolder: legacyFolder() })
    const user = randomUUID(), provider = randomUUID(), chat = randomUUID(), response = randomUUID()
    await client!`insert into users (id, email, name, username) values (${user}, 'lossless@example.test', 'Lossless QA', 'lossless')`
    await client!`insert into provider_connections (id, name, encrypted_api_key) values (${provider}, 'Fixture', 'fixture')`
    await client!`insert into models (id, provider_connection_id, upstream_model_id, name, context_window, max_output_tokens) values ('fixture', ${provider}, 'fixture', 'Fixture', 128000, 16384)`
    await client!`insert into chats (id, user_id, model_id, title) values (${chat}, ${user}, 'fixture', 'Fixture')`
    const legacy = { role: 'user', content: 'Windows \\u0000 🐙' }
    await client!`insert into responses (id, chat_id, user_id, model_id, input, instructions) values (${response}, ${chat}, ${user}, 'fixture', ${JSON.stringify([legacy])}, '"literal quoted string"')`
    await client!`insert into ocr_cache_entries (checksum, provider_fingerprint, text, expires_at) values ('fixture', 'fixture', 'null', now() + interval '1 day')`
    const before = await client!`select * from drizzle.__drizzle_migrations order by id`
    await expect(assertLosslessStorageCutover(client!, '')).rejects.toThrow('maintenance cutover')
    expect(await client!`select * from drizzle.__drizzle_migrations order by id`).toEqual(before)
    await assertLosslessStorageCutover(client!, '1')
    await migrate(database!, { migrationsFolder: folder })
    const [saved] = await database!.select().from(responses)
    expect(saved).toMatchObject({ input: [legacy], output: [], metadata: {}, parameters: {}, error: null, instructions: '"literal quoted string"' })
    expect((await database!.select().from(ocrCacheEntries))[0]?.text).toBe('null')
    await database!.update(responses).set({ input: unusualPayload, instructions: unusualText })
    expect((await database!.select().from(responses))[0]).toMatchObject({ input: unusualPayload, instructions: unusualText })
    await expect(assertLosslessStorageCutover(client!, '')).resolves.toBeUndefined()
    await migrate(database!, { migrationsFolder: folder })
  })

  it('rolls back a failed conversion without changing values or the journal', async () => {
    await migrate(database!, { migrationsFolder: legacyFolder() })
    const before = await client!`select * from drizzle.__drizzle_migrations order by id`
    const migration = readFileSync(join(folder, '0075_lossless_conversation_storage.sql'), 'utf8')
    await expect(client!.begin(async tx => {
      for (const statement of migration.split('--> statement-breakpoint')) await tx.unsafe(statement)
      await tx`select missing_cutover_test_column`
    })).rejects.toThrow('missing_cutover_test_column')
    expect((await client!`select data_type from information_schema.columns where table_name = 'responses' and column_name = 'input'`)[0]?.data_type).toBe('jsonb')
    expect(await client!`select * from drizzle.__drizzle_migrations order by id`).toEqual(before)
    await expect(assertLosslessStorageCutover(client!, '')).rejects.toThrow('maintenance cutover')
  })
})
