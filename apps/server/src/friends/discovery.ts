import { inArray, sql } from 'drizzle-orm'
import type { FriendProfile, FriendSuggestion } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { users } from '../database/schema.js'
import { publicFriendProfile } from '../profile/service.js'

/** Only accepted, visible edges may explain a suggestion or a mutual friendship. */
function mutualFriendPairs(viewerId: string) {
  return sql`with viewer_friends as (
    select case when f.user_a_id = ${viewerId} then f.user_b_id else f.user_a_id end as id
    from friendships f
    where f.status = 'accepted' and (f.user_a_id = ${viewerId} or f.user_b_id = ${viewerId})
  ), pairs as (
    select v.id as mutual_id,
      case when f.user_a_id = v.id then f.user_b_id else f.user_a_id end as target_id
    from viewer_friends v
    join users m on m.id = v.id and m.blocked = false and m.role <> 'pending'
    join friendships f on (f.user_a_id = v.id or f.user_b_id = v.id) and f.status = 'accepted'
    where not exists (
      select 1 from user_blocks b
      where (b.blocker_user_id = ${viewerId} and b.blocked_user_id = v.id)
         or (b.blocked_user_id = ${viewerId} and b.blocker_user_id = v.id)
    )
  ), visible_pairs as (
    select p.* from pairs p
    join users t on t.id = p.target_id and t.blocked = false and t.role <> 'pending'
    where p.target_id <> ${viewerId} and not exists (
      select 1 from user_blocks b
      where (b.blocker_user_id = p.target_id and b.blocked_user_id in (${viewerId}, p.mutual_id))
         or (b.blocked_user_id = p.target_id and b.blocker_user_id in (${viewerId}, p.mutual_id))
    )
  )`
}

/** Batched for all requests/friends, rather than a query per person. */
export async function loadMutualFriends(viewerId: string, targetIds: string[]) {
  const result = new Map<string, FriendProfile[]>()
  if (!targetIds.length) return result
  const pairs = await db.execute<{ target_id: string; mutual_id: string }>(sql`${mutualFriendPairs(viewerId)}
    select * from visible_pairs where target_id in (${sql.join(targetIds.map((id) => sql`${id}`), sql`, `)})`)
  const ids = [...new Set(pairs.map((pair) => pair.mutual_id))]
  if (!ids.length) return result
  const profiles = await db.select().from(users).where(inArray(users.id, ids))
  const byId = new Map(profiles.map((profile) => [profile.id, publicFriendProfile(profile)]))
  for (const pair of pairs) {
    const profile = byId.get(pair.mutual_id)
    if (profile) {
      const mutuals = result.get(pair.target_id) ?? []
      mutuals.push(profile)
      result.set(pair.target_id, mutuals)
    }
  }
  for (const profiles of result.values()) profiles.sort((a, b) => a.username.localeCompare(b.username))
  return result
}

export async function friendSuggestions(viewerId: string): Promise<FriendSuggestion[]> {
  const ranked = await db.execute<{ target_id: string }>(sql`${mutualFriendPairs(viewerId)}
    select p.target_id from visible_pairs p
    join users t on t.id = p.target_id
    where not exists (
      select 1 from friendships f
      where (f.user_a_id = ${viewerId} and f.user_b_id = p.target_id)
         or (f.user_b_id = ${viewerId} and f.user_a_id = p.target_id)
    )
    group by p.target_id, t.username
    order by count(*) desc, lower(t.username), p.target_id
    limit 6`)
  const ids = ranked.map((row) => row.target_id)
  if (!ids.length) return []
  const [profiles, mutuals] = await Promise.all([
    db.select().from(users).where(inArray(users.id, ids)),
    loadMutualFriends(viewerId, ids),
  ])
  const byId = new Map(profiles.map((profile) => [profile.id, publicFriendProfile(profile)]))
  return ids.flatMap((id) => {
    const profile = byId.get(id)
    const mutualFriends = mutuals.get(id) ?? []
    return profile && mutualFriends.length ? [{ profile, mutualFriends }] : []
  })
}
