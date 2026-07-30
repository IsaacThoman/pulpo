export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high'
export type SpeedOption = 'standard' | 'fast'

export interface Model {
  id: string
  name: string
  provider: string
  /** Monochrome company/lab mark used in the picker header and provider rail. */
  labLogo: string
  /** Model/product mark used in chat, favorites, and model lists. */
  modelLogo: string
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
  pinned?: boolean
  /** Reasoning effort options shown in the chat composer (admin-configured; empty = hide control). */
  reasoningEfforts: ReasoningEffort[]
  /** Speed options shown in the chat composer (admin-configured; empty = hide control). */
  speedOptions: SpeedOption[]
}

export interface Attachment {
  id: string
  name: string
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
  reasoningEffort?: ReasoningEffort
  speed?: SpeedOption
  attachments?: Attachment[]
  rating?: 'up' | 'down' | null
  done: boolean
}

export interface Chat {
  id: string
  title: string
  modelId: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  pinned: boolean
  folderId: string | null
  tags: string[]
  shareId?: string
}

export interface Folder {
  id: string
  name: string
  expanded: boolean
}

export interface ApiKey {
  id: string
  name: string
  prefix: string // e.g. sk-pulpo-a1b2
  createdAt: number
  lastUsedAt: number | null
  scopes: ('chat' | 'embeddings' | 'models')[]
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
  nickname: string | null
  email: string
  role: 'admin' | 'user'
  balance: number
  joinedAt: number
  blocked: boolean
  showOnLeaderboard: boolean
  barColor: string
}

export type TimeRange = '24h' | '7d' | '30d' | '90d' | 'all'
export type Metric = 'cost' | 'tokens' | 'calls'
