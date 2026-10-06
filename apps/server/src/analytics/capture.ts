import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import { CLIENT_PLATFORM_HEADER, parseClientPlatformHeader, type ClientPlatform } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { applicationSettings, billingAccounts, requestAnalytics, responses, userPreferences } from '../database/schema.js'
import { getConfig } from '../config.js'
import { loadPlanSubscriptions } from '../billing/plan-subscriptions.js'
import { resolvePlanEntitlement } from '../billing/plans.js'
import { parsePersonalizationSettings } from '../settings/application-settings.js'
import { newId } from '../lib/ids.js'

export interface ClientAttribution {
  platform: ClientPlatform
  version: string | null
}

/** Which app surface sent a request: the client header, else a user-agent guess. */
export function clientAttributionForRequest(request: Pick<FastifyRequest, 'headers' | 'apiKeyId'>): ClientAttribution {
  if (request.apiKeyId) return { platform: 'api', version: null }
  const header = request.headers[CLIENT_PLATFORM_HEADER]
  const parsed = parseClientPlatformHeader(Array.isArray(header) ? header[0] : header)
  if (parsed) return parsed
  const userAgent = request.headers['user-agent'] ?? ''
  if (/\bElectron\//.test(userAgent)) return { platform: 'desktop', version: null }
  if (/^Mozilla\//.test(userAgent)) return { platform: 'web', version: null }
  return { platform: 'unknown', version: null }
}

export function attachmentKind(mimeType: string): string {
  const type = mimeType.toLowerCase()
  if (type.startsWith('image/')) return 'image'
  if (type === 'application/pdf') return 'pdf'
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('video/')) return 'video'
  // Office formats are XML-based, so check them before the generic text formats.
  if (/spreadsheet|excel|wordprocessing|msword|presentation|powerpoint|opendocument/.test(type)) return 'document'
  if (type.startsWith('text/') || /json|csv|xml|yaml|markdown/.test(type)) return 'text'
  if (/zip|tar|gzip|compressed/.test(type)) return 'archive'
  return 'other'
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 40) : null
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

async function planForUser(userId: string): Promise<string | null> {
  if (!getConfig().PULPO_BILLING_ENABLED) return null
  const [[account], subscriptions] = await Promise.all([
    db.select({ planOverride: billingAccounts.planOverride }).from(billingAccounts).where(eq(billingAccounts.userId, userId)).limit(1),
    loadPlanSubscriptions(db, userId),
  ])
  return resolvePlanEntitlement(subscriptions, account?.planOverride).plan
}

async function personalizationSnapshot(userId: string) {
  const [[preferences], [personalizationRow]] = await Promise.all([
    db.select({ values: userPreferences.values }).from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1),
    db.select({ value: applicationSettings.value }).from(applicationSettings).where(eq(applicationSettings.key, 'personalization')).limit(1),
  ])
  const values = record(preferences?.values)
  const selections = record(values.instructionPresetSelections)
  const instructionPresetIds = parsePersonalizationSettings(personalizationRow?.value).instructionPresets
    .filter((preset) => typeof selections[preset.id] === 'boolean' ? selections[preset.id] : preset.defaultEnabled)
    .map((preset) => preset.id)
  return {
    instructionPresetIds,
    customInstructions: typeof values.customInstructions === 'string' && values.customInstructions.trim().length > 0,
    memoryEnabled: values.memoryEnabled === true,
  }
}

export interface RequestAdmissionAnalytics {
  responseId: string
  ownerUserId: string
  billingUserId: string
  apiKeyId: string | null
  requestedModelId: string
  answeredModelId: string
  origin: string
  client: ClientAttribution | null
  presetSelections: Record<string, string>
  /** Parameters after model defaults and the allowlist are applied. */
  effectiveParameters: Record<string, unknown>
  maxOutputTokens: number | null
  agentMode: boolean
  branchReason: string
  attachmentMimeTypes: string[]
  usedDictation: boolean | null
  inputChars: number
}

