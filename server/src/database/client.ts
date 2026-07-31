import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { getConfig } from '../config.js'
import * as schema from './schema.js'

const queryClient = postgres(getConfig().DATABASE_URL, {
  max: getConfig().NODE_ENV === 'test' ? 2 : 10,
  prepare: false,
})

export const db = drizzle(queryClient, { schema })
export { queryClient }
