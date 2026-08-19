import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  backupJobs,
  billingAccounts,
  billingCheckouts,
  billingOrders,
  billingSubscriptions,
  budgetReservations,
  creditLedger,
  dailyUsageRollups,
  exportJobs,
  friendships,
  twoFactorRecoveryCodes,
  userPasskeyCredentials,
  passkeyCeremonies,
  mobilePasskeyAuthCodes,
  usageEvents,
  userBlocks,
  users,
  userTotpCredentials,
  userTotpEnrollments,
  weeklyUsagePeriods,
} from './schema.js'

describe('user-owned operational records', () => {
  it.each([
    ['backup jobs', backupJobs],
    ['budget reservations', budgetReservations],
    ['billing accounts', billingAccounts],
    ['billing checkouts', billingCheckouts],
    ['billing orders', billingOrders],
    ['billing subscriptions', billingSubscriptions],
    ['credit ledger entries', creditLedger],
    ['usage events', usageEvents],
    ['daily usage rollups', dailyUsageRollups],
    ['export jobs', exportJobs],
    ['user blocks', userBlocks],
    ['TOTP credentials', userTotpCredentials],
    ['pending TOTP enrollments', userTotpEnrollments],
    ['two-factor recovery codes', twoFactorRecoveryCodes],
    ['passkey credentials', userPasskeyCredentials],
    ['passkey ceremonies', passkeyCeremonies],
    ['mobile passkey authorization codes', mobilePasskeyAuthCodes],
    ['weekly usage periods', weeklyUsagePeriods],
  ])('deletes %s when their user is deleted', (_name, table) => {
    const userForeignKey = getTableConfig(table as PgTable).foreignKeys.find((foreignKey) =>
      foreignKey.getName().endsWith('_user_id_users_id_fk'),
    )

    expect(userForeignKey?.onDelete).toBe('cascade')
  })

  it('enforces normalized friendship pairs and non-self blocks', () => {
    const friendshipConfig = getTableConfig(friendships)
    const blockConfig = getTableConfig(userBlocks)
    expect(friendshipConfig.checks.map((constraint) => constraint.name)).toEqual(expect.arrayContaining([
      'friendships_ordered_pair_check',
      'friendships_requester_member_check',
    ]))
    expect(friendshipConfig.indexes.some((item) => item.config.name === 'friendships_pair_unique' && item.config.unique)).toBe(true)
    expect(friendshipConfig.foreignKeys).toHaveLength(3)
    expect(friendshipConfig.foreignKeys.every((foreignKey) => foreignKey.onDelete === 'cascade')).toBe(true)
    expect(blockConfig.checks.map((constraint) => constraint.name)).toContain('user_blocks_not_self_check')
  })

  it('requires usernames and uses a case-insensitive unique index', () => {
    const userConfig = getTableConfig(users)
    expect(userConfig.columns.find((column) => column.name === 'username')?.notNull).toBe(true)
    const usernameIndex = userConfig.indexes.find((item) => item.config.name === 'users_username_unique')
    expect(usernameIndex?.config.unique).toBe(true)
    expect(usernameIndex?.config.where).toBeUndefined()
    expect(userConfig.indexes.map((item) => item.config.name)).toEqual(expect.arrayContaining([
      'users_username_trgm_idx',
      'users_name_trgm_idx',
    ]))
  })
})
