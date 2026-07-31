import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { db, queryClient } from './client.js'

await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname })
await queryClient.end()
