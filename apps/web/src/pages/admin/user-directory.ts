import { useEffect, useState } from 'react'
import { apiRequest } from '@/lib/api'

export interface DirectoryUser {
  id: string
  name: string
  username: string
  email: string
  avatarUrl: string | null
  role: 'pending' | 'user' | 'admin'
  deletionRequestedAt: string | null
}

export interface UserDirectory {
  users: DirectoryUser[]
  loading: boolean
}

interface AdminUserRow {
  user: Omit<DirectoryUser, 'avatarUrl' | 'deletionRequestedAt'> & { avatarUrl?: string | null; deletionRequestedAt?: string | null }
}

export function matchesUserQuery(user: Pick<DirectoryUser, 'name' | 'username' | 'email'>, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return !needle || `${user.name} ${user.username} ${user.email}`.toLowerCase().includes(needle)
}

/** Loads the admin user directory the first time a picker or badge needs it. */
export function useAdminUserDirectory(enabled: boolean): UserDirectory {
  const [users, setUsers] = useState<DirectoryUser[] | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!enabled || users || loading) return
    setLoading(true)
    void apiRequest<{ data: AdminUserRow[] }>('/api/admin/users')
      .then((result) => setUsers(result.data.map(({ user }) => ({
        id: user.id, name: user.name, username: user.username, email: user.email, role: user.role,
        avatarUrl: user.avatarUrl ?? null, deletionRequestedAt: user.deletionRequestedAt ?? null,
      }))))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false))
  }, [enabled, users, loading])
  return { users: users ?? [], loading }
}
