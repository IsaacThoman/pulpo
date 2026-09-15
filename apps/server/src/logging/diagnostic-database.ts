import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { getConfig } from '../config.js'

// Diagnostics cannot exhaust the application's connection pool. Server-side limits
// release blocked queries; a JS timeout alone would leave them running in the pool.
const config = getConfig()
const options = { max: 1, prepare: false, connect_timeout: 2, idle_timeout: 5,
  connection: { statement_timeout: 1000, lock_timeout: 100 } }
export const diagnosticClient = config.DATABASE_URL ? postgres(config.DATABASE_URL, options) : postgres({ ...options,
  host: config.POSTGRES_HOST, port: config.POSTGRES_PORT, username: config.POSTGRES_USER,
  password: config.POSTGRES_PASSWORD, database: config.POSTGRES_DATABASE })
export const diagnosticDb = drizzle(diagnosticClient)
