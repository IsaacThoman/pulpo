import type { Sql } from 'postgres'

/** Run under the migration lock, before any migration or recovery mutates the schema. */
export async function assertLosslessStorageCutover(client: Sql, acknowledgement = process.env.PULPO_LOSSLESS_STORAGE_CUTOVER): Promise<void> {
  const [column] = await client<{ data_type: string }[]>`
    select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'responses' and column_name = 'input'
  `
  if (column?.data_type === 'jsonb' && acknowledgement !== '1') {
    throw new Error('Lossless storage requires a maintenance cutover: stop API and workers, back up the database, then run migrations once with PULPO_LOSSLESS_STORAGE_CUTOVER=1. See docs/production-deployments.md. No migrations were applied.')
  }
}
