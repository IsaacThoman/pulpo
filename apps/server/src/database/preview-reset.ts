import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import type { Sql } from 'postgres'
import { getCoolifyPreviewId } from '../config.js'

export type PreviewResetMode = 'on_drift' | 'never'

type AppliedMigration = { hash: string; createdAt: number }
type LocalMigration = { tag: string; hash: string; folderMillis: number }

/** Preview databases are disposable; persistent environments never reset. */
export function previewResetMode(environment: NodeJS.ProcessEnv): PreviewResetMode | null {
  if (!getCoolifyPreviewId(environment)) return null
  const value = environment.PULPO_PREVIEW_RESET_DATABASE?.trim() || 'on_drift'
  if (value !== 'on_drift' && value !== 'never') {
    throw new Error('PULPO_PREVIEW_RESET_DATABASE must be on_drift or never')
  }
  return value
}

/**
 * Drizzle applies only migrations newer than the newest recorded one. When a PR
 * renumbers or edits a migration its preview already applied (usually while
 * merging dev), Drizzle either skips the older migration or replays DDL that
 * already ran. Returns why the recorded history no longer fits the migrations.
 */
export function migrationDrift(applied: AppliedMigration[], migrations: LocalMigration[]): string | null {
  if (!applied.length) return null
  const newestApplied = Math.max(...applied.map((row) => row.createdAt))
  const appliedHashes = new Set(applied.map((row) => row.hash))
  const skipped = migrations.find((migration) => migration.folderMillis <= newestApplied && !appliedHashes.has(migration.hash))
  if (skipped) return `${skipped.tag} is older than the newest applied migration but was never applied`
  const replayed = migrations.find((migration) => migration.folderMillis > newestApplied && appliedHashes.has(migration.hash))
  if (replayed) return `${replayed.tag} was already applied under an earlier migration number`
  return null
}

function localMigrations(migrationsFolder: string): LocalMigration[] {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] }
  return readMigrationFiles({ migrationsFolder }).map((migration, index) => ({
    tag: journal.entries[index]!.tag,
    hash: migration.hash,
    folderMillis: migration.folderMillis,
  }))
}

/**
 * Run under the migration advisory lock. On a Coolify preview whose migration
 * history has drifted, drop the database schemas so migrations and the preview
 * bootstrap start clean. Returns whether the database was reset.
 */
export async function resetDriftedPreviewDatabase(
  client: Sql,
  migrationsFolder: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (previewResetMode(environment) !== 'on_drift') return false
  const [ledger] = await client<{ ledger: string | null }[]>`select to_regclass('drizzle.__drizzle_migrations')::text as ledger`
  if (!ledger?.ledger) return false
  const history = await client<{ hash: string; created_at: string }[]>`select hash, created_at from drizzle.__drizzle_migrations`
  const drift = migrationDrift(
    history.map((row) => ({ hash: row.hash, createdAt: Number(row.created_at) })),
    localMigrations(migrationsFolder),
  )
  if (!drift) return false
  console.warn(JSON.stringify({
    level: 'warn',
    service: 'pulpo-migrate',
    event: 'preview.database_reset',
    previewId: getCoolifyPreviewId(environment),
    reason: drift,
  }))
  await client.begin(async (tx) => {
    await tx`drop schema if exists drizzle cascade`
    await tx`drop schema if exists public cascade`
    await tx`create schema public`
  })
  return true
}
