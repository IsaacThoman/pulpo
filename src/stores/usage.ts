import { create } from 'zustand'
import type { MonitorUser, UsageRecord } from '@/lib/types'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'

interface AdminUserRow {
  user: {
    id: string; name: string; nickname: string | null; email: string
    role: 'pending' | 'user' | 'admin'; balanceMicros: number; createdAt: string
    blocked: boolean; leaderboardVisible: boolean; leaderboardColor: string
  }
}

interface UsageState {
  records: UsageRecord[]
  users: MonitorUser[]
  currentUserId: string
  loading: boolean
  loadPersonal: () => Promise<void>
  loadLeaderboard: () => Promise<void>
  loadAdmin: () => Promise<void>
  updateBalance: (userId: string, balance: number) => void
  toggleBlocked: (userId: string) => void
  setLeaderboardPref: (userId: string, patch: Partial<MonitorUser>) => void
}

function mapAdmin(row: AdminUserRow): MonitorUser {
  return {
    id: row.user.id, name: row.user.name, nickname: row.user.nickname, email: row.user.email,
    role: row.user.role, balance: row.user.balanceMicros / 1_000_000,
    joinedAt: Date.parse(row.user.createdAt), blocked: row.user.blocked,
    showOnLeaderboard: row.user.leaderboardVisible, barColor: row.user.leaderboardColor,
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
  loadLeaderboard: async () => {
    const result = await apiRequest<{ data: Array<{
      userId: string; name: string; color: string; balanceMicros: number
    }> }>('/api/usage/leaderboard')
    set((state) => ({ users: result.data.map((row) => ({
      id: row.userId, name: row.name, nickname: null, email: '', role: 'user',
      balance: row.balanceMicros / 1_000_000, joinedAt: 0, blocked: false,
      showOnLeaderboard: true, barColor: row.color,
    })), currentUserId: useAuth.getState().user?.id ?? state.currentUserId }))
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
  toggleBlocked: (userId) => {
    const user = get().users.find((candidate) => candidate.id === userId)
    if (!user) return
    set((state) => ({ users: state.users.map((candidate) => candidate.id === userId ? { ...candidate, blocked: !candidate.blocked } : candidate) }))
    void apiRequest(`/api/admin/users/${userId}`, { method: 'PATCH', body: { blocked: !user.blocked } })
      .catch(() => get().loadAdmin())
  },
  setLeaderboardPref: (userId, patch) => {
    set((state) => ({ users: state.users.map((user) => user.id === userId ? { ...user, ...patch } : user) }))
    const body = {
      nickname: patch.nickname, leaderboardVisible: patch.showOnLeaderboard,
      leaderboardColor: patch.barColor,
    }
    void apiRequest('/api/settings', { method: 'PATCH', body: Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)) })
  },
}))
