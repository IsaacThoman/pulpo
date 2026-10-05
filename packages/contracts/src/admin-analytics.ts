import { z } from 'zod'

/** Header Pulpo clients send so requests can be attributed to an app surface. */
export const CLIENT_PLATFORM_HEADER = 'x-pulpo-client'

export const clientPlatformSchema = z.enum(['web', 'desktop', 'ios', 'android', 'cli', 'api', 'unknown'])
export type ClientPlatform = z.infer<typeof clientPlatformSchema>

/** Parses `platform` or `platform/version`, e.g. `ios/1.4.2`. Unknown values return null. */
export function parseClientPlatformHeader(value: string | null | undefined): { platform: ClientPlatform; version: string | null } | null {
  if (!value) return null
  const [rawPlatform, rawVersion] = value.trim().toLowerCase().split('/', 2)
  const platform = clientPlatformSchema.safeParse(rawPlatform)
  if (!platform.success || platform.data === 'api' || platform.data === 'unknown') return null
  const version = rawVersion && /^[0-9a-z.+-]{1,32}$/.test(rawVersion) ? rawVersion : null
  return { platform: platform.data, version }
}

export const analyticsRangeSchema = z.enum(['1h', '24h', '7d', '30d', '90d', 'all', 'custom'])
export type AnalyticsRange = z.infer<typeof analyticsRangeSchema>
export const analyticsBucketSchema = z.enum(['hour', 'day'])
export type AnalyticsBucket = z.infer<typeof analyticsBucketSchema>

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

const booleanFilter = z.enum(['true', 'false']).optional()
const csvFilter = z.string().trim().max(500).optional()

export const analyticsRangeQuerySchema = z.object({
  range: analyticsRangeSchema.default('24h'),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  timeZone: z.string().trim().min(1).max(100).refine(validTimeZone, 'Invalid time zone').default('UTC'),
}).refine((value) => value.range !== 'custom' || Boolean(value.from), {
  message: 'Custom ranges need a start time',
  path: ['from'],
})
export type AnalyticsRangeQuery = z.infer<typeof analyticsRangeQuerySchema>

export const adminRequestFiltersSchema = z.object({
  status: csvFilter,
  origin: csvFilter,
  platform: csvFilter,
  model: csvFilter,
  userId: z.uuid().optional(),
  apiKeyId: z.uuid().optional(),
  errorCategory: csvFilter,
  retry: booleanFilter,
  fallback: booleanFilter,
  agent: booleanFilter,
  ocr: booleanFilter,
})
export type AdminRequestFilters = z.infer<typeof adminRequestFiltersSchema>

export const adminRequestSortSchema = z.enum(['newest', 'slowest', 'costliest'])
export type AdminRequestSort = z.infer<typeof adminRequestSortSchema>

export const insightsFiltersSchema = z.object({
  platform: csvFilter,
  plan: csvFilter,
  origin: csvFilter,
  model: csvFilter,
})
export type InsightsFilters = z.infer<typeof insightsFiltersSchema>

export interface AnalyticsWindow {
  /** Null for all-time ranges. */
  from: string | null
  to: string
  bucket: AnalyticsBucket
  /** Start of the equally long window before `from`; null for all-time ranges. */
  previousFrom: string | null
}

export interface RequestKpis {
  requests: number
  completed: number
  failed: number
  cancelled: number
  incomplete: number
  inFlight: number
  /** Completed share of finished requests (excludes in-flight). */
  successRate: number
  errorRate: number
  ttftP50Ms: number | null
  ttftP95Ms: number | null
  durationP50Ms: number | null
  durationP95Ms: number | null
  costMicros: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  users: number
}

export interface RequestSeriesPoint {
  bucket: string
  completed: number
  failed: number
  cancelled: number
  incomplete: number
  inFlight: number
  costMicros: number
  ttftP50Ms: number | null
  ttftP95Ms: number | null
  durationP50Ms: number | null
  durationP95Ms: number | null
}

export interface NamedCount { id: string; label: string; count: number; costMicros?: number }

export interface AdminRequestsOverview {
  window: AnalyticsWindow
  kpis: { current: RequestKpis; previous: RequestKpis | null }
  series: RequestSeriesPoint[]
  errors: {
    byCategory: NamedCount[]
    byModel: NamedCount[]
    topMessages: Array<{ message: string; category: string | null; count: number; lastSeenAt: string }>
  }
  reliability: Array<{ modelId: string; modelName: string; requests: number; failures: number; retried: number; fallbacks: number; ttftP50Ms: number | null }>
  fallbackPaths: Array<{ fromModelId: string; toModelId: string; count: number }>
  topModels: NamedCount[]
  topUsers: NamedCount[]
  topApiKeys: NamedCount[]
  modelNames: Record<string, string>
}

