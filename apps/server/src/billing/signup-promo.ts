import { and, count, eq, gte, lt, sql, sum } from 'drizzle-orm'
import { db } from '../database/client.js'
import { applicationSettings, creditLedger, signupPromoClaims, users } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import {
  parseSignupPromoSettings,
  type SignupPromoBudgetPeriod,
  type SignupPromoSettings,
} from '../settings/application-settings.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = typeof db | Transaction

export const SIGNUP_PROMO_SETTINGS_KEY = 'signupPromo'
export const SIGNUP_PROMO_LEDGER_TYPE = 'signup_promo'
const DAY_MS = 24 * 60 * 60 * 1_000
const PERIOD_MS: Record<SignupPromoBudgetPeriod, number> = { hour: 60 * 60 * 1_000, day: DAY_MS }

export interface SignupPromoWindow {
  startsAt: Date
  resetsAt: Date
}

/** The UTC hour or day the instance budget is counted in. */
export function signupPromoWindow(period: SignupPromoBudgetPeriod, now = new Date()): SignupPromoWindow {
  const length = PERIOD_MS[period]
  const startsAt = new Date(Math.floor(now.getTime() / length) * length)
  return { startsAt, resetsAt: new Date(startsAt.getTime() + length) }
}

/** When an account stops being new enough to claim. */
export function signupPromoEligibleUntil(accountCreatedAt: Date, settings: Pick<SignupPromoSettings, 'eligibleDays'>): Date {
  return new Date(accountCreatedAt.getTime() + settings.eligibleDays * DAY_MS)
}

export interface SignupPromoOffer {
  amountMicros: number
  message: string
  eligibleUntil: string
  /** False while this period's instance budget cannot cover another claim. */
  available: boolean
  resetsAt: string
}

export interface SignupPromoAccount {
  role: string
  blocked: boolean
  createdAt: Date
}

/** Why an account cannot claim, or null when it can (budget aside). */
export function signupPromoIneligibility(
  settings: SignupPromoSettings,
  account: SignupPromoAccount,
  claimed: boolean,
  now = new Date(),
): 'disabled' | 'not_eligible' | 'already_claimed' | null {
  if (!settings.enabled) return 'disabled'
  if (claimed) return 'already_claimed'
  if (account.role === 'pending' || account.blocked) return 'not_eligible'
  if (signupPromoEligibleUntil(account.createdAt, settings) <= now) return 'not_eligible'
  return null
}

export async function loadSignupPromoSettings(executor: Executor = db): Promise<SignupPromoSettings> {
  const [row] = await executor.select({ value: applicationSettings.value }).from(applicationSettings)
    .where(eq(applicationSettings.key, SIGNUP_PROMO_SETTINGS_KEY)).limit(1)
  return parseSignupPromoSettings(row?.value)
}

async function claimedInWindow(executor: Executor, window: SignupPromoWindow): Promise<{ micros: number; claims: number }> {
  const [row] = await executor.select({ micros: sum(signupPromoClaims.amountMicros), claims: count() })
    .from(signupPromoClaims)
    .where(and(gte(signupPromoClaims.createdAt, window.startsAt), lt(signupPromoClaims.createdAt, window.resetsAt)))
  return { micros: Number(row?.micros ?? 0), claims: Number(row?.claims ?? 0) }
}

async function hasClaimed(executor: Executor, userId: string): Promise<boolean> {
  const [row] = await executor.select({ id: signupPromoClaims.id }).from(signupPromoClaims)
    .where(eq(signupPromoClaims.userId, userId)).limit(1)
  return Boolean(row)
}

