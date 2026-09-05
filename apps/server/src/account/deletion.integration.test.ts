import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import type Stripe from 'stripe'
import cookie from '@fastify/cookie'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(async () => undefined), cancelBilling: vi.fn(async () => undefined),
  deleteBlob: vi.fn(async () => undefined), controller: vi.fn(async () => ({ ok: true, status: 204 })),
}))
vi.mock('../billing/stripe.js', async (original) => ({ ...await original<typeof import('../billing/stripe.js')>(), planForPriceId: () => 'eight' }))
vi.mock('../jobs.js', () => ({ maintenanceQueue: { add: mocks.enqueue }, embeddingQueue: {}, generationQueue: {} }))
vi.mock('./stripe-deletion.js', () => ({ cancelAccountBilling: mocks.cancelBilling }))
vi.mock('../storage/index.js', () => ({ getBlobStore: () => ({ delete: mocks.deleteBlob }) }))
vi.mock('../agent/controller-http.js', () => ({ workspaceControllerRequest: mocks.controller }))
vi.mock('../responses/events.js', () => ({ publishSessionRevocation: vi.fn(), publishStateChange: vi.fn(), requestCancellation: vi.fn() }))
vi.mock('../redis.js', () => ({ redis: { del: vi.fn(), publish: vi.fn(), get: vi.fn(async () => null), incr: vi.fn(async () => 1), expire: vi.fn() } }))

import { db, queryClient } from '../database/client.js'
import { applicationSettings, attachments, auditEvents, chats, chatShares, passwordCredentials, pools, poolMembers, sessions, users, models, providerConnections, responses, budgetReservations, budgetReservationFunders, workspaceLeases, userTotpCredentials, twoFactorRecoveryCodes, billingSubscriptions, billingAccounts } from '../database/schema.js'
import { authenticateSession, createPasswordHash } from '../auth/service.js'
import { hashToken } from '../lib/crypto.js'
import { requireSensitiveAuth } from '../auth/sensitive-action.js'
import { AppError } from '../lib/errors.js'
import { acceptAccountDeletion, deleteAccountData, resumeAccountDeletions } from './deletion.js'
import { processStripeWebhookEvent } from '../billing/webhooks.js'
import { registerAccountDeletionRoutes } from './routes.js'

// Run only against an explicitly selected, disposable migrated database.
const enabled = process.env.PULPO_ACCOUNT_DELETION_TESTS === 'true'
const userId = randomUUID()
const otherId = randomUUID()
async function addUser(id = userId, role: 'user' | 'admin' | 'pending' = 'user') {
  await db.insert(users).values({ id, role, name: 'Test', email: `${id}@example.test`, username: `u${id.replaceAll('-', '')}` })
}
async function ageDeletion() {
  await db.update(users).set({ deletionRequestedAt: new Date(Date.now() - 17 * 60_000) }).where(eq(users.id, userId))
}

