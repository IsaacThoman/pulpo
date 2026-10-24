import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDriftedPreviewDatabase } from './preview-reset.js'

const enabled = process.env.PULPO_MIGRATION_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_migration_test') {
  throw new Error('Preview reset tests require the disposable pulpo_migration_test database')
}
const folder = new URL('../../drizzle', import.meta.url).pathname
const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; when: number; tag: string; version: string; breakpoints: boolean }[]
}
const preview = { COOLIFY_BRANCH: 'pull/672/head' }
const fixtures: string[] = []
const client = enabled ? postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} }) : null

/** Copies the listed migrations; `written` supplies SQL for migrations that are not in the folder. */
function fixture(entries: typeof journal.entries, written: Record<string, string> = {}): string {
  const path = mkdtempSync(join(tmpdir(), 'pulpo-migrations-'))
  fixtures.push(path); mkdirSync(join(path, 'meta'))
  writeFileSync(join(path, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }))
  for (const entry of entries) {
    const target = join(path, `${entry.tag}.sql`)
    if (entry.tag in written) writeFileSync(target, written[entry.tag]!)
    else copyFileSync(join(folder, `${entry.tag}.sql`), target)
  }
  return path
}

/**
 * A preview that applied its branch's migration before dev inserted the newest one.
 * The branch migration is synthetic: the newest real one may depend on the one
 * before it, and drift detection only compares hashes and timestamps.
 */
async function seedRenumberedPreview() {
  const upstream = journal.entries.at(-1)!
  const feature = { ...upstream, idx: upstream.idx, tag: `${upstream.tag}_preview_feature`, when: upstream.when + 1 }
  const legacy = fixture([...journal.entries.slice(0, -1), feature], {
    [feature.tag]: 'CREATE TABLE "preview_feature_fixture" ("id" integer PRIMARY KEY);',
  })
  await migrate(drizzle(client!), { migrationsFolder: legacy })
  await client!`insert into users (id, email, name, username) values (gen_random_uuid(), 'preview@example.test', 'Preview', 'preview')`
}

async function userCount() {
  const [row] = await client!`select count(*)::int as count from users`
  return row!.count as number
}

describe.skipIf(!enabled)('preview database reset on PostgreSQL', () => {
  beforeEach(async () => {
    // This connection is only opened after the exact disposable DB-name guard.
    await client!.unsafe('drop schema if exists drizzle cascade; drop schema public cascade; create schema public;')
  })
  afterEach(() => { for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true }) })
  afterAll(async () => { await client?.end() })

  it('resets a renumbered preview so every migration applies', async () => {
    await seedRenumberedPreview()
    expect(await resetDriftedPreviewDatabase(client!, folder, preview)).toBe(true)
    await migrate(drizzle(client!), { migrationsFolder: folder })
    expect(await userCount()).toBe(0)
    const history = await client!`select hash from drizzle.__drizzle_migrations`
    expect(history).toHaveLength(journal.entries.length)
    expect(await resetDriftedPreviewDatabase(client!, folder, preview)).toBe(false)
  })

  it('never resets outside a preview or when turned off', async () => {
    await seedRenumberedPreview()
    expect(await resetDriftedPreviewDatabase(client!, folder, {})).toBe(false)
    expect(await resetDriftedPreviewDatabase(client!, folder, { COOLIFY_BRANCH: 'dev' })).toBe(false)
    expect(await resetDriftedPreviewDatabase(client!, folder, { ...preview, PULPO_PREVIEW_RESET_DATABASE: 'never' })).toBe(false)
    expect(await userCount()).toBe(1)
  })

  it('keeps preview data when the history matches', async () => {
    expect(await resetDriftedPreviewDatabase(client!, folder, preview)).toBe(false)
    await migrate(drizzle(client!), { migrationsFolder: folder })
    await client!`insert into users (id, email, name, username) values (gen_random_uuid(), 'preview@example.test', 'Preview', 'preview')`
    expect(await resetDriftedPreviewDatabase(client!, folder, preview)).toBe(false)
    expect(await userCount()).toBe(1)
  })
})