/** The banner offer for this account, or null when it should not see one. */
export async function loadSignupPromoOffer(userId: string, now = new Date()): Promise<SignupPromoOffer | null> {
  const settings = await loadSignupPromoSettings()
  if (!settings.enabled) return null
  const [account] = await db.select({ role: users.role, blocked: users.blocked, createdAt: users.createdAt })
    .from(users).where(eq(users.id, userId)).limit(1)
  if (!account) return null
  if (signupPromoIneligibility(settings, account, await hasClaimed(db, userId), now)) return null
  const window = signupPromoWindow(settings.budgetPeriod, now)
  const spent = await claimedInWindow(db, window)
  return {
    amountMicros: settings.amountMicros,
    message: settings.message,
    eligibleUntil: signupPromoEligibleUntil(account.createdAt, settings).toISOString(),
    available: spent.micros + settings.amountMicros <= settings.budgetMicros,
    resetsAt: window.resetsAt.toISOString(),
  }
}

export interface SignupPromoClaimResult {
  amountMicros: number
  balanceMicros: number
  revision: number
}

/**
 * Grants the promo once per account. A transaction-scoped lock serializes claims so
 * concurrent requests cannot overspend the period's instance budget.
 */
export async function claimSignupPromo(userId: string, now = new Date()): Promise<SignupPromoClaimResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('signup-promo-claims'))`)
    const settings = await loadSignupPromoSettings(tx)
    const [account] = await tx.select({ role: users.role, blocked: users.blocked, createdAt: users.createdAt })
      .from(users).where(eq(users.id, userId)).limit(1).for('update')
    if (!account) throw new AppError(404, 'user_not_found', 'Account not found')
    const reason = signupPromoIneligibility(settings, account, await hasClaimed(tx, userId), now)
    if (reason === 'disabled') throw new AppError(404, 'signup_promo_unavailable', 'This promotion is not running')
    if (reason === 'already_claimed') throw new AppError(409, 'signup_promo_already_claimed', 'You have already claimed this promotion')
    if (reason === 'not_eligible') throw new AppError(403, 'signup_promo_not_eligible', 'This promotion is for new accounts')
    const window = signupPromoWindow(settings.budgetPeriod, now)
    const spent = await claimedInWindow(tx, window)
    if (spent.micros + settings.amountMicros > settings.budgetMicros) {
      throw new AppError(409, 'signup_promo_budget_exhausted', 'Promotional credits are all claimed for now. Try again later.')
    }
    await tx.insert(signupPromoClaims).values({ id: newId(), userId, amountMicros: settings.amountMicros, createdAt: now })
    const [updated] = await tx.update(users).set({
      balanceMicros: sql`${users.balanceMicros} + ${settings.amountMicros}`,
      stateRevision: sql`${users.stateRevision} + 1`,
      updatedAt: now,
    }).where(eq(users.id, userId)).returning({ balanceMicros: users.balanceMicros, revision: users.stateRevision })
    await tx.insert(creditLedger).values({
      id: newId(),
      userId,
      type: SIGNUP_PROMO_LEDGER_TYPE,
      amountMicros: settings.amountMicros,
      balanceAfterMicros: updated!.balanceMicros,
      metadata: {},
    })
    return { amountMicros: settings.amountMicros, balanceMicros: updated!.balanceMicros, revision: updated!.revision }
  })
}

export interface SignupPromoUsage {
  periodStartsAt: string
  resetsAt: string
  periodClaimedMicros: number
  periodClaims: number
  totalClaimedMicros: number
  totalClaims: number
}

export async function loadSignupPromoUsage(settings: SignupPromoSettings, now = new Date()): Promise<SignupPromoUsage> {
  const window = signupPromoWindow(settings.budgetPeriod, now)
  const [period, [total]] = await Promise.all([
    claimedInWindow(db, window),
    db.select({ micros: sum(signupPromoClaims.amountMicros), claims: count() }).from(signupPromoClaims),
  ])
  return {
    periodStartsAt: window.startsAt.toISOString(),
    resetsAt: window.resetsAt.toISOString(),
    periodClaimedMicros: period.micros,
    periodClaims: period.claims,
    totalClaimedMicros: Number(total?.micros ?? 0),
    totalClaims: Number(total?.claims ?? 0),
  }
}

