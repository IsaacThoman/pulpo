import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  backupJobs,
  budgetReservations,
  creditLedger,
  dailyUsageRollups,
  exportJobs,
  twoFactorRecoveryCodes,
  usageEvents,
  userTotpCredentials,
  userTotpEnrollments,
} from './schema.js'

describe('user-owned operational records', () => {
  it.each([
    ['backup jobs', backupJobs],
    ['budget reservations', budgetReservations],
    ['credit ledger entries', creditLedger],
    ['usage events', usageEvents],
    ['daily usage rollups', dailyUsageRollups],
    ['export jobs', exportJobs],
    ['TOTP credentials', userTotpCredentials],
    ['pending TOTP enrollments', userTotpEnrollments],
    ['two-factor recovery codes', twoFactorRecoveryCodes],
  ])('deletes %s when their user is deleted', (_name, table) => {
    const userForeignKey = getTableConfig(table as PgTable).foreignKeys.find((foreignKey) =>
      foreignKey.getName().endsWith('_user_id_users_id_fk'),
    )

    expect(userForeignKey?.onDelete).toBe('cascade')
  })
})
