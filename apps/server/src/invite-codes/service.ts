import { and, eq, isNull, sql } from 'drizzle-orm'
import type { AdminInviteCode, InviteCode } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { applicationSettings, inviteCodes, users } from '../database/schema.js'
import { hasDatabaseErrorCode } from '../database/errors.js'
import { getConfig } from '../config.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { parseAuthSettings } from '../settings/application-settings.js'
import { generateInviteCode, normalizeInviteCode } from './codes.js'

type InviteCodeRow = typeof inviteCodes.$inferSelect

export async function inviteCodesEnabled(): Promise<boolean> {
  if (!getConfig().PULPO_BILLING_ENABLED) return false
  const [setting] = await db.select({ value: applicationSettings.value })
    .from(applicationSettings)
    .where(eq(applicationSettings.key, 'auth'))
    .limit(1)
  return parseAuthSettings(setting?.value).inviteCodesEnabled
}

export async function assertInviteCodesEnabled(): Promise<void> {
  if (!await inviteCodesEnabled()) {
    throw new AppError(403, 'invite_codes_disabled', 'Invite codes are disabled')
  }
}

export function serializeInviteCode(row: InviteCodeRow): InviteCode {
  return {
    id: row.id,
    code: row.code,
    ownerUserId: row.ownerUserId,
    redeemedByUserId: row.redeemedByUserId,
    redeemedAt: row.redeemedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

export function serializeAdminInviteCode(row: InviteCodeRow, ownerUsername: string | null, redeemedByUsername: string | null): AdminInviteCode {
  return {
    ...serializeInviteCode(row),
    createdByUserId: row.createdByUserId,
    ownerUsername,
    redeemedByUsername,
  }
}

async function insertGeneratedCode(input: {
  createdByUserId: string
  ownerUserId: string | null
}): Promise<InviteCodeRow> {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const [created] = await db.insert(inviteCodes).values({
        id: newId(),
        code: generateInviteCode(),
        createdByUserId: input.createdByUserId,
        ownerUserId: input.ownerUserId,
      }).returning()
      return created!
    } catch (error) {
      if (!hasDatabaseErrorCode(error, '23505') || attempt === 7) throw error
    }
  }
  throw new AppError(500, 'invite_code_generate_failed', 'Could not generate a unique invite code')
}

export async function createPoolInviteCodes(createdByUserId: string, count: number): Promise<InviteCodeRow[]> {
  const created: InviteCodeRow[] = []
  for (let index = 0; index < count; index++) {
    created.push(await insertGeneratedCode({ createdByUserId, ownerUserId: null }))
  }
  return created
}

export async function createOwnedInviteCode(userId: string): Promise<InviteCodeRow> {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [owner] = await tx.select({
          id: users.id,
          inviteCodeQuota: users.inviteCodeQuota,
        }).from(users).where(eq(users.id, userId)).for('update').limit(1)
        if (!owner) throw new AppError(404, 'not_found', 'User not found')
        const [usage] = await tx.select({
          used: sql<number>`count(*)::int`,
        }).from(inviteCodes).where(and(eq(inviteCodes.ownerUserId, userId), isNull(inviteCodes.revokedAt)))
        if (Number(usage?.used ?? 0) >= owner.inviteCodeQuota) {
          throw new AppError(409, 'invite_quota_exhausted', 'You have no remaining invite codes')
        }
        const [created] = await tx.insert(inviteCodes).values({
          id: newId(),
          code: generateInviteCode(),
          createdByUserId: userId,
          ownerUserId: userId,
        }).returning()
        return created!
      })
    } catch (error) {
      if (error instanceof AppError) throw error
      if (!hasDatabaseErrorCode(error, '23505') || attempt === 7) throw error
    }
  }
  throw new AppError(500, 'invite_code_generate_failed', 'Could not generate a unique invite code')
}

export async function redeemInviteCode(userId: string, rawCode: string): Promise<typeof users.$inferSelect> {
  const code = normalizeInviteCode(rawCode)
  if (!code) throw new AppError(400, 'invite_code_invalid', 'Enter a valid 6-character invite code')

  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update').limit(1)
    if (!user) throw new AppError(401, 'unauthorized', 'Authentication required')
    if (user.role !== 'pending') throw new AppError(409, 'already_approved', 'This account is already approved')

    const [invite] = await tx.select().from(inviteCodes).where(eq(inviteCodes.code, code)).for('update').limit(1)
    if (!invite || invite.revokedAt || invite.redeemedByUserId) {
      throw new AppError(400, 'invite_code_invalid', 'This invite code is invalid or already used')
    }
    if (invite.ownerUserId === userId) {
      throw new AppError(400, 'invite_code_own', 'You cannot redeem your own invite code')
    }

    await tx.update(inviteCodes).set({
      redeemedByUserId: userId,
      redeemedAt: new Date(),
    }).where(eq(inviteCodes.id, invite.id))

    const [updated] = await tx.update(users).set({
      role: 'user',
      stateRevision: sql`${users.stateRevision} + 1`,
      updatedAt: new Date(),
    }).where(eq(users.id, userId)).returning()
    return updated!
  })
}
