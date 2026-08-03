import { defineConfig } from 'drizzle-kit'

const databaseUrl = process.env.DATABASE_URL ?? `postgres://${encodeURIComponent(process.env.POSTGRES_USER ?? 'pulpo')}:${encodeURIComponent(process.env.POSTGRES_PASSWORD ?? 'pulpo')}@${process.env.POSTGRES_HOST ?? 'localhost'}:${process.env.POSTGRES_PORT ?? '5432'}/${encodeURIComponent(process.env.POSTGRES_DATABASE ?? 'pulpo')}`

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: databaseUrl,
  },
})
