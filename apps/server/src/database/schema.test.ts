import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { readFileSync } from 'node:fs'
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
  fiveHourUsagePeriods,
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
  chatTurnEmbeddings,
  userMemoryDocuments,
  userMemoryDocumentRevisions,
  episodicMemoryGenerations,
  episodicMemoryMetricBuckets,
  queuedMessages,
  requestLogs,
  responses,
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
    ['five-hour usage periods', fiveHourUsagePeriods],
    ['memory documents', userMemoryDocuments],
    ['memory document revisions', userMemoryDocumentRevisions],
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

  it('constrains per-user billing overrides', () => {
    const config = getTableConfig(billingAccounts)
    expect(config.checks.map((constraint) => constraint.name)).toEqual(expect.arrayContaining([
      'billing_accounts_plan_override_check',
      'billing_accounts_storage_override_check',
    ]))
  })

  it('persists administrator billing and actor attribution for delayed chat work', () => {
    const queue = getTableConfig(queuedMessages)
    const logs = getTableConfig(requestLogs)

    expect(queue.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'billing_user_id',
      'actor_user_id',
    ]))
    expect(logs.columns.map((column) => column.name)).toContain('actor_user_id')
    expect(queue.columns.find((column) => column.name === 'billing_user_id')?.notNull).toBe(false)
    expect(logs.columns.find((column) => column.name === 'actor_user_id')?.notNull).toBe(false)
  })

  it('distinguishes disabled payload capture from indefinite retention', () => {
    const logs = getTableConfig(requestLogs)
    const captureColumn = logs.columns.find((column) => column.name === 'capture_detailed_payloads')
    const expiryIndex = logs.indexes.find((item) => item.config.name === 'request_logs_payload_expiry_idx')
    const migration = readFileSync(new URL('../../drizzle/0056_curved_captain_cross.sql', import.meta.url), 'utf8')

    expect(captureColumn?.notNull).toBe(true)
    expect(captureColumn?.hasDefault).toBe(true)
    expect(expiryIndex).toBeDefined()
    expect(migration).toContain('SET "capture_detailed_payloads" = true')
    expect(migration).toContain('SET "capture_detailed_payloads" = false, "request_payload" = NULL, "response_payload" = NULL')
  })

  it('persists public response metadata, incomplete state, and scoped idempotency', () => {
    const config = getTableConfig(responses)
    expect(config.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'metadata', 'incomplete_details', 'idempotency_scope', 'idempotency_fingerprint', 'publicly_stored',
    ]))
    const index = config.indexes.find((item) => item.config.name === 'responses_user_scope_idempotency_unique')
    expect(index?.config.unique).toBe(true)
    expect(index?.config.columns.map((column) => 'name' in column ? column.name : undefined))
      .toEqual(['user_id', 'idempotency_scope', 'idempotency_key'])
  })

  it('backfills public response retention without changing accounting records', () => {
    const migration = readFileSync(new URL('../../drizzle/0047_public_starfox.sql', import.meta.url), 'utf8')
    expect(migration).toContain('ADD COLUMN "publicly_stored" boolean DEFAULT true NOT NULL')
    expect(migration).not.toContain('budget_reservations')
    expect(migration).not.toContain('request_logs')
    expect(migration).not.toContain('usage_events')
    expect(migration).not.toContain('credit_ledger')
  })

  it('grandfathers existing subscription reservations before enforcing five-hour parity', () => {
    const migration = readFileSync(new URL('../../drizzle/0048_bouncy_leader.sql', import.meta.url), 'utf8')
    expect(migration).toContain('"five_hour_reserved_micros" = "weekly_reserved_micros"')
    expect(migration).toContain('CURRENT_TIMESTAMP')
    expect(migration.indexOf('UPDATE "budget_reservations"')).toBeLessThan(migration.indexOf('reservation_five_hour_match_check'))
  })

  it('backfills existing API requests into Responses-protocol idempotency scopes', () => {
    const migration = readFileSync(new URL('../../drizzle/0045_openai_completions_compatibility.sql', import.meta.url), 'utf8')
    expect(migration).toContain("'api:' || COALESCE(\"log\".\"api_key_id\"::text, 'legacy') || ':responses'")
    expect(migration).toContain('responses_user_scope_idempotency_unique')
  })

  it('repairs compatibility columns skipped by previously deployed migration order', () => {
    const migration = readFileSync(new URL('../../drizzle/0050_repair_openai_compatibility_drift.sql', import.meta.url), 'utf8')

    expect(migration).toContain('DROP INDEX IF EXISTS "responses_user_idempotency_unique"')
    for (const column of ['metadata', 'incomplete_details', 'idempotency_scope', 'idempotency_fingerprint']) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS "${column}"`)
    }
    expect(migration).toContain("'api:' || COALESCE(\"log\".\"api_key_id\"::text, 'legacy') || ':responses'")
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "responses_user_scope_idempotency_unique"')
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

  it('stores isolated episodic-memory generations and user-owned chat vectors', () => {
    const generationConfig = getTableConfig(episodicMemoryGenerations)
    const chatConfig = getTableConfig(chatTurnEmbeddings)
    expect(generationConfig.indexes.find((item) => item.config.name === 'episodic_memory_generations_active_unique')?.config.unique).toBe(true)
    expect(generationConfig.checks.map((constraint) => constraint.name)).toEqual(expect.arrayContaining([
      'episodic_memory_generations_profile_check',
      'episodic_memory_generations_dimension_check',
      'episodic_memory_generations_status_check',
    ]))
    expect(chatConfig.indexes.map((item) => item.config.name)).toEqual(expect.arrayContaining([
      'chat_turn_embeddings_generation_response_unique',
      'chat_turn_embeddings_user_generation_idx',
      'chat_turn_embeddings_search_idx',
    ]))
    expect(chatConfig.foreignKeys.every((foreignKey) => foreignKey.onDelete === 'cascade')).toBe(true)
  })

  it('stores one bounded versioned memory document per user', () => {
    const documentConfig = getTableConfig(userMemoryDocuments)
    const revisionConfig = getTableConfig(userMemoryDocumentRevisions)
    expect(documentConfig.primaryKeys).toHaveLength(0)
    expect(documentConfig.columns.find((column) => column.name === 'user_id')?.primary).toBe(true)
    expect(documentConfig.checks.map((constraint) => constraint.name)).toEqual(expect.arrayContaining([
      'user_memory_documents_content_length_check',
      'user_memory_documents_revision_check',
      'user_memory_documents_editor_check',
    ]))
    expect(revisionConfig.indexes.find((item) => item.config.name === 'user_memory_document_revisions_user_revision_unique')?.config.unique).toBe(true)
    expect(revisionConfig.indexes.map((item) => item.config.name)).toContain('user_memory_document_revisions_user_superseded_idx')
  })

  it('stores only fixed aggregate episodic-memory metrics', () => {
    const config = getTableConfig(episodicMemoryMetricBuckets)
    expect(config.primaryKeys).toHaveLength(1)
    expect(config.primaryKeys[0]!.columns.map((column) => column.name)).toEqual(['bucket_start', 'metric'])
    expect(config.indexes.map((item) => item.config.name)).toContain('episodic_memory_metric_buckets_metric_time_idx')
    expect(config.checks.map((constraint) => constraint.name)).toEqual(expect.arrayContaining([
      'episodic_memory_metric_buckets_metric_check',
      'episodic_memory_metric_buckets_counts_check',
    ]))
    expect(config.columns.map((column) => column.name)).not.toEqual(expect.arrayContaining([
      'user_id', 'chat_id', 'query', 'prompt', 'excerpt', 'content',
    ]))
  })

  it('keeps the renumbered episodic-memory migration compatible with existing preview databases', () => {
    const migration = readFileSync(new URL('../../drizzle/0049_episodic_memory.sql', import.meta.url), 'utf8')

    expect(migration.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(4)
    expect(migration.match(/EXCEPTION WHEN duplicate_object THEN NULL/g)).toHaveLength(7)
    expect(migration.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS/g)).toHaveLength(10)
  })

  it('replaces saved facts with bounded versioned memory documents', () => {
    const migration = readFileSync(new URL('../../drizzle/0051_burly_ulik.sql', import.meta.url), 'utf8')
    expect(migration).toContain('CREATE TABLE "user_memory_documents"')
    expect(migration).toContain('CREATE TABLE "user_memory_document_revisions"')
    expect(migration).toContain('char_length("user_memory_documents"."content") <= 16000')
    expect(migration.indexOf('DROP TABLE "saved_memory_embeddings"')).toBeLessThan(migration.indexOf('DROP TABLE "memories"'))
    expect(migration).not.toContain('DROP TABLE "chat_turn_embeddings"')
    expect(migration).toContain('CREATE INDEX "user_memory_document_revisions_user_superseded_idx"')
  })
})
