import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm'
import { db, queryClient } from '../database/client.js'
import { applicationSettings, creditLedger, signupPromoClaims, users } from '../database/schema.js'
import type { SignupPromoSettings } from '../settings/application-settings.js'
import {
  claimSignupPromo,
  loadSignupPromoOffer,
  SIGNUP_PROMO_LEDGER_TYPE,
  SIGNUP_PROMO_SETTINGS_KEY,
  signupPromoWindow,
} from './signup-promo.js'

const enabled = process.env.PULPO_BUDGET_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_budget_test') {
  throw new Error('Budget tests require a migrated disposable database named pulpo_budget_test')
}

const HOUR_MS = 60 * 60 * 1_000
const userIds: string[] = []
// Each test claims in its own far-future UTC hour, so budgets never see another test's claims.
let hourOffset = 0
function testHour(): Date {
  hourOffset += 1
  return new Date(Date.UTC(2040, 0, 1) + Math.floor(Math.random() * 100_000) * 24 * HOUR_MS + hourOffset * HOUR_MS + 30 * 60_000)
}

async function setSettings(settings: Partial<SignupPromoSettings>) {
  const value = { enabled: true, amountMicros: 1_000_000, message: '', eligibleDays: 7, budgetMicros: 3_000_000, budgetPeriod: 'hour', ...settings }
  await db.insert(applicationSettings).values({ key: SIGNUP_PROMO_SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: applicationSettings.key, set: { value } })
}

async function account(createdAt: Date, options: { role?: 'user' | 'pending'; balanceMicros?: number } = {}) {
  const id = randomUUID(); userIds.push(id)
  await db.insert(users).values({
    id, email: `${id}@example.test`, username: id, name: 'Signup promo QA', role: options.role ?? 'user',
    balanceMicros: options.balanceMicros ?? 0, createdAt, updatedAt: createdAt,
  })
  return id
}

async function balance(userId: string) {
  return (await db.select({ balanceMicros: users.balanceMicros }).from(users).where(eq(users.id, userId)))[0]!.balanceMicros
}

function codeOf(result: PromiseSettledResult<unknown>) {
  return result.status === 'rejected' ? (result.reason as { code?: string }).code : 'claimed'
}

describe.skipIf(!enabled)('signup promo claims in PostgreSQL', () => {
  beforeAll(async () => {
    await setSettings({})
  })
  beforeEach(async () => {
    await setSettings({})
  })
  afterAll(async () => {
    await db.delete(applicationSettings).where(eq(applicationSettings.key, SIGNUP_PROMO_SETTINGS_KEY))
    if (userIds.length) {
      await db.delete(signupPromoClaims).where(inArray(signupPromoClaims.userId, userIds))
      await db.delete(users).where(inArray(users.id, userIds))
    }
    await db.delete(signupPromoClaims).where(and(isNull(signupPromoClaims.userId), gte(signupPromoClaims.createdAt, new Date(Date.UTC(2040, 0, 1)))))
    await queryClient.end()
  })

  it('credits a new account once and records it in the ledger', async () => {
    const now = testHour()
    const userId = await account(new Date(now.getTime() - HOUR_MS), { balanceMicros: 250_000 })
    const offer = await loadSignupPromoOffer(userId, now)
    expect(offer).toMatchObject({ amountMicros: 1_000_000, available: true, resetsAt: signupPromoWindow('hour', now).resetsAt.toISOString() })

    const result = await claimSignupPromo(userId, now)
    expect(result).toMatchObject({ amountMicros: 1_000_000, balanceMicros: 1_250_000 })
    expect(await balance(userId)).toBe(1_250_000)
    const ledger = await db.select().from(creditLedger).where(and(eq(creditLedger.userId, userId), eq(creditLedger.type, SIGNUP_PROMO_LEDGER_TYPE)))
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ amountMicros: 1_000_000, balanceAfterMicros: 1_250_000 })

    await expect(claimSignupPromo(userId, now)).rejects.toMatchObject({ statusCode: 409, code: 'signup_promo_already_claimed' })
    expect(await loadSignupPromoOffer(userId, now)).toBeNull()
    expect(await balance(userId)).toBe(1_250_000)
  })

  it('never lets concurrent claims overspend the period budget', async () => {
    const now = testHour()
    // Room for one claim, raced by two accounts: without serialization both read an unspent budget.
    await setSettings({ budgetMicros: 1_500_000 })
    const ids = await Promise.all(Array.from({ length: 2 }, () => account(new Date(now.getTime() - HOUR_MS))))
    const results = await Promise.allSettled(ids.map((id) => claimSignupPromo(id, now)))
    const codes = results.map(codeOf)
    expect(codes.toSorted()).toEqual(['claimed', 'signup_promo_budget_exhausted'])
    const window = signupPromoWindow('hour', now)
    const claims = await db.select().from(signupPromoClaims)
      .where(and(gte(signupPromoClaims.createdAt, window.startsAt), lt(signupPromoClaims.createdAt, window.resetsAt)))
    expect(claims.reduce((sum, claim) => sum + claim.amountMicros, 0)).toBe(1_000_000)

    // Accounts that missed out see the offer as unavailable until the next period.
    const missed = ids.filter((_, index) => codes[index] !== 'claimed')
    expect(await loadSignupPromoOffer(missed[0]!, now)).toMatchObject({ available: false })
    const nextPeriod = new Date(window.resetsAt.getTime() + 60_000)
    expect(await loadSignupPromoOffer(missed[0]!, nextPeriod)).toMatchObject({ available: true })
    await expect(claimSignupPromo(missed[0]!, nextPeriod)).resolves.toMatchObject({ amountMicros: 1_000_000 })
  })

  it('keeps a deleted account’s claim in the period budget', async () => {
    const now = testHour()
    await setSettings({ budgetMicros: 1_000_000 })
    const first = await account(new Date(now.getTime() - HOUR_MS))
    await claimSignupPromo(first, now)
    await db.delete(users).where(eq(users.id, first))
    const second = await account(new Date(now.getTime() - HOUR_MS))
    await expect(claimSignupPromo(second, now)).rejects.toMatchObject({ code: 'signup_promo_budget_exhausted' })
  })

  it('refuses accounts that are too old, pending, or claiming while the promo is off', async () => {
    const now = testHour()
    const old = await account(new Date(now.getTime() - 8 * 24 * HOUR_MS))
    expect(await loadSignupPromoOffer(old, now)).toBeNull()
    await expect(claimSignupPromo(old, now)).rejects.toMatchObject({ statusCode: 403, code: 'signup_promo_not_eligible' })

    const pending = await account(new Date(now.getTime() - HOUR_MS), { role: 'pending' })
    await expect(claimSignupPromo(pending, now)).rejects.toMatchObject({ code: 'signup_promo_not_eligible' })

    await setSettings({ enabled: false })
    const fresh = await account(new Date(now.getTime() - HOUR_MS))
    expect(await loadSignupPromoOffer(fresh, now)).toBeNull()
    await expect(claimSignupPromo(fresh, now)).rejects.toMatchObject({ statusCode: 404, code: 'signup_promo_unavailable' })
    expect(await balance(fresh)).toBe(0)
  })
})
