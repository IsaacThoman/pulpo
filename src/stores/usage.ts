import { create } from 'zustand'
import type { MonitorUser, UsageRecord } from '@/lib/types'
import { CURRENT_USER_ID, MONITOR_USERS, makeUsageRecords } from '@/lib/mock'

interface UsageState {
  records: UsageRecord[]
  users: MonitorUser[]
  currentUserId: string
  updateBalance: (userId: string, balance: number) => void
  toggleBlocked: (userId: string) => void
  setLeaderboardPref: (userId: string, patch: Partial<MonitorUser>) => void
}

export const useUsage = create<UsageState>()((set) => ({
  records: makeUsageRecords(),
  users: MONITOR_USERS,
  currentUserId: CURRENT_USER_ID,
  updateBalance: (userId, balance) =>
    set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, balance } : u)) })),
  toggleBlocked: (userId) =>
    set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, blocked: !u.blocked } : u)) })),
  setLeaderboardPref: (userId, patch) =>
    set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, ...patch } : u)) })),
}))
