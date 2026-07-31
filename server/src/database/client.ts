import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { getConfig } from '../config.js'
import * as schema from './schema.js'

const config = getConfig()
const queryOptions = {
  max: config.NODE_ENV === 'test' ? 2 : 10,
  prepare: false,
}
const queryClient = config.DATABASE_URL
  ? postgres(config.DATABASE_URL, queryOptions)
  : postgres({
      ...queryOptions,
      host: config.POSTGRES_HOST,
      port: config.POSTGRES_PORT,
      username: config.POSTGRES_USER,
      password: config.POSTGRES_PASSWORD,
      database: config.POSTGRES_DATABASE,
    })

export const db = drizzle(queryClient, { schema })
export { queryClient }