export interface AdminRequestRow {
  id: string
  responseId: string
  createdAt: string
  status: string
  origin: string
  platform: ClientPlatform
  user: { id: string; name: string; email: string } | null
  apiKey: { id: string; name: string; prefix: string } | null
  requestedModelId: string
  actualModelId: string | null
  agentMode: boolean
  retryCount: number
  fallbackUsed: boolean
  stickyFallbackUsed: boolean
  ocrStatus: string
  errorCategory: string | null
  errorMessage: string | null
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  costMicros: number
  ttftMs: number | null
  durationMs: number | null
  tokensPerSecond: number | null
  attempts: number
  toolCalls: number
}

export interface AdminRequestPage {
  data: AdminRequestRow[]
  nextCursor: string | null
}

export type AdminRequestTimelineItem =
  | {
    kind: 'attempt'
    id: string
    startedAt: string
    completedAt: string | null
    status: string
    purpose: string
    modelId: string
    upstreamModelId: string | null
    retryAttempt: number
    turnNumber: number | null
    retryReason: string | null
    fallbackFromModelId: string | null
    errorCategory: string | null
    errorMessage: string | null
    firstTokenMs: number | null
    durationMs: number | null
    inputTokens: number
    outputTokens: number
    costMicros: number
  }
  | {
    kind: 'tool'
    id: string
    startedAt: string | null
    completedAt: string | null
    status: string
    toolName: string
    provider: string | null
    error: string | null
    billedCostMicros: number
  }

export interface AdminRequestDetail {
  request: AdminRequestRow
  timeline: AdminRequestTimelineItem[]
  ocrAttempts: Array<{ id: string; status: string; providerId: string | null; modelId: string | null; cached: boolean; durationMs: number | null; errorMessage: string | null }>
  settings: {
    presetSelections: Record<string, string>
    parameters: Record<string, unknown>
    branchReason: string | null
    clientVersion: string | null
  } | null
}

export interface InsightsModels {
  window: AnalyticsWindow
  totalRequests: number
  series: Array<{ bucket: string; modelId: string; requests: number }>
  models: Array<{
    modelId: string
    modelName: string
    requests: number
    previousRequests: number | null
    users: number
    costMicros: number
    avgCostMicros: number
    successRate: number
    ttftP50Ms: number | null
    durationP50Ms: number | null
  }>
  redirects: Array<{ requestedModelId: string; answeredModelId: string; count: number }>
  modelNames: Record<string, string>
}

export interface InsightsSettings {
  window: AnalyticsWindow
  totalRequests: number
  presets: Array<{
    presetId: string
    presetName: string
    modelId: string | null
    modelName: string | null
    total: number
    choices: Array<{ choiceId: string; choiceName: string; count: number }>
  }>
  reasoningEffort: NamedCount[]
  verbosity: NamedCount[]
  temperature: NamedCount[]
  customInstructions: number
  memoryEnabled: number
  instructionPresets: NamedCount[]
  /** Requests whose settings were captured; backfilled history may lack them. */
  settingsCaptured: number
}

export interface InsightsTools {
  window: AnalyticsWindow
  totalRequests: number
  agentRequests: number
  toolCalls: number
  tools: Array<{ toolName: string; calls: number; failures: number; requests: number; costMicros: number }>
  series: Array<{ bucket: string; agentRequests: number; toolCalls: number }>
}

export interface InsightsPools {
  window: AnalyticsWindow
  activePools: number
  pooledUsers: number
  pooledRequests: number
  totalRequests: number
  funding: { subscriptionMicros: number; sharedAllowanceMicros: number; creditMicros: number }
  pools: Array<{ poolId: string; ownerName: string; members: number; requests: number; users: number; costMicros: number }>
}

export interface InsightsFeatures {
  window: AnalyticsWindow
  totalRequests: number
  platforms: Array<{ platform: ClientPlatform; requests: number; users: number }>
  platformSeries: Array<{ bucket: string; platform: ClientPlatform; requests: number }>
  origins: NamedCount[]
  plans: Array<{ plan: string; requests: number; users: number; costMicros: number }>
  dictation: number
  withAttachments: number
  attachmentKinds: NamedCount[]
  branchReasons: NamedCount[]
  /** Requests where client-side features were captured; older rows may lack them. */
  featuresCaptured: number
}

export interface InsightsEngagement {
  window: AnalyticsWindow
  dau: number
  wau: number
  mau: number
  activeUsers: number
  newUsers: number
  returningUsers: number
  activeSeries: Array<{ bucket: string; users: number; newUsers: number }>
  cohorts: Array<{ cohortStart: string; size: number; retention: number[] }>
  concentration: { top1PctShare: number; top10PctShare: number; top10UsersShare: number }
  topUsers: Array<{ userId: string; name: string; requests: number; costMicros: number; activeDays: number }>
}
