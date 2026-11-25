import type { SearchAccountSummary } from '@pulpo/contracts/search'
import { eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { availableAccountBalanceMicros } from '../billing/allocation.js'
import { getBillingEntitlements } from '../billing/entitlements.js'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { users } from '../database/schema.js'
import { activePoolMembers, activePoolMembership, pendingFundingByUser } from '../pools/service.js'

type SearchUser = (request: FastifyRequest, reply: FastifyReply) => { id: string }

/** Shows the Pulpo credits Search draws on, without the full billing summary. */
export async function searchAccountSummary(userId: string): Promise<SearchAccountSummary> {
  const billing = getConfig().PULPO_BILLING_ENABLED
  const [balances, entitlements] = await Promise.all([
    db.transaction(async (tx) => {
      const membership = await activePoolMembership(tx, userId)
      const members = membership
        ? (await activePoolMembers(tx, membership.pool.id)).map((row) => row.user)
        : await tx.select().from(users).where(eq(users.id, userId)).limit(1)
      const pending = await pendingFundingByUser(tx, members.map((member) => member.id))
      const available = (member: (typeof members)[number]) => Math.max(0, availableAccountBalanceMicros({
        balanceMicros: member.balanceMicros, pendingBalanceMicros: pending.get(member.id) ?? 0,
      }))
      const own = members.find((member) => member.id === userId)
      return {
        balanceMicros: own ? available(own) : 0,
        poolBalanceMicros: membership ? members.reduce((sum, member) => sum + available(member), 0) : null,
      }
    }),
    billing ? getBillingEntitlements(userId) : null,
  ])
  return {
    billing,
    ...balances,
    weeklyRemainingPercentage: entitlements?.weeklyRemainingPercentage ?? null,
  }
}

export function registerSearchAccountRoute(app: FastifyInstance, authorize: SearchUser) {
  app.get('/api/search/account', async (request, reply) => {
    const user = authorize(request, reply)
    return searchAccountSummary(user.id)
  })
}
