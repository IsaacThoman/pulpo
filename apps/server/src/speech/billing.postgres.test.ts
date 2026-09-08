import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db, queryClient } from '../database/client.js'
import { billingAccounts, creditLedger, fiveHourUsagePeriods, poolMembers, pools, users, weeklyUsagePeriods } from '../database/schema.js'
import { chargeMeteredUsage } from '../accounting/service.js'

vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn() }))
vi.mock('../config.js', async original => {
  const config = await original<typeof import('../config.js')>()
  return { ...config, getConfig: () => ({ ...config.getConfig(), PULPO_BILLING_ENABLED: true }) }
})
const enabled = process.env.PULPO_SPEECH_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_speech_test') {
  throw new Error('Speech billing tests require a migrated disposable database named pulpo_speech_test')
}
const userIds: string[] = []
const poolIds: string[] = []
async function account(balanceMicros: number) {
  const id = randomUUID(); userIds.push(id)
  await db.insert(users).values({ id, email: `${id}@example.test`, name: 'Speech QA', username: id, balanceMicros })
  return id
}
const charge = (userId: string, costMicros: number) => chargeMeteredUsage({ userId, costMicros, type: 'speech', metadata: { requestId: randomUUID(), modelId: 'speech-test', billingUnit: 'characters', characters: 100 } })

describe.skipIf(!enabled)('speech metered accounting in PostgreSQL', () => {
  afterAll(async () => {
    if (poolIds.length) await db.delete(pools).where(inArray(pools.id, poolIds))
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
    await queryClient.end()
  })
  it('debits balances and rolls back insufficient funding without a ledger entry', async () => {
    const id = await account(1000)
    await charge(id, 600)
    await expect(charge(id, 500)).rejects.toMatchObject({ code: 'insufficient_balance' })
    expect((await db.select().from(users).where(eq(users.id, id)))[0]?.balanceMicros).toBe(400)
    const ledger = await db.select().from(creditLedger).where(eq(creditLedger.userId, id))
    expect(ledger).toHaveLength(1); expect(ledger[0]?.amountMicros).toBe(-600)
    expect(ledger[0]?.metadata).toMatchObject({ modelId: 'speech-test', totalCostMicros: 600 })
  })
  it('uses subscription allowances before balance', async () => {
    const id = await account(1000)
    await db.insert(billingAccounts).values({ userId: id, planOverride: 'eight', weeklyLimitOverrideMicros: 200, fiveHourLimitOverrideMicros: 300 })
    await charge(id, 600)
    // Weekly and five-hour limits both constrain the same subscription usage.
    expect((await db.select().from(users).where(eq(users.id, id)))[0]?.balanceMicros).toBe(600)
    expect((await db.select().from(weeklyUsagePeriods).where(eq(weeklyUsagePeriods.userId, id)))[0]?.spentMicros).toBe(200)
    expect((await db.select().from(fiveHourUsagePeriods).where(eq(fiveHourUsagePeriods.userId, id)))[0]?.spentMicros).toBe(200)
  })
  it('allocates the remaining speech cost across an active pool', async () => {
    const caller = await account(100), peer = await account(1000), pool = randomUUID(); poolIds.push(pool)
    await db.insert(pools).values({ id: pool, ownerUserId: caller })
    await db.insert(poolMembers).values([caller, peer].map(userId => ({ id: randomUUID(), poolId: pool, userId })))
    await charge(caller, 600)
    const ledger = await db.select().from(creditLedger).where(inArray(creditLedger.userId, [caller, peer]))
    expect(ledger.reduce((sum, row) => sum + row.amountMicros, 0)).toBe(-600)
    for (const row of ledger) expect(row.metadata).toMatchObject({ poolId: pool, callerUserId: caller })
    const balances = await db.select().from(users).where(inArray(users.id, [caller, peer]))
    expect(balances.reduce((sum, row) => sum + row.balanceMicros, 0)).toBe(500)
  })
})
