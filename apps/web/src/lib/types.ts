import type { ChatPreset, QueuedMessage } from '@pulpo/contracts'
import type { CatalogIconReference } from '@/lib/catalog-icons'

export type { ChatPreset, ChatPresetAction, ChatPresetChoice, ChatPresetIcon } from '@pulpo/contracts'

export interface Model {
  id: string
  name: string
  /** Stable catalog lab id used for synchronized provider grouping/order. */
  providerGroupId: string
  provider: string
  /** Monochrome company/lab mark used in the picker header and provider rail. */
  labLogo: string
  labCustomIcon?: CatalogIconReference | null
  /** Model/product mark used in chat, favorites, and model lists. */
  modelLogo: string
  modelCustomIcon?: CatalogIconReference | null
  inferenceProvider: string
  description: string
  contextWindow: number
  tags: ('vision' | 'reasoning' | 'tools' | 'fast' | 'code')[]
  /** theme-aware square avatars (deathgrips style) — css colors */
  iconLight: string
  iconDark: string
  inputPrice: number // USD per 1M tokens
  outputPrice: number
  perMessagePrice: number
  enabled: boolean
  agentEnabled?: boolean
  pinned?: boolean
  /** Composer presets (admin-configured; empty = no extra controls). */
  presets: ChatPreset[]
}

export interface Attachment {
  id: string
  name: string
  mimeType: string
  type: 'image' | 'file'
  size: number
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  modelId?: string
  timestamp: number
  tokensIn?: number
  tokensOut?: number
  cost?: number
  latencyMs?: number
  reasoning?: string
  /** Selected preset choice ids keyed by preset id. */
  presetSelections?: Record<string, string>
  attachments?: Attachment[]
  branch?: { ids: string[]; index: number }
  error?: string
  outputItems?: unknown[]
  agentMode?: boolean
  done: boolean
}

export interface Chat {
  id: string
  title: string
  modelId: string
  messages: Message[]
  queuedMessages?: QueuedMessage[]
  createdAt: number
  updatedAt: number
  pinned: boolean
  folderId: string | null
  sortOrder: number
  tags: string[]
  temporary: boolean
  expiresAt: number | null
  expired: boolean
  shareId?: string
}

export interface Folder {
  id: string
  name: string
  pinned: boolean
  expanded: boolean
  sortOrder: number
}

export interface ApiKey {
  id: string
  name: string
  prefix: string // e.g. sk-pulpo-a1b2
  createdAt: number
  lastUsedAt: number | null
  scopes: ('responses' | 'models')[]
  allowedModels: string[] // empty = all
  monthlyBudget: number | null // USD
  totalBudget: number | null // USD lifetime cap
  spentThisMonth: number
  spentTotal: number
  revoked: boolean
}

export interface UsageRecord {
  id: string
  timestamp: number
  userId: string
  modelId: string
  tokensIn: number
  tokensOut: number
  cost: number
  balanceAfter: number
  latencyMs: number
}

export interface MonitorUser {
  id: string
  name: string
  username: string | null
  avatarUrl: string | null
  profileColor: string | null
  email: string
  role: 'pending' | 'admin' | 'user'
  balance: number
  storageLimitBytes?: number
  storageBytes?: number
  joinedAt: number
  blocked: boolean
  lastActiveAt?: number | null
  twoFactorEnabled?: boolean
  usageCalls?: number
  usageTokens?: number
  usageCost?: number
}

export type TimeRange = '24h' | '7d' | '30d' | '90d' | 'all'
export type Metric = 'cost' | 'tokens' | 'calls'
