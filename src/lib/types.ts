/** Lucide icon id used for preset / choice marks in the composer. */
export type ChatPresetIcon =
  | 'brain'
  | 'zap'
  | 'zap-off'
  | 'gauge'
  | 'sparkles'
  | 'rocket'
  | 'circle'
  | 'flame'
  | 'timer'

/** What happens when a preset choice is selected. */
export type ChatPresetAction =
  | { type: 'none' }
  | { type: 'redirect'; modelId: string }
  | { type: 'params'; params: string }

export interface ChatPresetChoice {
  id: string
  displayName: string
  /** Optional icon when this choice is the active selection. */
  icon?: ChatPresetIcon
  action: ChatPresetAction
}

/** A named group of composer choices (e.g. Reasoning, Speed). */
export interface ChatPreset {
  id: string
  name: string
  /** Default icon for the group when no choice-specific icon applies. */
  icon: ChatPresetIcon
  choices: ChatPresetChoice[]
  /** Choice selected by default when the user has no saved preference. */
  defaultChoiceId?: string
}

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
  /** Composer presets (admin-configured; empty = no extra controls). */
  presets: ChatPreset[]
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
  /** Selected preset choice ids keyed by preset id. */
  presetSelections?: Record<string, string>
  attachments?: Attachment[]
  branch?: { ids: string[]; index: number }
  error?: string
  outputItems?: unknown[]
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
  nickname: string | null
  email: string
  role: 'pending' | 'admin' | 'user'
  balance: number
  joinedAt: number
  blocked: boolean
  showOnLeaderboard: boolean
  barColor: string
  lastActiveAt?: number | null
  usageCalls?: number
  usageTokens?: number
  usageCost?: number
}

export type TimeRange = '24h' | '7d' | '30d' | '90d' | 'all'
export type Metric = 'cost' | 'tokens' | 'calls'
