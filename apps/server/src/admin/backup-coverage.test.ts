import { getTableName, is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from '../database/schema.js'
import { FULL_BACKUP_TABLES } from './backup-format.js'

// Every exclusion needs an explicit reason. New application tables must make a
// deliberate durability decision instead of silently disappearing on restore.
const excluded = {
  sessions: 'Existing sessions must be invalidated on recovery',
  passkey_ceremonies: 'Short-lived authentication challenges',
  mobile_passkey_auth_codes: 'Short-lived authentication exchanges',
  password_reset_tokens: 'Short-lived password reset grants',
  user_totp_enrollments: 'Unfinished second-factor enrollment',
  codex_login_attempts: 'Unfinished provider login exchanges',
  provider_upstream_models: 'Rebuilt provider catalog cache',
  provider_health_checks: 'Live provider health probes',
  budget_reservations: 'Reservations belong to live generation jobs',
  budget_reservation_funders: 'Live generation reservation accounting',
  budget_reservation_allowance_funders: 'Live generation reservation accounting',
  export_jobs: 'Operational transfer jobs',
  backup_jobs: 'Operational transfer jobs',
  restore_uploads: 'The active restore transfer must survive its own import',
}
const tables = (Object.values(schema) as unknown[]).filter((value): value is PgTable => is(value, PgTable))

describe('full backup schema coverage', () => {
  it('classifies every application table exactly once', () => {
    expect([...FULL_BACKUP_TABLES, ...Object.keys(excluded)].sort()).toEqual(tables.map(getTableName).sort())
    expect(new Set(FULL_BACKUP_TABLES).size).toBe(FULL_BACKUP_TABLES.length)
  })

  it('restores referenced tables before their dependents', () => {
    for (const table of tables) {
      const name = getTableName(table)
      const index = (FULL_BACKUP_TABLES as readonly string[]).indexOf(name)
      if (index < 0) continue
      for (const key of getTableConfig(table).foreignKeys) {
        const dependency = getTableName(key.reference().foreignTable)
        if (dependency === name) continue
        const dependencyIndex = (FULL_BACKUP_TABLES as readonly string[]).indexOf(dependency)
        expect(dependencyIndex, `${name} depends on ${dependency}`).toBeGreaterThanOrEqual(0)
        expect(dependencyIndex, `${name} depends on ${dependency}`).toBeLessThan(index)
      }
    }
  })
})
