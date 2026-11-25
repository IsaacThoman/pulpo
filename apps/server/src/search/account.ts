import type { SearchAccountSummary, SearchUsageLimit } from '@pulpo/contracts/search'
import { eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { availableAccountBalanceMicros } from '../billing/allocation.js'
import { getBillingEntitlements } from '../billing/entitlements.js'
import { fiveHourLimitSummary, loadCustomLimitSummaries, weeklyLimitSummary } from '../billing/routes.js'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { users } from '../database/schema.js'
import { activePoolMembers, activePoolMembership, pendingFundingByUser } from '../pools/service.js'

type SearchUser = (request: FastifyRequest, reply: FastifyReply) => { id: string }

type LimitBar = Omit<SearchUsageLimit, 'id' | 'label'>

function usageLimit(id: string, label: string, limit: LimitBar): SearchUsageLimit {
  const { remainingPercentage, availableBarPercentage, pendingBarPercentage } = limit
  return { id, label, remainingPercentage, availableBarPercentage, pendingBarPercentage }
}

/** The same weekly, 5-hour, and custom limits Pulpo's usage bars show. */
export async function searchUsageLimits(userId: string): Promise<SearchUsageLimit[]> {
  const entitlements = await getBillingEntitlements(userId)
  const weekly = weeklyLimitSummary(entitlements)
  const fiveHour = fiveHourLimitSummary(entitlements)
  const custom = await loadCustomLimitSummaries(userId, entitlements.plan)
  return [
    ...(weekly ? [usageLimit('weekly', 'Weekly usage', weekly)] : []),
    ...(fiveHour ? [usageLimit('five_hour', '5-hour usage', fiveHour)] : []),
    ...custom.map((limit) => usageLimit(limit.id, limit.name, limit)),
  ]
}

/** Shows the Pulpo credits and limits Search draws on, without the full billing summary. */
export async function searchAccountSummary(userId: string): Promise<SearchAccountSummary> {
  const billing = getConfig().PULPO_BILLING_ENABLED
  const [balances, limits] = await Promise.all([
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
    billing ? searchUsageLimits(userId) : [],
  ])
  return { billing, ...balances, limits }
}

export function registerSearchAccountRoute(app: FastifyInstance, authorize: SearchUser) {
  app.get('/api/search/account', async (request, reply) => {
    const user = authorize(request, reply)
    return searchAccountSummary(user.id)
  })
}
