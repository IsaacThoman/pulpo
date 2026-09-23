import type Stripe from 'stripe'
import { and, eq } from 'drizzle-orm'
import type { db } from '../database/client.js'
import { billingAccounts, billingAutoTopUps } from '../database/schema.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type AutoTopUpDisabledReason = 'payment_failed' | 'payment_method_removed'

/** Stores the card that automatic top-ups charge off-session. */
export async function savePaymentMethod(
  tx: Transaction,
  userId: string,
  paymentMethod: Stripe.PaymentMethod | string | null | undefined,
): Promise<boolean> {
  if (!paymentMethod) return false
  const id = typeof paymentMethod === 'string' ? paymentMethod : paymentMethod.id
  const card = typeof paymentMethod === 'string' ? null : paymentMethod.card
  const now = new Date()
  const values = {
    stripePaymentMethodId: id,
    paymentMethodBrand: card?.brand ?? null,
    paymentMethodLast4: card?.last4 ?? null,
  }
  await tx.insert(billingAccounts).values({ userId, ...values }).onConflictDoUpdate({
    target: billingAccounts.userId,
    set: {
      ...values,
      // A new card clears a failure caused by the previous one.
      autoTopUpDisabledReason: null,
      autoTopUpDisabledAt: null,
      updatedAt: now,
    },
  })
  return true
}

export async function disableAutoTopUp(tx: Transaction, userId: string, reason: AutoTopUpDisabledReason): Promise<void> {
  const now = new Date()
  await tx.update(billingAccounts).set({
    autoTopUpEnabled: false,
    autoTopUpDisabledReason: reason,
    autoTopUpDisabledAt: now,
    ...(reason === 'payment_method_removed' ? {
      stripePaymentMethodId: null,
      paymentMethodBrand: null,
      paymentMethodLast4: null,
    } : {}),
    updatedAt: now,
  }).where(eq(billingAccounts.userId, userId))
}

/**
 * Marks an in-flight attempt failed. A declined card turns automatic top-ups off until
 * the user reviews them; `disable: false` is for attempts that never reached the card.
 */
export async function failAutoTopUpAttempt(tx: Transaction, input: {
  attemptId: string
  code: string
  message: string
  disable?: boolean
}): Promise<string | null> {
  const [attempt] = await tx.update(billingAutoTopUps).set({
    status: 'failed',
    failureCode: input.code.slice(0, 200),
    failureMessage: input.message.slice(0, 1_000),
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(billingAutoTopUps.id, input.attemptId), eq(billingAutoTopUps.status, 'processing')))
    .returning({ userId: billingAutoTopUps.userId })
  if (!attempt) return null
  if (input.disable !== false) await disableAutoTopUp(tx, attempt.userId, 'payment_failed')
  return attempt.userId
}