/**
 * Records the settings and client of a newly admitted response. Analytics must
 * never block a send, so failures are logged and swallowed.
 */
export async function recordRequestAdmission(input: RequestAdmissionAnalytics): Promise<void> {
  try {
    const publicApi = input.origin === 'api'
    const [plan, personalization] = await Promise.all([
      planForUser(input.billingUserId),
      publicApi ? null : personalizationSnapshot(input.ownerUserId),
    ])
    const reasoning = record(input.effectiveParameters.reasoning)
    const text = record(input.effectiveParameters.text)
    await db.insert(requestAnalytics).values({
      id: newId(),
      responseId: input.responseId,
      userId: input.ownerUserId,
      apiKeyId: input.apiKeyId,
      requestedModelId: input.requestedModelId,
      answeredModelId: input.answeredModelId,
      plan,
      origin: input.origin,
      clientPlatform: publicApi ? 'api' : input.client?.platform ?? 'unknown',
      clientVersion: publicApi ? null : input.client?.version ?? null,
      presetSelections: input.presetSelections,
      reasoningEffort: stringOrNull(reasoning.effort),
      verbosity: stringOrNull(text.verbosity),
      temperature: finiteOrNull(input.effectiveParameters.temperature),
      maxOutputTokens: input.maxOutputTokens,
      instructionPresetIds: personalization?.instructionPresetIds ?? null,
      customInstructions: personalization?.customInstructions ?? null,
      memoryEnabled: personalization?.memoryEnabled ?? null,
      agentMode: input.agentMode,
      branchReason: input.branchReason,
      attachmentCount: input.attachmentMimeTypes.length,
      attachmentKinds: [...new Set(input.attachmentMimeTypes.map(attachmentKind))].sort(),
      usedDictation: publicApi ? null : input.usedDictation ?? false,
      inputChars: input.inputChars,
      status: 'queued',
    }).onConflictDoNothing()
  } catch (error) {
    console.warn(JSON.stringify({
      level: 'warn', service: 'pulpo-analytics', event: 'analytics.admission_failed',
      responseId: input.responseId, error: error instanceof Error ? error.message : String(error),
    }))
  }
}

export async function discardRequestAnalytics(responseId: string): Promise<void> {
  await db.delete(requestAnalytics).where(eq(requestAnalytics.responseId, responseId)).catch(() => undefined)
}

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'incomplete'] as const

/**
 * Copies a response's outcome into its analytics row. A row is frozen once the
 * response is terminal and its budget has settled (or `force` is set, e.g.
 * right before a purge deletes the source rows).
 */
