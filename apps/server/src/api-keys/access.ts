export interface ApiKeyOwner {
  blocked: boolean
  role: 'pending' | 'user' | 'admin'
}

export function apiKeyOwnerCanSpend(user: ApiKeyOwner): boolean {
  return !user.blocked && user.role !== 'pending'
}
