import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import type { Sql } from 'postgres'

// These shelf revisions were deployed to persistent PR databases before the
// migration was renumbered while merging dev. Drizzle compares timestamps,
// so it both replays the shelf DDL and skips intervening upstream migrations.
const legacyShelfTimestamps = new Set([1788717545159, 1788720704270])

/** Run under the normal database migration advisory lock. Never discard data
 * or rewrite applied SQL/history: recognize identical DDL by its checksum. */
export async function recoverRenumberedShelfMigration(client: Sql, migrationsFolder: string): Promise<boolean> {
  const [existing] = await client<{ ledger: string | null }[]>`select to_regclass('drizzle.__drizzle_migrations')::text as ledger`
  if (!existing?.ledger) return false
  const history = await client<{ hash: string; created_at: string }[]>`select hash, created_at from drizzle.__drizzle_migrations`
  const legacy = history.find((row) => legacyShelfTimestamps.has(Number(row.created_at)))
  if (!legacy) return false

  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] }
  const migrations = readMigrationFiles({ migrationsFolder })
  const shelf = migrations[journal.entries.findIndex((entry) => entry.tag.endsWith('_shelved_drafts'))]
  if (!shelf || legacy.hash !== shelf.hash) throw new Error('Cannot recover the renumbered shelf migration: its checksum differs from the applied migration')
  if (history.some((row) => Number(row.created_at) === shelf.folderMillis && row.hash === shelf.hash)) return false

  const previous = migrations.filter((migration) => migration.folderMillis < Number(legacy.created_at)
    && history.some((row) => Number(row.created_at) === migration.folderMillis && row.hash === migration.hash)).at(-1)
  if (!previous) throw new Error('Cannot recover the renumbered shelf migration: no common migration baseline')

  await client.begin(async (tx) => {
    for (const migration of migrations.filter((item) => item.folderMillis > previous.folderMillis && item.folderMillis <= shelf.folderMillis)) {
      if (history.some((row) => Number(row.created_at) === migration.folderMillis && row.hash === migration.hash)) continue
      if (!history.some((row) => row.hash === migration.hash)) {
        for (const statement of migration.sql) await tx.unsafe(statement)
      }
      await tx`insert into drizzle.__drizzle_migrations (hash, created_at) values (${migration.hash}, ${migration.folderMillis})`
    }
  })
  return true
}
