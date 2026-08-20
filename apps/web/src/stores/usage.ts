import { create } from 'zustand'
import type { MonitorUser } from '@/lib/types'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'

interface AdminUserRow {
  user: {
    id: string; name: string; username: string; avatarUrl?: string | null; profileColor: string | null; email: string
    role: 'pending' | 'user' | 'admin'; balanceMicros: number; createdAt: string
    storageLimitBytes: number
    blocked: boolean
    inviteCodeQuota?: number
  }
  lastActiveAt: string | null
  storageBytes: number
  twoFactorEnabled: boolean
}

interface UsageState {
  users: MonitorUser[]
  currentUserId: string
  loading: boolean
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
    inviteCodeQuota: row.user.inviteCodeQuota ?? 0,
  }
}

export const useUsage = create<UsageState>()((set, get) => ({
  users: [],
  currentUserId: '',
  loading: false,
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
