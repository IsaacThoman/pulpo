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
  return recoverRenumberedMigration(client, migrationsFolder, legacyShelfTimestamps, '_shelved_drafts', 'shelf')
}

export async function recoverRenumberedRestoreMigration(client: Sql, migrationsFolder: string): Promise<boolean> {
  // PR previews applied restore uploads as 0064 before dev added its session
  // columns. Preserve that table while applying the skipped session migration.
  return recoverRenumberedMigration(client, migrationsFolder, new Set([1788746542023]), '_restore_uploads', 'restore')
}

export async function recoverRenumberedWorkspaceMigration(client: Sql, migrationsFolder: string): Promise<boolean> {
  // The workspace PR preview applied this unchanged DDL before speech joined dev.
  return recoverRenumberedMigration(client, migrationsFolder, new Set([1788891345619]), '_computer_workspaces', 'workspace')
}

export async function recoverRenumberedSpeechMigrations(client: Sql, migrationsFolder: string): Promise<boolean> {
  // Speech previews predate dev's time-zone migration on persistent PR databases.
  // Recover each unchanged DDL checksum in order, preserving catalog and clips.
  let recovered = false
  for (const [timestamp, suffix] of [
    [1788846946049, '_speech_models'],
    [1788876504966, '_speech_previews'],
    [1788887924483, '_speech_voice_previews'],
  ] as const) {
    if (await recoverRenumberedMigration(client, migrationsFolder, new Set([timestamp]), suffix, 'speech')) recovered = true
  }
  return recovered
}

async function recoverRenumberedMigration(
  client: Sql, migrationsFolder: string, legacyTimestamps: Set<number>, suffix: string, label: string,
): Promise<boolean> {
  const [existing] = await client<{ ledger: string | null }[]>`select to_regclass('drizzle.__drizzle_migrations')::text as ledger`
  if (!existing?.ledger) return false
  const history = await client<{ hash: string; created_at: string }[]>`select hash, created_at from drizzle.__drizzle_migrations`
  const legacy = history.find((row) => legacyTimestamps.has(Number(row.created_at)))
  if (!legacy) return false

  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] }
  const migrations = readMigrationFiles({ migrationsFolder })
  const target = migrations[journal.entries.findIndex((entry) => entry.tag.endsWith(suffix))]
  if (!target || legacy.hash !== target.hash) throw new Error(`Cannot recover the renumbered ${label} migration: its checksum differs from the applied migration`)
  if (history.some((row) => Number(row.created_at) === target.folderMillis && row.hash === target.hash)) return false

  const previous = migrations.filter((migration) => migration.folderMillis < Number(legacy.created_at)
    && history.some((row) => Number(row.created_at) === migration.folderMillis && row.hash === migration.hash)).at(-1)
  if (!previous) throw new Error(`Cannot recover the renumbered ${label} migration: no common migration baseline`)

  await client.begin(async (tx) => {
    for (const migration of migrations.filter((item) => item.folderMillis > previous.folderMillis && item.folderMillis <= target.folderMillis)) {
      if (history.some((row) => Number(row.created_at) === migration.folderMillis && row.hash === migration.hash)) continue
      if (!history.some((row) => row.hash === migration.hash)) {
        for (const statement of migration.sql) await tx.unsafe(statement)
      }
      await tx`insert into drizzle.__drizzle_migrations (hash, created_at) values (${migration.hash}, ${migration.folderMillis})`
    }
  })
  return true
}
