import { sql } from 'drizzle-orm'
import type { db } from '../database/client.js'
import { decodePayloadRow } from '../database/lossless-json.js'
import {
  FULL_BACKUP_BINARY_COLUMNS,
  FULL_BACKUP_EXPLICIT_COLUMNS,
  FULL_BACKUP_TABLES,
  scrubFullBackupDetailedPayloads,
  type FullBackupTable,
} from './backup-format.js'
import { writeBackupDatabase } from './backup-database.js'
import {
  backupAttachmentBlob,
  findTemporaryBackupData,
  projectBackupRow,
  TEMPORARY_BACKUP_KEY_COLUMNS,
  type BackupAttachmentBlob,
  type FullBackupRow,
  type TemporaryBackupKeys,
} from './backup-projection.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Scrubbing detailed payloads relates rows across these tables, so they are
 * read whole. Payload retention and the 90-day diagnostic window keep them small.
 */
const SCRUBBED_TABLES = [
  'application_settings', 'diagnostic_policy', 'request_logs', 'provider_diagnostics', 'ocr_attempts',
] as const satisfies readonly FullBackupTable[]

/** Rows fetched per round trip. A single agent run can carry megabytes of context. */
export const BACKUP_FETCH_ROWS = 100

function backupRow(table: FullBackupTable, row: Record<string, unknown>): FullBackupRow {
  const decoded = decodePayloadRow(table, row)
  for (const column of FULL_BACKUP_BINARY_COLUMNS[table] ?? []) {
    if (decoded[column] != null) decoded[column] = `\\x${Buffer.from(decoded[column] as Uint8Array).toString('hex')}`
  }
  return decoded
}

const selectColumns = (table: FullBackupTable) => FULL_BACKUP_EXPLICIT_COLUMNS[table]?.join(', ') ?? '*'

/**
 * Write every backup table to `path` from the transaction's snapshot, holding
 * only one batch of rows in memory at a time. Returns the attachment blobs the
 * written rows reference.
 */
export async function exportBackupDatabase(
  tx: Transaction,
  path: string,
  onTableWritten: (index: number) => Promise<void>,
): Promise<BackupAttachmentBlob[]> {
  const keys = {} as TemporaryBackupKeys
  for (const [table, columns] of Object.entries(TEMPORARY_BACKUP_KEY_COLUMNS) as Array<[keyof TemporaryBackupKeys, readonly string[]]>) {
    keys[table] = [...await tx.execute(sql.raw(`select ${columns.join(', ')} from ${table}`))]
  }
  const temporary = findTemporaryBackupData(keys)

  const scrubbed: Record<string, FullBackupRow[]> = {}
  for (const table of SCRUBBED_TABLES) {
    scrubbed[table] = [...await tx.execute(sql.raw(`select ${selectColumns(table)} from ${table}`))]
      .flatMap<FullBackupRow>(row => projectBackupRow(table, backupRow(table, row), temporary) ?? [])
  }
  scrubFullBackupDetailedPayloads(scrubbed)

  const attachmentBlobs: BackupAttachmentBlob[] = []
  async function* rows(table: FullBackupTable, index: number): AsyncGenerator<FullBackupRow> {
    if (table in scrubbed) {
      yield* scrubbed[table]!
    } else {
      // Cursor names are scoped to this transaction, which closes them when it ends.
      await tx.execute(sql.raw(`declare backup_${table} no scroll cursor for select ${selectColumns(table)} from ${table}`))
      for (;;) {
        const batch = [...await tx.execute(sql.raw(`fetch forward ${BACKUP_FETCH_ROWS} from backup_${table}`))]
        for (const row of batch) {
          const projected = projectBackupRow(table, backupRow(table, row), temporary)
          if (!projected) continue
          if (table === 'attachments') {
            const blob = backupAttachmentBlob(projected)
            if (blob) attachmentBlobs.push(blob)
          }
          yield projected
        }
        if (batch.length < BACKUP_FETCH_ROWS) break
      }
      await tx.execute(sql.raw(`close backup_${table}`))
    }
    await onTableWritten(index)
  }
  await writeBackupDatabase(path, Object.fromEntries(FULL_BACKUP_TABLES.map((table, index) => [table, rows(table, index)])))
  return attachmentBlobs
}
