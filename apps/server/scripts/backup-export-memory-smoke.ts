// Export a database larger than the heap, as a production backup does.
// Run with: node --max-old-space-size=128 --import tsx scripts/backup-export-memory-smoke.ts
// against a migrated, disposable pulpo_backup_export_memory database.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { db, queryClient } from '../src/database/client.js'
import { agentRuns, chats, models, providerConnections, responses, users } from '../src/database/schema.js'
import { FULL_BACKUP_TABLES } from '../src/admin/backup-format.js'
import { exportBackupDatabase } from '../src/admin/backup-export.js'
import { restoreRows, splitRestoreDatabase } from '../src/admin/restore-archive.js'

if (new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_backup_export_memory') {
  throw new Error('Use the disposable pulpo_backup_export_memory database')
}

const directory = await mkdtemp(join(tmpdir(), 'pulpo-backup-export-memory-'))
try {
  await db.execute(sql`set client_min_messages = warning`)
  await db.execute(sql.raw(`truncate table ${[...FULL_BACKUP_TABLES].reverse().join(', ')} restart identity cascade`))
  const userId = randomUUID(), providerId = randomUUID(), chatId = randomUUID()
  await db.insert(users).values({ id: userId, role: 'admin', email: 'export-memory@example.test', username: 'export_memory', name: 'Export memory' })
  await db.insert(providerConnections).values({ id: providerId, name: 'Fixture', encryptedApiKey: 'fixture' })
  await db.insert(models).values({ id: 'fixture', providerConnectionId: providerId, upstreamModelId: 'fixture', name: 'Fixture', contextWindow: 1000, maxOutputTokens: 100 })
  await db.insert(chats).values({ id: chatId, userId, modelId: 'fixture' })
  // Agent context dominates production databases. These rows decode to far
  // more than the heap, so the export fails unless it streams them.
  const count = 2_400, contextBytes = 256 * 1024
  await db.execute(sql`
    with inserted as (
      insert into ${responses} (id, chat_id, user_id, model_id, input)
      select gen_random_uuid(), ${chatId}, ${userId}, 'fixture', '[]' from generate_series(1, ${count})
      returning id
    )
    insert into ${agentRuns} (id, response_id, context)
    select gen_random_uuid(), id, json_build_object('history', repeat(md5(id::text), ${contextBytes / 32}))::text from inserted`)

  const databasePath = join(directory, 'database.json')
  await db.transaction(async (tx) => {
    await exportBackupDatabase(tx, databasePath, async () => undefined)
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
  const databaseBytes = (await stat(databasePath)).size
  assert.ok(databaseBytes > count * contextBytes, 'Every agent run must be exported')

  const tables = await splitRestoreDatabase(databasePath, directory)
  let exported = 0
  for await (const row of restoreRows(tables.get('agent_runs'))) {
    assert.equal((row.context as { history: string }).history.length, contextBytes)
    exported++
  }
  assert.equal(exported, count)
  const peakRssMiB = Math.ceil(process.resourceUsage().maxRSS / 1024)
  assert.ok(peakRssMiB < 384, `Peak RSS ${peakRssMiB} MiB exceeds the 384 MiB smoke-test budget`)
  console.log(JSON.stringify({ databaseBytes, agentRuns: exported, peakRssMiB }))
} finally {
  await rm(directory, { recursive: true, force: true })
  await queryClient.end()
}
