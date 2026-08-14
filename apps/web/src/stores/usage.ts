import { create } from 'zustand'
import type { MonitorUser, TimeRange, UsageRecord } from '@/lib/types'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'

interface AdminUserRow {
  user: {
    id: string; name: string; username: string; avatarUrl?: string | null; profileColor: string | null; email: string
    role: 'pending' | 'user' | 'admin'; balanceMicros: number; createdAt: string
    storageLimitBytes: number
    blocked: boolean
  }
  lastActiveAt: string | null
  storageBytes: number
  twoFactorEnabled: boolean
}

interface UsageState {
  records: UsageRecord[]
  users: MonitorUser[]
  currentUserId: string
  loading: boolean
  loadPersonal: () => Promise<void>
  loadLeaderboard: (range?: TimeRange) => Promise<void>
  loadAdmin: () => Promise<void>
  updateBalance: (userId: string, balance: number) => void
  updateStorageLimit: (userId: string, storageLimitBytes: number) => void
  toggleBlocked: (userId: string) => void
}

function mapAdmin(row: AdminUserRow): MonitorUser {
  return {
    id: row.user.id, name: row.user.name, username: row.user.username, avatarUrl: row.user.avatarUrl ?? null, profileColor: row.user.profileColor, email: row.user.email,
    role: row.user.role, balance: row.user.balanceMicros / 1_000_000,
    storageLimitBytes: row.user.storageLimitBytes, storageBytes: row.storageBytes,
    joinedAt: Date.parse(row.user.createdAt), blocked: row.user.blocked,
    lastActiveAt: row.lastActiveAt ? Date.parse(row.lastActiveAt) : null,
    twoFactorEnabled: row.twoFactorEnabled,
  }
}

export const useUsage = create<UsageState>()((set, get) => ({
  records: [],
  users: [],
  currentUserId: '',
  loading: false,
  loadPersonal: async () => {
    set({ loading: true, currentUserId: useAuth.getState().user?.id ?? '' })
    try {
      const result = await apiRequest<{ data: Array<{
        id: string; createdAt: string; userId: string; modelId: string; inputTokens: number
        outputTokens: number; costMicros: number; latencyMs: number; balanceAfterMicros?: number
      }> }>('/api/usage/records?limit=200')
      set({ records: result.data.map((row) => ({
        id: row.id, timestamp: Date.parse(row.createdAt), userId: row.userId, modelId: row.modelId,
        tokensIn: row.inputTokens, tokensOut: row.outputTokens, cost: row.costMicros / 1_000_000,
        balanceAfter: (row.balanceAfterMicros ?? 0) / 1_000_000, latencyMs: row.latencyMs,
      })) })
    } finally { set({ loading: false }) }
  },
  loadLeaderboard: async (range = '30d') => {
    const currentUserId = useAuth.getState().user?.id ?? ''
    // Never render users retained from an admin or older leaderboard request
    // while the private friend circle is loading.
    set({ users: [], currentUserId })
    const days = range === '24h' ? '1' : range === '7d' ? '7' : range === '30d' ? '30' : range === '90d' ? '90' : 'all'
    const result = await apiRequest<{ data: Array<{
      userId: string; displayName: string; username: string; avatarUrl: string | null; profileColor: string | null; balanceMicros: number
      calls: number; tokens: number; costMicros: number
    }> }>(`/api/usage/leaderboard?days=${days}`)
    set((state) => ({ users: result.data.map((row) => ({
      id: row.userId, name: row.displayName, username: row.username, avatarUrl: row.avatarUrl, profileColor: row.profileColor, email: '', role: 'user',
      balance: row.balanceMicros / 1_000_000, joinedAt: 0, blocked: false,
      usageCalls: row.calls, usageTokens: row.tokens, usageCost: row.costMicros / 1_000_000,
    })), currentUserId: currentUserId || state.currentUserId }))
  },
  loadAdmin: async () => {
    set({ loading: true })
    try {
      const result = await apiRequest<{ data: AdminUserRow[] }>('/api/admin/users')
      set({ users: result.data.map(mapAdmin), currentUserId: useAuth.getState().user?.id ?? '' })
    } finally { set({ loading: false }) }
  },
  updateBalance: (userId, balance) => {
    set((state) => ({ users: state.users.map((user) => user.id === userId ? { ...user, balance } : user) }))
    void apiRequest(`/api/admin/users/${userId}`, { method: 'PATCH', body: { balanceMicros: Math.round(balance * 1_000_000) } })
      .catch(() => get().loadAdmin())
  },
  updateStorageLimit: (userId, storageLimitBytes) => {
    set((state) => ({ users: state.users.map((user) => user.id === userId ? { ...user, storageLimitBytes } : user) }))
    void apiRequest(`/api/admin/users/${userId}`, { method: 'PATCH', body: { storageLimitBytes } })
      .catch(() => get().loadAdmin())
  },
  toggleBlocked: (userId) => {
    const user = get().users.find((candidate) => candidate.id === userId)
    if (!user) return
    set((state) => ({ users: state.users.map((candidate) => candidate.id === userId ? { ...candidate, blocked: !candidate.blocked } : candidate) }))
    void apiRequest(`/api/admin/users/${userId}`, { method: 'PATCH', body: { blocked: !user.blocked } })
      .catch(() => get().loadAdmin())
  },
}))
