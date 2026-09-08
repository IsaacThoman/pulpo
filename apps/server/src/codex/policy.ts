import { eq, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { applicationSettings } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { parseCodexSettings } from '../settings/application-settings.js'

export type CodexPolicyTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Shared with the generic admin settings transaction, including absent settings rows.
export async function lockCodexPolicy(tx: CodexPolicyTransaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(1886747744)`)
}

export async function codexEnabled(database: Pick<typeof db, 'select'> = db): Promise<boolean> {
  const [row] = await database.select({ value: applicationSettings.value }).from(applicationSettings)
    .where(eq(applicationSettings.key, 'codex')).limit(1)
  return parseCodexSettings(row?.value).enabled
}

export function codexDisabledError(): AppError {
  return new AppError(403, 'codex_disabled', 'Codex is disabled for this instance', 'permission_error', 'model')
}

export async function requireCodexEnabled(database: Pick<typeof db, 'select'> = db): Promise<void> {
  if (!await codexEnabled(database)) throw codexDisabledError()
}