export async function finalizeRequestAnalytics(responseIds: string[], options: { force?: boolean } = {}): Promise<number> {
  const ids = [...new Set(responseIds)]
  if (!ids.length) return 0
  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)
  const force = options.force === true
  return db.transaction(async (tx) => {
    const updated = await tx.execute<{ id: string }>(sql`
      with source as (
        select
          r.id as response_id,
          r.status::text as status,
          coalesce(r.actual_model_id, l.actual_model_id, l.current_model_id, r.model_id) as answered_model_id,
          l.error_category, l.retry_count, l.fallback_used, l.duration_ms,
          case when r.first_reply_text_at is not null and r.request_received_at is not null
            then greatest(0, least(2147483647, extract(epoch from r.first_reply_text_at - r.request_received_at) * 1000))::integer end as first_token_ms,
          coalesce(u.input_tokens, l.input_tokens) as input_tokens,
          coalesce(u.cached_input_tokens, l.cached_input_tokens) as cached_input_tokens,
          coalesce(u.output_tokens, l.output_tokens) as output_tokens,
          coalesce(u.reasoning_tokens, l.reasoning_tokens) as reasoning_tokens,
          coalesce(u.cost_micros, l.cost_micros) as cost_micros,
          coalesce(run.tool_calls, 0) as tool_calls,
          b.pool_id,
          (r.status::text in ('completed', 'failed', 'cancelled', 'incomplete') and (
            ${force}::boolean or u.id is not null or b.id is null or b.status <> 'pending'
            or coalesce(r.completed_at, r.updated_at) < now() - interval '10 minutes'
          )) as settled
        from responses r
        join request_logs l on l.response_id = r.id
        left join usage_events u on u.response_id = r.id
        left join budget_reservations b on b.response_id = r.id
        left join agent_runs run on run.response_id = r.id
        where r.id in (${idList})
      )
      update request_analytics as a set
        status = s.status,
        answered_model_id = s.answered_model_id,
        error_category = s.error_category,
        retry_count = s.retry_count,
        fallback_used = s.fallback_used,
        duration_ms = s.duration_ms,
        first_token_ms = s.first_token_ms,
        input_tokens = s.input_tokens,
        cached_input_tokens = s.cached_input_tokens,
        output_tokens = s.output_tokens,
        reasoning_tokens = s.reasoning_tokens,
        cost_micros = s.cost_micros,
        tool_calls = s.tool_calls,
        pool_id = coalesce(s.pool_id, a.pool_id),
        finalized_at = case when s.settled then now() end
      from source s
      where a.response_id = s.response_id and a.finalized_at is null
      returning a.id
    `)
    const analyticsIds = [...updated].map((row) => row.id)
    if (!analyticsIds.length) return 0
    const analyticsList = sql.join(analyticsIds.map((id) => sql`${id}::uuid`), sql`, `)
    await tx.execute(sql`delete from request_analytics_tools where analytics_id in (${analyticsList})`)
    await tx.execute(sql`
      insert into request_analytics_tools (analytics_id, tool_name, calls, failures, cost_micros, created_at)
      select a.id, t.tool_name, count(*)::integer, (count(*) filter (where t.status = 'failed'))::integer,
        coalesce(sum(t.billed_cost_micros), 0), a.created_at
      from request_analytics a
      join agent_runs run on run.response_id = a.response_id
      join tool_executions t on t.agent_run_id = run.id
      where a.id in (${analyticsList})
      group by a.id, t.tool_name, a.created_at
    `)
    return analyticsIds.length
  })
}

/** Best-effort finalization from hot paths; the sweep retries anything missed. */
export function scheduleAnalyticsFinalization(responseId: string): void {
  void finalizeRequestAnalytics([responseId]).catch((error) => {
    console.warn(JSON.stringify({
      level: 'warn', service: 'pulpo-analytics', event: 'analytics.finalize_failed',
      responseId, error: error instanceof Error ? error.message : String(error),
    }))
  })
}

/** Finalizes terminal responses and closes rows whose response disappeared. */
export async function sweepRequestAnalytics(now = new Date()): Promise<number> {
  const pending = await db.select({ responseId: requestAnalytics.responseId })
    .from(requestAnalytics)
    .innerJoin(responses, eq(responses.id, requestAnalytics.responseId))
    .where(and(
      isNull(requestAnalytics.finalizedAt),
      lt(requestAnalytics.createdAt, new Date(now.getTime() - 15_000)),
      inArray(responses.status, [...TERMINAL_STATUSES]),
    ))
    .orderBy(requestAnalytics.createdAt)
    .limit(500)
  const finalized = await finalizeRequestAnalytics(pending.flatMap((row) => row.responseId ? [row.responseId] : []))
  const orphans = await db.update(requestAnalytics).set({
    finalizedAt: now,
    status: sql`case when ${requestAnalytics.status} in ('queued', 'in_progress') then 'cancelled' else ${requestAnalytics.status} end`,
  }).where(and(isNull(requestAnalytics.finalizedAt), isNull(requestAnalytics.responseId))).returning({ id: requestAnalytics.id })
  return finalized + orphans.length
}
