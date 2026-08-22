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
  inviteCodes,
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
  poolMembers,
  poolInvitations,
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
    expect(userConfig.checks.map((constraint) => constraint.name)).toContain('users_invite_code_quota_check')
  })

  it('allows only nonnegative per-user storage overrides', () => {
    const config = getTableConfig(billingAccounts)
    expect(config.checks.map((constraint) => constraint.name)).toContain('billing_accounts_storage_override_check')
  })

  it('uses Stripe billing identifiers and keeps platform and processing fees separate', () => {
    const accountConfig = getTableConfig(billingAccounts)
    const checkoutConfig = getTableConfig(billingCheckouts)
    const orderConfig = getTableConfig(billingOrders)
    const subscriptionConfig = getTableConfig(billingSubscriptions)
    const allNames = [accountConfig, checkoutConfig, orderConfig, subscriptionConfig]
      .flatMap((config) => [
        ...config.columns.map((column) => column.name),
        ...config.indexes.map((index) => index.config.name),
      ])

    expect(allNames).toEqual(expect.arrayContaining([
      'stripe_customer_id',
      'stripe_checkout_session_id',
      'stripe_payment_id',
      'stripe_payment_intent_id',
      'stripe_charge_id',
      'stripe_price_id',
      'stripe_subscription_id',
      'platform_fee_amount_cents',
      'processing_fee_amount_cents',
    ]))
    expect(allNames.some((name) => name?.toLowerCase().includes(['po', 'lar'].join('')))).toBe(false)
  })

  it('enforces one active Pool membership and one pending invitation per Pool friend', () => {
    const memberConfig = getTableConfig(poolMembers)
    const inviteConfig = getTableConfig(poolInvitations)
    expect(memberConfig.indexes.find((item) => item.config.name === 'pool_members_user_active_unique')?.config.unique).toBe(true)
    expect(inviteConfig.indexes.find((item) => item.config.name === 'pool_invitations_pool_invitee_pending_unique')?.config.unique).toBe(true)
    expect(inviteConfig.checks.map((constraint) => constraint.name)).toContain('pool_invitations_status_check')
  })

  it('stores invite codes with a case-insensitive unique code', () => {
    const config = getTableConfig(inviteCodes)
    const codeIndex = config.indexes.find((item) => item.config.name === 'invite_codes_code_unique')
    expect(codeIndex?.config.unique).toBe(true)
    expect(config.indexes.map((item) => item.config.name)).toContain('invite_codes_owner_idx')
    const ownerFk = config.foreignKeys.find((foreignKey) => foreignKey.getName() === 'invite_codes_owner_user_id_users_id_fk')
    expect(ownerFk?.onDelete).toBe('cascade')
  })
})
