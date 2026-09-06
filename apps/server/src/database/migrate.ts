import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { db, queryClient } from './client.js'
import { recoverRenumberedShelfMigration } from './migration-recovery.js'

// Hold a session-level lock on a reserved connection while Drizzle uses its
// own transaction. Concurrent deployment/restart attempts must not race while
// reading the migration journal. PostgreSQL releases the lock on disconnect.
const lock = await queryClient.reserve()
try {
  await lock`set lock_timeout = '5min'`
  await lock`select pg_advisory_lock(hashtext('pulpo:database-migrations'))`
  try {
    const migrationsFolder = new URL('../../drizzle', import.meta.url).pathname
    if (await recoverRenumberedShelfMigration(queryClient, migrationsFolder)) console.info('Recovered renumbered shelf migration and intervening migrations')
    await migrate(db, { migrationsFolder })
  } finally {
    await lock`select pg_advisory_unlock(hashtext('pulpo:database-migrations'))`
  }
} finally {
  lock.release()
  await queryClient.end()
}
