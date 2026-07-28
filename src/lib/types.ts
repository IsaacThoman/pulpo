export interface Model {
  id: string
  name: string
  provider: string
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
  archived: boolean
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
  prefix: string // e.g. sk-kimi-a1b2
  createdAt: number
  lastUsedAt: number | null
  scopes: ('chat' | 'embeddings' | 'images' | 'models')[]
  allowedModels: string[] // empty = all
  monthlyBudget: number | null // USD
  spentThisMonth: number
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