describe.skipIf(!enabled)('account deletion with PostgreSQL', () => {
  beforeEach(async () => {
    if (!process.env.DATABASE_URL?.includes('/pulpo_account_test')) throw new Error('A disposable pulpo_account_test database is required')
    await db.execute(sql`truncate users, application_settings, audit_events cascade`)
    vi.clearAllMocks()
    mocks.enqueue.mockResolvedValue(undefined)
    mocks.cancelBilling.mockResolvedValue(undefined)
    mocks.deleteBlob.mockResolvedValue(undefined)
    mocks.controller.mockResolvedValue({ ok: true, status: 204 })
    await addUser()
    const providerId = randomUUID()
    await db.insert(providerConnections).values({ id: providerId, name: 'Test', encryptedApiKey: 'unused' })
    await db.insert(models).values({ id: 'test-model', providerConnectionId: providerId, name: 'Test', upstreamModelId: 'test', contextWindow: 4096, maxOutputTokens: 1024 }).onConflictDoNothing()
  })
  afterAll(async () => { await queryClient.end() })

  it('durably revokes access and shares even when queue dispatch fails', async () => {
    await db.insert(sessions).values({ id: randomUUID(), userId, tokenHash: hashToken('cookie-token'), expiresAt: new Date(Date.now() + 100_000) })
    const chatId = randomUUID()
    await db.insert(chats).values({ id: chatId, userId, title: 'Private chat', modelId: 'test-model' })
    await db.insert(chatShares).values({ id: randomUUID(), userId, chatId, tokenHash: hashToken('shared') })
    mocks.enqueue.mockRejectedValueOnce(new Error('Redis unavailable'))
    await acceptAccountDeletion(userId)
    const [user] = await db.select().from(users).where(eq(users.id, userId))
    expect(user?.blocked).toBe(true)
    expect(user?.deletionRequestedAt).toBeInstanceOf(Date)
    expect(await db.select().from(sessions)).toHaveLength(0)
    expect((await db.select().from(chatShares))[0]?.revokedAt).toBeInstanceOf(Date)
    await expect(db.insert(chats).values({ id: randomUUID(), userId, title: 'Late write', modelId: 'test-model' })).rejects.toThrow()
    await expect(db.update(users).set({ blocked: false }).where(eq(users.id, userId))).rejects.toThrow()
    await acceptAccountDeletion(userId)
    expect((await db.select().from(auditEvents)).filter((row) => row.action === 'account.deletion.requested')).toHaveLength(1)
  })

  it('enforces disabled settings without changing the account', async () => {
    await db.insert(applicationSettings).values({ key: 'auth', value: { accountDeletionEnabled: false } })
    await expect(acceptAccountDeletion(userId)).rejects.toMatchObject({ code: 'account_deletion_disabled' })
    expect((await db.select().from(users))[0]?.deletionRequestedAt).toBeNull()
  })

  it('allows at most one of two administrators to delete concurrently', async () => {
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, userId))
    await addUser(otherId, 'admin')
    const outcomes = await Promise.allSettled([acceptAccountDeletion(userId), acceptAccountDeletion(otherId)])
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await db.select().from(users).where(and(eq(users.role, 'admin'), eq(users.blocked, false)))).toHaveLength(1)
  })

  it('protects the remaining administrator against demotion and blocking', async () => {
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, userId))
    await addUser(otherId, 'admin')
    await acceptAccountDeletion(userId)
    await expect(db.update(users).set({ role: 'user' }).where(eq(users.id, otherId))).rejects.toThrow()
    await expect(db.update(users).set({ blocked: true }).where(eq(users.id, otherId))).rejects.toThrow()
  })

  it('requires ownership transfer, then removes membership while preserving the other user', async () => {
    await addUser(otherId)
    const poolId = randomUUID()
    await db.insert(pools).values({ id: poolId, ownerUserId: userId })
    await db.insert(poolMembers).values([userId, otherId].map((id) => ({ id: randomUUID(), poolId, userId: id })))
    await expect(acceptAccountDeletion(userId)).rejects.toMatchObject({ code: 'pool_owner_transfer_required' })
    await db.update(pools).set({ ownerUserId: otherId }).where(eq(pools.id, poolId))
    await acceptAccountDeletion(userId)
    expect((await db.select().from(poolMembers).where(eq(poolMembers.userId, userId)))[0]?.leftAt).toBeInstanceOf(Date)
    await ageDeletion()
    await deleteAccountData(userId)
    expect(await db.select().from(users).where(eq(users.id, otherId))).toHaveLength(1)
  })

  it('retries billing and file failures before deleting database references', async () => {
    await db.insert(attachments).values({ id: randomUUID(), userId, objectKey: 'test-file', originalName: 'test.txt', mimeType: 'text/plain', sizeBytes: 10 })
    await acceptAccountDeletion(userId)
    await ageDeletion()
    mocks.cancelBilling.mockRejectedValueOnce(new Error('Stripe unavailable'))
    await expect(deleteAccountData(userId)).rejects.toThrow('Stripe unavailable')
    expect(mocks.deleteBlob).not.toHaveBeenCalled()
    mocks.deleteBlob.mockRejectedValueOnce(new Error('Storage unavailable'))
    await expect(deleteAccountData(userId)).rejects.toThrow('Storage unavailable')
    expect(await db.select().from(attachments)).toHaveLength(1)
    expect((await db.select().from(users))[0]?.deletionError).toBe('Storage unavailable')
    await resumeAccountDeletions()
    expect(await db.select().from(users)).toHaveLength(0)
    expect(await db.select().from(attachments)).toHaveLength(0)
    await deleteAccountData(userId)
    expect((await db.select().from(auditEvents)).some((row) => row.action === 'account.deletion.completed')).toBe(true)
  })

  it('waits for other members’ funded work to settle without deleting their accounting totals', async () => {
    await addUser(otherId)
    const chatId = randomUUID(), responseId = randomUUID(), reservationId = randomUUID()
    await db.insert(chats).values({ id: chatId, userId: otherId, modelId: 'test-model' })
    await db.insert(responses).values({ id: responseId, userId: otherId, chatId, modelId: 'test-model', input: [], status: 'in_progress' })
    await db.insert(budgetReservations).values({ id: reservationId, userId: otherId, responseId, amountMicros: 100, balanceReservedMicros: 100 })
    await db.insert(budgetReservationFunders).values({ reservationId, userId, reservedMicros: 100 })
    await acceptAccountDeletion(userId); await ageDeletion()
    await expect(deleteAccountData(userId)).rejects.toThrow('Waiting for existing Pool contributions')
    expect((await db.select().from(responses))[0]?.status).toBe('in_progress')
    await db.update(budgetReservations).set({ status: 'settled', settledAmountMicros: 80 }).where(eq(budgetReservations.id, reservationId))
    await deleteAccountData(userId)
    expect((await db.select().from(budgetReservations))[0]?.settledAmountMicros).toBe(80)
    expect(await db.select().from(budgetReservationFunders)).toHaveLength(0)
    expect(await db.select().from(responses)).toHaveLength(1)
  })

  it('cancels queued work and retries controller failures without losing lease identifiers', async () => {
    const chatId = randomUUID(), responseId = randomUUID(), leaseId = randomUUID()
    await db.insert(chats).values({ id: chatId, userId, modelId: 'test-model' })
    await db.insert(responses).values({ id: responseId, userId, chatId, modelId: 'test-model', input: [] })
    await db.insert(workspaceLeases).values({ id: leaseId, userId, chatId, imageDigest: 'test', controllerLeaseId: 'lease_test' })
    await acceptAccountDeletion(userId); await ageDeletion()
    mocks.controller.mockResolvedValueOnce({ ok: false, status: 503 })
    await expect(deleteAccountData(userId)).rejects.toThrow('Workspace cleanup failed')
    expect((await db.select().from(responses))[0]?.status).toBe('cancelled')
    expect((await db.select().from(workspaceLeases))[0]?.controllerLeaseId).toBe('lease_test')
    await deleteAccountData(userId)
    expect(await db.select().from(workspaceLeases)).toHaveLength(0)
  })

  it('preserves blobs until signed upload links expire', async () => {
    await db.insert(attachments).values({ id: randomUUID(), userId, objectKey: 'pending-upload', originalName: 'test.txt', mimeType: 'text/plain', sizeBytes: 10 })
    await acceptAccountDeletion(userId)
    await expect(deleteAccountData(userId)).rejects.toThrow('upload URLs')
    expect(mocks.deleteBlob).not.toHaveBeenCalled()
    await ageDeletion(); await deleteAccountData(userId)
    expect(mocks.deleteBlob).toHaveBeenCalledWith('pending-upload')
  })

  it('ignores late subscription events both during cleanup and after permanent deletion', async () => {
    await db.insert(billingAccounts).values({ userId, stripeCustomerId: 'cus_deleted' })
    await db.insert(billingSubscriptions).values({ stripeSubscriptionId: 'sub_existing', userId, stripePriceId: 'price_test', plan: 'eight', status: 'canceled', providerModifiedAt: new Date(0) })
    await acceptAccountDeletion(userId)
    const event = (id: string): Stripe.Event => ({
      id: randomUUID(), type: 'customer.subscription.updated', created: Math.floor(Date.now() / 1000),
      data: { object: { id, customer: 'cus_deleted', metadata: { pulpo_user_id: userId }, status: 'active', cancel_at_period_end: false,
        items: { data: [{ price: { id: 'price_test' }, current_period_start: 100, current_period_end: 200 }] } } },
    } as unknown as Stripe.Event)
    await processStripeWebhookEvent(event('sub_existing'))
    expect((await db.select().from(billingSubscriptions))[0]?.status).toBe('canceled')
    await processStripeWebhookEvent(event('sub_new'))
    expect(await db.select().from(billingSubscriptions)).toHaveLength(1)
    await ageDeletion(); await deleteAccountData(userId)
    await processStripeWebhookEvent(event('sub_new'))
    expect(await db.select().from(billingSubscriptions)).toHaveLength(0)
    expect(await db.select().from(billingAccounts)).toHaveLength(0)
  })

  it('requires a second factor and accepts a recovery code only once', async () => {
    await db.insert(passwordCredentials).values({ userId, passwordHash: await createPasswordHash('correct-password') })
    await db.insert(userTotpCredentials).values({ userId, encryptedSecret: 'unused-for-recovery' })
    await db.insert(twoFactorRecoveryCodes).values({ id: randomUUID(), userId, codeHash: hashToken('ABCDEFGHJKLM') })
    await expect(requireSensitiveAuth(userId, 'correct-password')).rejects.toMatchObject({ code: 'two_factor_code_required' })
    await expect(requireSensitiveAuth(userId, 'correct-password', 'ABCD-EFGH-JKLM')).resolves.toBeUndefined()
    await expect(requireSensitiveAuth(userId, 'correct-password', 'ABCD-EFGH-JKLM')).rejects.toMatchObject({ code: 'two_factor_code_invalid' })
  })

  it.each(['cookie', 'bearer'])('supports %s sessions and pending users with password confirmation', async (kind) => {
    await db.update(users).set({ role: 'pending' }).where(eq(users.id, userId))
    await db.insert(passwordCredentials).values({ userId, passwordHash: await createPasswordHash('correct-password') })
    await db.insert(sessions).values({ id: randomUUID(), userId, tokenHash: hashToken('a'.repeat(40)), expiresAt: new Date(Date.now() + 100_000) })
    const app = Fastify()
    await app.register(cookie)
    app.addHook('onRequest', async (request) => { request.user = await authenticateSession(request) })
    app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : 400).send({ error: error instanceof Error ? error.message : 'Unknown error' }))
    await registerAccountDeletionRoutes(app)
    const headers = kind === 'cookie' ? { cookie: `pulpo_session=${'a'.repeat(40)}` } : { authorization: `Bearer ${'a'.repeat(40)}` }
    const wrong = await app.inject({ method: 'DELETE', url: '/api/me', headers, payload: { currentPassword: 'wrong' } })
    expect(wrong.statusCode).toBe(400)
    expect(await db.select().from(sessions)).toHaveLength(1)
    const accepted = await app.inject({ method: 'DELETE', url: '/api/me', headers, payload: { currentPassword: 'correct-password' } })
    expect(accepted.statusCode).toBe(202)
    expect((await app.inject({ method: 'DELETE', url: '/api/me', headers, payload: { currentPassword: 'correct-password' } })).statusCode).toBe(401)
    await app.close()
  })
})
